/**
 * util.js — 汎用ヘルパー
 */

/** 利用者に見せるエラー（メッセージをそのまま画面に出す） */
class UserError extends Error {}

/** 公開関数の共通の包み：{ ok: true, data } / { ok: false, error } */
function run_(fn) {
  try {
    return { ok: true, data: fn() };
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return { ok: false, error: err instanceof UserError ? err.message : '処理に失敗しました（' + (err && err.message ? err.message : err) + '）' };
  }
}

function userEmail_() {
  return Session.getActiveUser().getEmail() || '';
}

function newId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

/** 保存のたびに変わる版の文字列 */
function newVersion_() {
  return new Date().toISOString() + '-' + Utilities.getUuid().slice(0, 6);
}

function chunk_(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [''];
}

/** JSON 文字列として正しいか、大きすぎないかを確かめる */
function checkDashboardJson_(json) {
  if (typeof json !== 'string' || !json) throw new UserError('保存する内容がありません');
  if (json.length > APP.limits.dashboardChars) throw new UserError('ダッシュボードが大きすぎて保存できません（写真やメモを減らしてください）');
  let data;
  try { data = JSON.parse(json); } catch (e) { throw new UserError('保存する内容の形式が正しくありません'); }
  if (!data || typeof data !== 'object' || !Array.isArray(data.pages)) throw new UserError('保存する内容の形式が正しくありません');
}

function withLock_(lock, fn) {
  if (!lock.tryLock(10000)) throw new UserError('ほかの保存と重なりました。少し待ってからもう一度お試しください');
  try { return fn(); } finally { lock.releaseLock(); }
}

/** ヘッダー名 → 列の位置 */
function columnMap_(headers) {
  const map = {};
  headers.forEach(function (h, i) { map[String(h).trim()] = i; });
  return map;
}

/** セルの値を YYYY-MM-DD に（空・読めないときは ''） */
function dateKey_(value) {
  if (value === '' || value == null) return '';
  const d = value instanceof Date ? value : new Date(String(value).replace(/\//g, '-'));
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function truthy_(value) {
  if (value === true) return true;
  const s = String(value).trim().toLowerCase();
  return ['true', '1', 'yes', 'はい', '重要', '○', '◯', 'y'].indexOf(s) >= 0;
}

/* ---------- キャッシュ（100KB を超える値は分けて入れる） ---------- */

const CACHE_CHUNK = 90000;

function cacheGet_(cache, key) {
  const head = cache.get(key);
  if (head == null) return null;
  if (head.indexOf('#chunks:') !== 0) return JSON.parse(head);
  const n = Number(head.slice(8));
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(key + '#' + i);
  const parts = cache.getAll(keys);
  let text = '';
  for (let i = 0; i < n; i++) {
    if (parts[keys[i]] == null) return null;
    text += parts[keys[i]];
  }
  return JSON.parse(text);
}

function cachePut_(cache, key, value, seconds) {
  const text = JSON.stringify(value);
  try {
    if (text.length <= CACHE_CHUNK) {
      cache.put(key, text, seconds);
      return;
    }
    const parts = chunk_(text, CACHE_CHUNK);
    const values = {};
    parts.forEach(function (p, i) { values[key + '#' + i] = p; });
    cache.putAll(values, seconds);
    cache.put(key, '#chunks:' + parts.length, seconds);
  } catch (err) {
    console.warn('cache put failed: ' + key + ' ' + err); // キャッシュに入らなくても動く
  }
}

function cacheRemove_(cache, key) {
  cache.remove(key);
}
