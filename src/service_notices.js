/**
 * service_notices.js — お知らせ
 *
 * 組織のスプレッドシートの「お知らせ」シートに 1 行 1 件で入れる。
 * 管理者は、画面のお知らせウィジェットから投稿するほか、シートに直接 1 行足してもよい
 * （ID が空の行も表示する。掲載開始・掲載終了は空なら期限なし）。
 */

/** シートの値 → 掲載中のお知らせ（新しい順） */
function readNoticeRows_(values) {
  if (!values.length) return [];
  const col = columnMap_(values[0]);
  const today = dateKey_(new Date());
  const get = function (row, name) { return name in col ? row[col[name]] : ''; };
  const list = [];
  values.slice(1).forEach(function (row) {
    const title = String(get(row, 'タイトル') || '').trim();
    if (!title) return;
    const start = dateKey_(get(row, '掲載開始'));
    const end = dateKey_(get(row, '掲載終了'));
    if ((start && start > today) || (end && end < today)) return;
    const posted = get(row, '投稿日時');
    const postedAt = posted instanceof Date ? posted.toISOString() : (posted ? String(posted) : '');
    list.push({
      id: noticeRowId_(row, col),
      title: title,
      body: String(get(row, '本文') || ''),
      important: truthy_(get(row, '重要')),
      start: start,
      end: end,
      author: String(get(row, '投稿者') || ''),
      postedAt: postedAt,
    });
  });
  list.sort(function (a, b) {
    const ka = a.postedAt || a.start;
    const kb = b.postedAt || b.start;
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });
  return list;
}

/** 行の ID。シートに直接足した行（ID が空）は、内容から決める */
function noticeRowId_(row, col) {
  const id = String(row[col['ID']] || '').trim();
  if (id) return id;
  const source = ['タイトル', '本文', '掲載開始', '投稿日時'].map(function (n) { return n in col ? String(row[col[n]]) : ''; }).join('\u0000');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, source, Utilities.Charset.UTF_8);
  return 'h' + digest.slice(0, 8).map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

function noticesSheet_(unitId) {
  requireUnit_(unitId);
  let ss;
  try {
    ss = SpreadsheetApp.openById(unitId);
  } catch (err) {
    throw new UserError('この組織のスプレッドシートを開けません');
  }
  let sheet = ss.getSheetByName(APP.noticesSheet.name);
  if (!sheet) {
    sheet = ss.insertSheet(APP.noticesSheet.name, 0);
    sheet.appendRow(APP.noticesSheet.headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function validateNotice_(n) {
  if (!n || typeof n !== 'object') throw new UserError('お知らせの内容がありません');
  const title = String(n.title || '').trim();
  const body = String(n.body || '');
  if (!title) throw new UserError('タイトルを入れてください');
  if (title.length > APP.limits.noticeTitle) throw new UserError('タイトルは ' + APP.limits.noticeTitle + ' 文字までです');
  if (body.length > APP.limits.noticeBody) throw new UserError('本文は ' + APP.limits.noticeBody + ' 文字までです');
  const date = function (v) {
    if (!v) return '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new UserError('日付は YYYY-MM-DD の形で入れてください');
    return String(v);
  };
  const start = date(n.start);
  const end = date(n.end);
  if (start && end && end < start) throw new UserError('掲載終了日は、掲載開始日より後にしてください');
  return { title: title, body: body, important: Boolean(n.important), start: start, end: end };
}

function postNotice_(unitId, input) {
  const n = validateNotice_(input);
  return withLock_(LockService.getScriptLock(), function () {
    const sheet = noticesSheet_(unitId);
    const col = columnMap_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
    const row = new Array(Object.keys(col).length).fill('');
    const set = function (name, value) { if (name in col) row[col[name]] = value; };
    set('ID', newId_());
    set('タイトル', n.title);
    set('本文', n.body);
    set('重要', n.important);
    set('掲載開始', n.start);
    set('掲載終了', n.end);
    set('投稿者', userEmail_());
    set('投稿日時', new Date());
    try {
      sheet.appendRow(row);
    } catch (err) {
      throw new UserError('この組織にお知らせを投稿する権限がありません（組織のスプレッドシートの編集者だけが投稿できます）');
    }
    SpreadsheetApp.flush();
    forgetUnitData_(unitId);
  });
}

function deleteNotice_(unitId, noticeId) {
  return withLock_(LockService.getScriptLock(), function () {
    const sheet = noticesSheet_(unitId);
    const values = sheet.getDataRange().getValues();
    const col = columnMap_(values[0]);
    for (let i = values.length - 1; i >= 1; i--) {
      if (noticeRowId_(values[i], col) === String(noticeId)) {
        try {
          sheet.deleteRow(i + 1);
        } catch (err) {
          throw new UserError('このお知らせを削除する権限がありません');
        }
        SpreadsheetApp.flush();
        forgetUnitData_(unitId);
        return;
      }
    }
    throw new UserError('お知らせが見つかりません（すでに削除されたかもしれません）');
  });
}
