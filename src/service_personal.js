/**
 * service_personal.js — 個人のダッシュボード（自分のタブ）とお知らせの既読
 *
 * 保存先は、その人の UserProperties（このアプリ専用で、本人しか読めない）。
 * 1 つの値は 9KB までなので、JSON を分けて dash.0, dash.1 … に入れる。
 */

const PERSONAL_KEYS = { version: 'dash.v', count: 'dash.n', prefix: 'dash.', read: 'notice.read' };

function readPersonal_() {
  const props = PropertiesService.getUserProperties().getProperties();
  const n = Number(props[PERSONAL_KEYS.count] || 0);
  if (!n) return { json: null, version: null };
  let json = '';
  for (let i = 0; i < n; i++) json += props[PERSONAL_KEYS.prefix + i] || '';
  return { json: json, version: props[PERSONAL_KEYS.version] || null };
}

/**
 * 保存する。baseVersion が今の版と違えば（別の端末で先に保存された）、保存せずに今の内容を返す。
 * @returns {{ version: string } | { conflict: true, json: string, version: string }}
 */
function writePersonal_(json, baseVersion) {
  checkDashboardJson_(json);
  return withLock_(LockService.getUserLock(), function () {
    const store = PropertiesService.getUserProperties();
    const current = store.getProperty(PERSONAL_KEYS.version);
    if (current && current !== baseVersion) {
      const latest = readPersonal_();
      return { conflict: true, json: latest.json, version: latest.version };
    }
    const oldCount = Number(store.getProperty(PERSONAL_KEYS.count) || 0);
    const parts = chunk_(json, APP.limits.propChunkChars);
    const version = newVersion_();
    const values = {};
    parts.forEach(function (p, i) { values[PERSONAL_KEYS.prefix + i] = p; });
    values[PERSONAL_KEYS.count] = String(parts.length);
    values[PERSONAL_KEYS.version] = version;
    store.setProperties(values);
    for (let i = parts.length; i < oldCount; i++) store.deleteProperty(PERSONAL_KEYS.prefix + i);
    return { version: version };
  });
}

function readNoticeRead_() {
  try {
    const ids = JSON.parse(PropertiesService.getUserProperties().getProperty(PERSONAL_KEYS.read) || '[]');
    return Array.isArray(ids) ? ids.map(String) : [];
  } catch (e) {
    return [];
  }
}

/** 既読にしたお知らせの ID を足す（古いものから捨てて、上限の件数に収める） */
function addNoticeRead_(ids) {
  if (!Array.isArray(ids)) throw new UserError('既読にするお知らせの指定が正しくありません');
  const clean = ids.map(String).filter(function (id) { return /^[\w:.-]{1,80}$/.test(id); });
  return withLock_(LockService.getUserLock(), function () {
    const list = readNoticeRead_().filter(function (id) { return clean.indexOf(id) < 0; }).concat(clean);
    const kept = list.slice(-APP.limits.noticeReadIds);
    PropertiesService.getUserProperties().setProperty(PERSONAL_KEYS.read, JSON.stringify(kept));
    return kept;
  });
}
