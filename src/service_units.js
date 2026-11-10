/**
 * service_units.js — 組織（全社・部署）の一覧と、組織ごとのダッシュボード
 *
 * - 組織の一覧は、管理用スプレッドシートの「組織」シート（全員が閲覧できるように共有しておく）
 * - 組織ごとに 1 つのスプレッドシートがあり、
 *     「お知らせ」シート … お知らせ（service_notices.js）
 *     「_dashboard」シート … 組織のタブ（A1 に版、A2 以降に JSON を分割）
 * - 誰がどの組織を見られるか・編集できるかは、組織のスプレッドシートの共有設定で決まる
 *   （閲覧できる＝その組織のタブが見える、編集できる＝管理者）
 */

function configSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(APP.props.configId);
  if (!id) throw new UserError('初期設定がまだです。管理者の方は、Apps Script のエディタで setup を実行してください（README の手順 3）');
  try {
    return SpreadsheetApp.openById(id);
  } catch (err) {
    throw new UserError('管理用スプレッドシートを開けません。組織内の全員が「閲覧者」になるよう共有されているか確認してください（README の手順 4）');
  }
}

/** 組織の一覧（全員共通。スクリプトのキャッシュに入れる） */
function readUnitList_() {
  const cache = CacheService.getScriptCache();
  const cached = cacheGet_(cache, 'units:list');
  if (cached) return cached;

  const sheet = configSpreadsheet_().getSheetByName(APP.unitsSheet.name);
  if (!sheet) throw new UserError('管理用スプレッドシートに「' + APP.unitsSheet.name + '」シートがありません');
  const values = sheet.getDataRange().getValues();
  const col = columnMap_(values[0]);
  const units = [];
  values.slice(1).forEach(function (row, i) {
    const id = String(row[col['スプレッドシートID']] || '').trim();
    const name = String(row[col['名前']] || '').trim();
    if (!id || !name) return;
    const kind = APP.kinds.indexOf(String(row[col['種別']]).trim()) >= 0 ? String(row[col['種別']]).trim() : '部署';
    const order = Number(row[col['並び順']]);
    units.push({ id: id, name: name, kind: kind, order: isFinite(order) && row[col['並び順']] !== '' ? order : 1000 + i });
  });
  units.sort(function (a, b) {
    return (APP.kinds.indexOf(a.kind) - APP.kinds.indexOf(b.kind)) || (a.order - b.order);
  });
  cachePut_(cache, 'units:list', units, APP.cache.unitList);
  return units;
}

/** この人が見られる組織と、編集できるか（Drive の共有設定をそのまま使う。人ごとのキャッシュ） */
function accessibleUnits_(options) {
  const list = readUnitList_();
  const cache = CacheService.getUserCache();
  const signature = list.map(function (u) { return u.id; }).join(',');
  const cached = options && options.fresh ? null : cacheGet_(cache, 'units:access');
  let access = cached && cached.signature === signature ? cached.access : null;
  if (!access) {
    access = {};
    list.forEach(function (u) {
      try {
        const file = Drive.Files.get(u.id, { fields: 'id,capabilities(canEdit)', supportsAllDrives: true });
        access[u.id] = Boolean(file.capabilities && file.capabilities.canEdit);
      } catch (err) {
        // 共有されていない（見られない）組織は出さない
      }
    });
    cachePut_(cache, 'units:access', { signature: signature, access: access }, APP.cache.unitAccess);
  }
  return list.filter(function (u) { return u.id in access; }).map(function (u) {
    return { id: u.id, name: u.name, kind: u.kind, canEdit: access[u.id] };
  });
}

/** 組織 1 つ分の中身（ダッシュボードの JSON と版、お知らせ）。全員共通のキャッシュに入れる */
function readUnitData_(unitId) {
  const cache = CacheService.getScriptCache();
  const key = 'unit:' + unitId;
  const cached = cacheGet_(cache, key);
  if (cached) return cached;

  const ss = SpreadsheetApp.openById(unitId);
  const data = { json: null, version: null, notices: [] };

  const dash = ss.getSheetByName(APP.dashboardSheet.name);
  if (dash && dash.getLastRow() >= 2) {
    const col = dash.getRange(1, 1, dash.getLastRow(), 1).getValues();
    data.version = unwrapCell_(col[0][0]) || null;
    data.json = col.slice(1).map(function (r) { return unwrapCell_(r[0]); }).join('') || null;
  }
  const notices = ss.getSheetByName(APP.noticesSheet.name);
  if (notices) data.notices = readNoticeRows_(notices.getDataRange().getValues());

  cachePut_(cache, key, data, APP.cache.unitData);
  return data;
}

function forgetUnitData_(unitId) {
  cacheRemove_(CacheService.getScriptCache(), 'unit:' + unitId);
}

/** 登録されている組織か（任意のスプレッドシートを書き換えさせないため） */
function requireUnit_(unitId) {
  const unit = readUnitList_().filter(function (u) { return u.id === unitId; })[0];
  if (!unit) throw new UserError('その組織は見つかりません');
  return unit;
}

/**
 * 組織のタブを保存する。書き込めるかどうかは、スプレッドシートの共有設定（編集者か）で決まる。
 * @returns {{ version } | { conflict: true, json, version }}
 */
function writeUnitDashboard_(unitId, json, baseVersion) {
  requireUnit_(unitId);
  checkDashboardJson_(json);
  return withLock_(LockService.getScriptLock(), function () {
    let ss;
    try {
      ss = SpreadsheetApp.openById(unitId);
    } catch (err) {
      throw new UserError('この組織のスプレッドシートを開けません');
    }
    let sheet = ss.getSheetByName(APP.dashboardSheet.name);
    if (!sheet) sheet = createDashboardSheet_(ss);
    const current = sheet.getLastRow() >= 1 ? unwrapCell_(sheet.getRange(1, 1).getValue()) : '';
    if (current && current !== baseVersion) {
      forgetUnitData_(unitId);
      const latest = readUnitData_(unitId);
      return { conflict: true, json: latest.json, version: latest.version };
    }
    const version = newVersion_();
    const rows = [[wrapCell_(version)]].concat(chunk_(json, APP.limits.sheetChunkChars).map(function (p) { return [wrapCell_(p)]; }));
    try {
      sheet.getRange('A:A').clearContent();
      sheet.getRange(1, 1, rows.length, 1).setNumberFormat('@').setValues(rows);
    } catch (err) {
      throw new UserError('この組織のタブを編集する権限がありません（組織のスプレッドシートの編集者だけが編集できます）');
    }
    SpreadsheetApp.flush();
    forgetUnitData_(unitId);
    return { version: version };
  });
}

/*
 * セルに入れる文字は先頭に「|」を付ける。分けた JSON が「=」で始まる（数式になる）、
 * 数字や日付に見える（値が変わる）といったことを防ぐため。
 */
function wrapCell_(text) {
  return '|' + text;
}

function unwrapCell_(value) {
  const s = value == null ? '' : String(value);
  return s.charAt(0) === '|' ? s.slice(1) : s;
}

function createDashboardSheet_(ss) {
  const sheet = ss.insertSheet(APP.dashboardSheet.name);
  sheet.getRange('A1').setNote('ダッシュボードのデータです。手で書き換えないでください。');
  sheet.hideSheet();
  return sheet;
}
