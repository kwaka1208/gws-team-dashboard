// サーバー（src/*.js）のテスト。Apps Script の機能は最低限の見本に置き換えて Node で動かす：npm test
const fs = require("fs"); const vm = require("vm"); const crypto = require("crypto");
const src = require("path").join(__dirname, "..", "src") + "/";
function makeCache() { const m = new Map(); return { get: (k) => m.has(k) ? m.get(k) : null, put: (k, v) => m.set(k, v), putAll: (o) => Object.entries(o).forEach(([k, v]) => m.set(k, v)), getAll: (ks) => Object.fromEntries(ks.filter((k) => m.has(k)).map((k) => [k, m.get(k)])), remove: (k) => m.delete(k), _m: m }; }
function makeProps() { const m = {}; return { getProperties: () => ({ ...m }), getProperty: (k) => (k in m ? m[k] : null), setProperty: (k, v) => { m[k] = String(v); }, setProperties: (o) => Object.assign(m, o), deleteProperty: (k) => delete m[k], _m: m }; }
const userProps = makeProps(), scriptProps = makeProps(), scriptCache = makeCache(), userCache = makeCache();
const lock = { tryLock: () => true, releaseLock: () => {} };
const ctx = {
  // エラーの経路もテストするので、run_() が出すエラーログは表示しない
  console: { ...console, error: () => {}, warn: () => {} }, Date, JSON, Math, Object, Array, String, Number, Boolean, isNaN, isFinite, Error,
  Session: { getActiveUser: () => ({ getEmail: () => "taro@example.com" }), getScriptTimeZone: () => "Asia/Tokyo" },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    formatDate: (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10),
    computeDigest: (_a, s) => [...crypto.createHash("md5").update(s).digest()].map((b) => (b > 127 ? b - 256 : b)),
    DigestAlgorithm: { MD5: "md5" }, Charset: { UTF_8: "utf8" },
  },
  PropertiesService: { getUserProperties: () => userProps, getScriptProperties: () => scriptProps },
  CacheService: { getScriptCache: () => scriptCache, getUserCache: () => userCache },
  LockService: { getUserLock: () => lock, getScriptLock: () => lock },
};
vm.createContext(ctx);
for (const f of ["config.js", "util.js", "service_personal.js", "service_notices.js", "service_units.js", "service_docflow.js", "api.js", "main.js"]) {
  vm.runInContext(fs.readFileSync(src + f, "utf8"), ctx, { filename: f });
}
const assert = require("assert");
const r = (code) => { const v = vm.runInContext(code, ctx); return v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v; };

// personal storage: chunking with Japanese, conflict
const big = JSON.stringify({ version: 2, pages: [{ id: "a", name: "あ".repeat(10000), widgets: [] }] });
let res = r(`api_savePersonal(${JSON.stringify(big)}, null)`);
assert(res.ok, JSON.stringify(res));
const v1 = res.data.version;
assert.strictEqual(r("readPersonal_().json"), big);
const maxBytes = Math.max(...Object.entries(userProps._m).filter(([k]) => /^dash\.\d+$/.test(k)).map(([, v]) => Buffer.byteLength(v)));
assert(maxBytes < 9000, "chunk too large " + maxBytes);
res = r(`api_savePersonal(${JSON.stringify(JSON.stringify({ pages: [] }))}, "stale")`);
assert(res.ok && res.data.conflict && res.data.version === v1, "conflict expected");
res = r(`api_savePersonal(${JSON.stringify(JSON.stringify({ pages: [] }))}, ${JSON.stringify(v1)})`);
assert(res.ok && !res.data.conflict);
assert.strictEqual(r("readPersonal_().json"), JSON.stringify({ pages: [] }));
assert(!("dash.4" in userProps._m), "old chunks should be removed");
res = r(`api_savePersonal("not json", null)`);
assert(!res.ok && /形式/.test(res.error));

// notices parsing
const now = new Date();
const rows = [["ID", "タイトル", "本文", "重要", "掲載開始", "掲載終了", "投稿者", "投稿日時"],
  ["a1", "公開中", "本文", true, "", "", "x@y", new Date("2026-11-01T00:00:00Z")],
  ["", "シートに直接", "", "はい", "", "", "", ""],
  ["a3", "期限切れ", "", false, "", new Date("2020-01-01"), "", ""],
  ["a4", "未来", "", false, new Date(now.getTime() + 10 * 86400e3), "", "", ""],
  ["a5", "", "タイトルなし", false, "", "", "", ""]];
ctx.__rows = rows;
const list = r("readNoticeRows_(__rows)");
assert.deepStrictEqual(list.map((n) => n.title).sort(), ["シートに直接", "公開中"].sort());
const direct = list.find((n) => n.title === "シートに直接");
assert(/^h[0-9a-f]{16}$/.test(direct.id) && direct.important === true, JSON.stringify(direct));
assert.strictEqual(r("readNoticeRows_(__rows)").find((n) => n.title === "シートに直接").id, direct.id, "stable id");

// validation
assert.throws(() => r(`validateNotice_({ title: "" })`));
assert.throws(() => r(`validateNotice_({ title: "a", start: "2026-12-10", end: "2026-12-01" })`));
assert.throws(() => r(`validateNotice_({ title: "a", end: "12/01" })`));
assert.strictEqual(r(`validateNotice_({ title: " a ", important: 1 })`).important, true);

// cache chunking
ctx.__big = { s: "x".repeat(250000) };
r(`cachePut_(CacheService.getScriptCache(), "k", __big, 60)`);
assert.strictEqual(r(`cacheGet_(CacheService.getScriptCache(), "k").s.length`), 250000);

// script-safe json
const out = r(`scriptJson_({ a: "</script><b>", b: "x" + String.fromCharCode(0x2028) + "y" })`);
assert(!out.includes("</script>") && !out.includes(" "), out);
assert.deepStrictEqual(JSON.parse(out), { a: "</script><b>", b: "x y" });

// read state
res = r(`api_markNoticesRead(["u:1", "u:2", "bad id!"])`);
assert.deepStrictEqual(res.data, ["u:1", "u:2"]);
res = r(`api_markNoticesRead(["u:2", "u:3"])`);
assert.deepStrictEqual(res.data, ["u:1", "u:2", "u:3"]);

// not configured → friendly error
res = r(`api_load({})`);
assert(!res.ok && /setup/.test(res.error), JSON.stringify(res));
// sheet cell wrapping
assert.strictEqual(r(`unwrapCell_(wrapCell_("=SUM(A1)"))`), "=SUM(A1)");
assert.strictEqual(r(`wrapCell_("123")`), "|123");
assert.strictEqual(r(`unwrapCell_("")`), "");
// 書類ワークフロー：URL から ID、承認者の解析、書類名、承認者の判定、ステータス
assert.strictEqual(r(`driveIdFromUrl_("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/edit")`), "1AbCdEfGhIjKlMnOpQrStUv");
assert.strictEqual(r(`driveIdFromUrl_("https://drive.google.com/drive/folders/1FolderIdAbCdEfGhIjKlMn?usp=sharing")`), "1FolderIdAbCdEfGhIjKlMn");
assert.strictEqual(r(`driveIdFromUrl_("https://example.com/")`), "");
assert.deepStrictEqual(r(`parseApprovers_("Boss@Example.com, ops@example.com、bad, ops@example.com")`), ["boss@example.com", "ops@example.com"]);
assert.strictEqual(r(`parseApprovers_("a@x.jp b@x.jp c@x.jp d@x.jp e@x.jp f@x.jp").length`), 5);
assert.strictEqual(r(`buildDocName_("{件名}_{作成者}_{日付}", { "件名": "12/24 休暇", "作成者": "taro", "日付": "2026-11-10" })`), "12_24 休暇_taro_2026-11-10");
assert.strictEqual(r(`buildDocName_("{件名}_{作成者}", { "件名": "", "作成者": "", "テンプレート": "休暇申請" })`), "休暇申請");
assert.strictEqual(r(`isApprover_(["boss@x.jp"], "boss@x.jp", function () { throw new Error("no need"); })`), true);
assert.strictEqual(r(`isApprover_(["team@x.jp"], "taro@x.jp", function () { return ["team@x.jp"]; })`), true);
assert.strictEqual(r(`isApprover_([], "taro@x.jp", function () { return []; })`), false);
assert.strictEqual(r(`statusOfParents_(["s1"], { draft: "d1", submitted: "s1" })`), "submitted");
assert.strictEqual(r(`statusOfParents_(["zz"], { draft: "d1" })`), null);
assert.deepStrictEqual(r(`readApprovers_(approverProps_(["a@x.jp", "b@x.jp"]))`), ["a@x.jp", "b@x.jp"]);
// 設定はサーバーが保存済みのダッシュボードから読む（自分のタブ）
userProps._m["dash.n"] = "1";
userProps._m["dash.0"] = JSON.stringify({ pages: [{ id: "p", widgets: [{ id: "w1", type: "docflow", folder: "https://drive.google.com/drive/folders/1FolderIdAbCdEfGhIjKlMn", templates: [{ id: "t1", name: "休暇", url: "https://docs.google.com/document/d/1TemplateAbCdEfGhIjKlMn/edit", approvers: "boss@x.jp" }, { id: "t2", url: "nope" }] }] }] });
const cfg = r(`docflowConfig_({ unit: null, widgetId: "w1" })`);
assert.strictEqual(cfg.folderId, "1FolderIdAbCdEfGhIjKlMn");
assert.deepStrictEqual(cfg.templates.map((x) => [x.id, x.docId, x.approvers]), [["t1", "1TemplateAbCdEfGhIjKlMn", ["boss@x.jp"]]]);
assert.throws(() => r(`docflowConfig_({ unit: null, widgetId: "missing" })`), /見つかりません/);
console.log("server tests passed");
