/**
 * service_docflow.js — 書類ワークフロー（テンプレートから Google ドキュメントを作り、提出・承認する）
 *
 * - ウィジェットの設定（保存先フォルダ・テンプレートの一覧・テンプレートごとの承認者）は、
 *   画面から送られた値ではなく、サーバーが保存済みのダッシュボードから読む（承認者を書き換えられないように）
 * - ステータスは、保存先フォルダの中のサブフォルダ（提出前／提出後／承認後／拒否後）で表す。
 *   ドライブを開いても状態が一目でわかる
 * - 作成者・承認者・提出や判断の記録は、ファイルの appProperties に持つ。
 *   提出・承認・差し戻し・拒否の経緯は、ドキュメントのコメントにも書き込む（やり取りと一緒に残る）
 */

/** 利用者に見せるエラー。Google から返ったもとのエラー文も添える（原因を確かめられるように） */
function flowError_(message, err) {
  console.error(message + ' / ' + (err && err.stack ? err.stack : err));
  const detail = err && err.message ? String(err.message).slice(0, 200) : '';
  return new UserError(detail ? message + '［詳細：' + detail + '］' : message);
}

const DOCFLOW = {
  statuses: [
    { key: 'draft', folder: '提出前' },
    { key: 'submitted', folder: '提出後' },
    { key: 'approved', folder: '承認後' },
    { key: 'rejected', folder: '拒否後' },
  ],
  maxApprovers: 5,
  defaultNamePattern: '{件名}_{作成者}_{日付}',
  folderMime: 'application/vnd.google-apps.folder',
};

/* ------------------------------------------------------------------ */
/* ウィジェットの設定                                                     */
/* ------------------------------------------------------------------ */

/** URL（ドキュメント・フォルダ）または ID から、ファイルの ID を取り出す */
function driveIdFromUrl_(value) {
  const s = String(value || '').trim();
  const m = s.match(/\/d\/([\w-]{20,})/) || s.match(/\/folders\/([\w-]{20,})/) || s.match(/[?&]id=([\w-]{20,})/);
  if (m) return m[1];
  return /^[\w-]{20,}$/.test(s) ? s : '';
}

/** 承認者の指定（カンマ・空白・読点区切り）→ メールアドレスの一覧 */
function parseApprovers_(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[,\s、，;]+/);
  const out = [];
  list.forEach(function (v) {
    const email = String(v || '').trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && out.indexOf(email) < 0) out.push(email);
  });
  return out.slice(0, DOCFLOW.maxApprovers);
}

/**
 * ウィジェットの設定を、保存済みのダッシュボードから読む。
 * @param {{ unit: string | null, widgetId: string }} ref  共有タブの ID（自分のタブなら null）とウィジェットの ID
 */
function docflowConfig_(ref) {
  const widgetId = String(ref && ref.widgetId || '');
  if (!widgetId) throw new UserError('ウィジェットの指定がありません');
  let json;
  if (ref.unit) {
    const unit = accessibleUnits_().filter(function (u) { return u.id === String(ref.unit); })[0];
    if (!unit) throw new UserError('この共有タブを見る権限がありません');
    json = readUnitData_(unit.id).json;
  } else {
    json = readPersonal_().json;
  }
  let widget = null;
  try {
    const data = json ? JSON.parse(json) : { pages: [] };
    (data.pages || []).forEach(function (p) {
      (p.widgets || []).forEach(function (w) { if (w.id === widgetId && w.type === 'docflow') widget = w; });
    });
  } catch (e) { /* 読めないときは、見つからない扱い */ }
  if (!widget) throw new UserError('ウィジェットの設定が見つかりません。設定を変えた直後なら、数秒待ってからもう一度お試しください');

  const folderId = driveIdFromUrl_(widget.folder);
  if (!folderId) throw new UserError('保存先のフォルダが設定されていません（ウィジェットの ✎ から設定してください）');
  const templates = (Array.isArray(widget.templates) ? widget.templates : []).map(function (t) {
    return {
      id: String(t && t.id || ''),
      name: String(t && t.name || '').trim() || 'テンプレート',
      docId: driveIdFromUrl_(t && t.url),
      approvers: parseApprovers_(t && t.approvers),
    };
  }).filter(function (t) { return t.id && t.docId; });
  return {
    folderId: folderId,
    templates: templates,
    namePattern: String(widget.namePattern || '').trim() || DOCFLOW.defaultNamePattern,
  };
}

/* ------------------------------------------------------------------ */
/* ステータスのフォルダ                                                   */
/* ------------------------------------------------------------------ */

/** 保存先フォルダの中の、ステータスごとのサブフォルダ { draft: id, … }。create なら足りないものを作る */
function statusFolders_(folderId, create) {
  let list;
  try {
    list = Drive.Files.list({
      q: "'" + folderId + "' in parents and mimeType = '" + DOCFLOW.folderMime + "' and trashed = false",
      fields: 'files(id,name)',
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
  } catch (err) {
    throw flowError_('保存先のフォルダを開けません（フォルダが共有されているか確認してください）', err);
  }
  const byName = {};
  (list.files || []).forEach(function (f) { if (!(f.name in byName)) byName[f.name] = f.id; });
  const out = {};
  let parent = null;
  DOCFLOW.statuses.forEach(function (s) {
    if (byName[s.folder]) {
      out[s.key] = byName[s.folder];
    } else if (create) {
      try {
        parent = parent || DriveApp.getFolderById(folderId);
        out[s.key] = parent.createFolder(s.folder).getId();
      } catch (err) {
        throw flowError_('保存先のフォルダに「' + s.folder + '」フォルダを作れません（フォルダの編集者である必要があります）', err);
      }
    }
  });
  return out;
}

function statusOfParents_(parents, folders) {
  for (let i = 0; i < DOCFLOW.statuses.length; i++) {
    const key = DOCFLOW.statuses[i].key;
    if (folders[key] && (parents || []).indexOf(folders[key]) >= 0) return key;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 承認者                                                               */
/* ------------------------------------------------------------------ */

function readApprovers_(props) {
  const out = [];
  for (let i = 0; i < DOCFLOW.maxApprovers; i++) {
    const v = props && props['pdApprover' + i];
    if (v) out.push(String(v).toLowerCase());
  }
  return out;
}

function approverProps_(approvers) {
  const props = {};
  for (let i = 0; i < DOCFLOW.maxApprovers; i++) props['pdApprover' + i] = approvers[i] || null; // null で消す
  return props;
}

/** 開いている人が直接のメンバーになっている Google グループ（10 分キャッシュ） */
function myGroupEmails_() {
  const cache = CacheService.getUserCache();
  const cached = cacheGet_(cache, 'docflow:groups');
  if (cached) return cached;
  let emails = [];
  try {
    emails = GroupsApp.getGroups().map(function (g) { return g.getEmail().toLowerCase(); });
  } catch (err) {
    console.warn('groups unavailable: ' + err);
  }
  cachePut_(cache, 'docflow:groups', emails, 600);
  return emails;
}

/** 承認者のどれかが、本人のアカウントか、本人が入っているグループか */
function isApprover_(approvers, me, groupsFn) {
  if (!approvers.length) return false;
  if (approvers.indexOf(me) >= 0) return true;
  const groups = groupsFn();
  return approvers.some(function (a) { return groups.indexOf(a) >= 0; });
}

/* ------------------------------------------------------------------ */
/* 一覧                                                                 */
/* ------------------------------------------------------------------ */

function docflowList_(ref) {
  const cfg = docflowConfig_(ref);
  const me = userEmail_().toLowerCase();
  const templates = cfg.templates.map(function (t) {
    return { id: t.id, name: t.name, approvers: t.approvers };
  });
  const folders = statusFolders_(cfg.folderId, false);
  const ids = Object.keys(folders).map(function (k) { return folders[k]; });
  if (!ids.length) return { me: me, templates: templates, items: [] };

  const q = '(' + ids.map(function (id) { return "'" + id + "' in parents"; }).join(' or ') + ") and trashed = false and mimeType != '" + DOCFLOW.folderMime + "'";
  const files = [];
  let pageToken = null;
  do {
    const res = Drive.Files.list({
      q: q,
      fields: 'nextPageToken,files(id,name,webViewLink,modifiedTime,createdTime,parents,appProperties)',
      orderBy: 'modifiedTime desc',
      pageSize: 200,
      pageToken: pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    (res.files || []).forEach(function (f) { files.push(f); });
    pageToken = res.nextPageToken;
  } while (pageToken && files.length < 1000);

  let groups = null;
  const groupsFn = function () { return groups || (groups = myGroupEmails_()); };
  const templateName = {};
  cfg.templates.forEach(function (t) { templateName[t.id] = t.name; });

  const items = files.map(function (f) {
    const props = f.appProperties || {};
    const status = statusOfParents_(f.parents, folders);
    const approvers = readApprovers_(props);
    const creator = String(props.pdCreator || '').toLowerCase();
    return {
      id: f.id,
      name: f.name,
      url: f.webViewLink || ('https://docs.google.com/document/d/' + f.id + '/edit'),
      status: status,
      modifiedTime: f.modifiedTime,
      createdTime: f.createdTime,
      creator: creator,
      template: templateName[props.pdTemplate] || '',
      approvers: approvers,
      submittedAt: props.pdSubmittedAt || '',
      decidedBy: props.pdDecidedBy || '',
      decidedAt: props.pdDecidedAt || '',
      isCreator: Boolean(creator) && creator === me,
      canDecide: status === 'submitted' && isApprover_(approvers, me, groupsFn),
    };
  });
  return { me: me, templates: templates, items: items };
}

/* ------------------------------------------------------------------ */
/* 作成・提出・判断                                                       */
/* ------------------------------------------------------------------ */

function buildDocName_(pattern, values) {
  const name = pattern.replace(/\{(件名|テンプレート|作成者|日付)\}/g, function (all, key) { return values[key] || ''; })
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim();
  return (name || values['テンプレート'] || '書類').slice(0, 200);
}

function docflowCreate_(ref, templateId, subject) {
  const cfg = docflowConfig_(ref);
  const t = cfg.templates.filter(function (x) { return x.id === String(templateId); })[0];
  if (!t) throw new UserError('テンプレートが見つかりません');
  const me = userEmail_().toLowerCase();
  const folders = statusFolders_(cfg.folderId, true);
  const name = buildDocName_(cfg.namePattern, {
    '件名': String(subject || '').trim().slice(0, 100) || t.name,
    'テンプレート': t.name,
    '作成者': me.split('@')[0],
    '日付': Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
  });
  let template;
  try {
    template = DriveApp.getFileById(t.docId);
  } catch (err) {
    throw flowError_('テンプレート「' + t.name + '」を開けません（テンプレートを閲覧できるように共有してください）', err);
  }
  let copy;
  try {
    copy = template.makeCopy(name, DriveApp.getFolderById(folders.draft));
  } catch (err) {
    throw flowError_('テンプレート「' + t.name + '」をコピーできません（保存先フォルダを編集できる必要があります）', err);
  }
  setFlowProps_(copy.getId(), { pdFlow: '1', pdCreator: me, pdTemplate: t.id });
  return { id: copy.getId(), name: copy.getName(), url: copy.getUrl() };
}

function getFlowFile_(fileId, folders) {
  if (!/^[\w-]{20,}$/.test(String(fileId))) throw new UserError('書類の指定が正しくありません');
  let file;
  try {
    file = Drive.Files.get(String(fileId), { fields: 'id,name,webViewLink,parents,appProperties', supportsAllDrives: true });
  } catch (err) {
    throw flowError_('書類を開けません（削除されたか、権限がない可能性があります）', err);
  }
  const status = statusOfParents_(file.parents, folders);
  if (!status) throw new UserError('この書類は、このウィジェットの保存先にありません');
  file.status = status;
  file.props = file.appProperties || {};
  return file;
}

/** ファイルに記録（appProperties）を書き込む */
function setFlowProps_(fileId, props) {
  try {
    Drive.Files.update({ appProperties: props }, fileId, null, { supportsAllDrives: true, fields: 'id' });
  } catch (err) {
    throw flowError_('書類に記録を書き込めません（書類の編集者である必要があります）', err);
  }
}

/** 書類をステータスのフォルダへ移し、記録を書き込む */
function moveFlowFile_(file, folders, to, props) {
  try {
    DriveApp.getFileById(file.id).moveTo(DriveApp.getFolderById(folders[to]));
  } catch (err) {
    throw flowError_('書類を移動できません（保存先フォルダの編集者である必要があります）', err);
  }
  if (props) setFlowProps_(file.id, props);
}

/** ドキュメントにコメントを残す（経緯の記録。失敗しても処理は続ける） */
function flowComment_(fileId, text) {
  try {
    Drive.Comments.create({ content: text }, fileId, { fields: 'id' });
  } catch (err) {
    console.warn('comment failed: ' + err);
  }
}

/** 関係者にメールで知らせる（失敗しても処理は続ける） */
function flowNotify_(to, subject, lines) {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!list.length) return;
  try {
    MailApp.sendEmail({ to: list.join(','), subject: '[' + APP.title + '] ' + subject, body: lines.join('\n'), name: APP.title });
  } catch (err) {
    console.warn('mail failed: ' + err);
  }
}

function docflowSubmit_(ref, fileId, approversInput, message) {
  const cfg = docflowConfig_(ref);
  const me = userEmail_().toLowerCase();
  const folders = statusFolders_(cfg.folderId, true);
  const file = getFlowFile_(fileId, folders);
  if (file.status !== 'draft') throw new UserError('提出前の書類だけ提出できます');
  const creator = String(file.props.pdCreator || '').toLowerCase();
  if (creator && creator !== me) throw new UserError('提出できるのは、書類を作った人だけです');

  const t = cfg.templates.filter(function (x) { return x.id === file.props.pdTemplate; })[0];
  const approvers = t && t.approvers.length ? t.approvers : parseApprovers_(approversInput);
  if (!approvers.length) throw new UserError('承認者を指定してください（メールアドレス。グループも指定できます）');
  const note = String(message || '').trim().slice(0, 2000);

  const props = approverProps_(approvers);
  props.pdCreator = creator || me;
  props.pdSubmittedBy = me;
  props.pdSubmittedAt = new Date().toISOString();
  props.pdDecidedBy = null;
  props.pdDecidedAt = null;
  props.pdDecision = null;
  moveFlowFile_(file, folders, 'submitted', props);
  flowComment_(file.id, '【提出】' + me + ' が提出しました。\n承認者：' + approvers.join('、') + (note ? '\n\n' + note : ''));
  flowNotify_(approvers, '承認の依頼：' + file.name, [
    me + ' さんから、承認の依頼が届きました。',
    '',
    '書類：' + file.name,
    file.webViewLink,
    note ? '\nメッセージ：\n' + note : '',
    '',
    'ダッシュボードの書類ワークフローから、承認・差し戻し・拒否ができます。',
  ]);
}

const DOCFLOW_ACTIONS = {
  approve: { to: 'approved', label: '承認', needReason: false },
  return: { to: 'draft', label: '差し戻し', needReason: true },
  reject: { to: 'rejected', label: '拒否', needReason: true },
};

function docflowDecide_(ref, fileId, action, comment) {
  const act = DOCFLOW_ACTIONS[String(action)];
  if (!act) throw new UserError('操作の指定が正しくありません');
  const cfg = docflowConfig_(ref);
  const me = userEmail_().toLowerCase();
  const folders = statusFolders_(cfg.folderId, true);
  const file = getFlowFile_(fileId, folders);
  if (file.status !== 'submitted') throw new UserError('提出後の書類だけ、承認・差し戻し・拒否ができます');
  if (!isApprover_(readApprovers_(file.props), me, myGroupEmails_)) throw new UserError('この書類の承認者ではありません');
  const reason = String(comment || '').trim().slice(0, 2000);
  if (act.needReason && !reason) throw new UserError(act.label + 'の理由を書いてください');

  moveFlowFile_(file, folders, act.to, {
    pdDecidedBy: me,
    pdDecidedAt: new Date().toISOString(),
    pdDecision: String(action),
  });
  if (act.to === 'approved') {
    try {
      // 承認後は書き換えられないようにする（ドライブの「ロック」）
      Drive.Files.update({ contentRestrictions: [{ readOnly: true, reason: '承認済み（' + me + '）' }] }, file.id, null,
        { supportsAllDrives: true, fields: 'id' });
    } catch (err) {
      console.warn('lock failed: ' + err);
    }
  }
  flowComment_(file.id, '【' + act.label + '】' + me + ' が' + act.label + 'しました。' + (reason ? '\n\n' + reason : ''));
  const creator = String(file.props.pdCreator || '');
  flowNotify_(creator, act.label + '：' + file.name, [
    '提出した書類が' + act.label + 'されました（' + me + '）。',
    '',
    '書類：' + file.name,
    file.webViewLink,
    reason ? '\n' + act.label + 'の理由：\n' + reason : '',
  ]);
}

/** 提出を取り下げる（作成者が、判断の前に提出前へ戻す） */
function docflowWithdraw_(ref, fileId) {
  const cfg = docflowConfig_(ref);
  const me = userEmail_().toLowerCase();
  const folders = statusFolders_(cfg.folderId, true);
  const file = getFlowFile_(fileId, folders);
  if (file.status !== 'submitted') throw new UserError('提出後の書類だけ取り下げられます');
  if (String(file.props.pdCreator || '').toLowerCase() !== me) throw new UserError('取り下げられるのは、書類を作った人だけです');
  moveFlowFile_(file, folders, 'draft', { pdSubmittedAt: null, pdSubmittedBy: null });
  flowComment_(file.id, '【取り下げ】' + me + ' が提出を取り下げました。');
  flowNotify_(readApprovers_(file.props), '取り下げ：' + file.name, [
    me + ' さんが、承認を依頼していた書類の提出を取り下げました。',
    '',
    '書類：' + file.name,
    file.webViewLink,
  ]);
}
