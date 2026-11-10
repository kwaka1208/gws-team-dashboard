/**
 * api.js — 画面（google.script.run）から呼ぶ関数
 *
 * どれも { ok: true, data } か { ok: false, error: '画面に出すメッセージ' } を返す。
 * 入力の確認 → サービスの呼び出し だけを行い、処理は service_*.js に置く。
 */

/** 画面に必要なものをまとめて返す（開いたとき・定期的な読み直しのとき） */
function api_load(options) {
  return run_(function () { return loadAll_(options || {}); });
}

function loadAll_(options) {
  const units = accessibleUnits_({ fresh: Boolean(options.fresh) });
  const notices = [];
  const unitData = units.map(function (u) {
    let data;
    try {
      data = readUnitData_(u.id);
    } catch (err) {
      console.warn('unit read failed: ' + u.id + ' ' + err);
      data = { json: null, version: null, notices: [], error: true };
    }
    data.notices.forEach(function (n) {
      notices.push(Object.assign({}, n, { id: u.id + ':' + n.id, noticeId: n.id, unitId: u.id, unitName: u.name }));
    });
    return { id: u.id, name: u.name, kind: u.kind, canEdit: u.canEdit, json: data.json, version: data.version };
  });
  return {
    user: { email: userEmail_() },
    title: APP.title,
    personal: readPersonal_(),
    units: unitData,
    notices: notices,
    noticeRead: readNoticeRead_(),
  };
}

function api_savePersonal(json, baseVersion) {
  return run_(function () { return writePersonal_(json, baseVersion || null); });
}

function api_saveUnit(unitId, json, baseVersion) {
  return run_(function () { return writeUnitDashboard_(String(unitId), json, baseVersion || null); });
}

/** お知らせを投稿して、見られるお知らせ全部を返す */
function api_postNotice(unitId, notice) {
  return run_(function () {
    postNotice_(String(unitId), notice);
    return loadAll_({}).notices;
  });
}

/** お知らせを消して、見られるお知らせ全部を返す */
function api_deleteNotice(unitId, noticeId) {
  return run_(function () {
    deleteNotice_(String(unitId), String(noticeId));
    return loadAll_({}).notices;
  });
}

function api_markNoticesRead(ids) {
  return run_(function () { return addNoticeRead_(ids); });
}

function api_calendar(params) {
  return run_(function () { return calendarEvents_(params || {}); });
}

function api_gmail(labelId) {
  return run_(function () { return gmailUnread_(labelId); });
}
