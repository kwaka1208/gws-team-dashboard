// 手元で画面を確かめるための、Apps Script（サーバー）の見本。dev/preview.mjs が index.html に埋め込む
window.MOCK_LOG = [];
(function () {
  const U1 = "1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAzen"; // 全社 (read only)
  const U2 = "1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBeigyo"; // 営業部 (editable)
  const db = {
    personal: { json: null, version: null },
    units: {
      [U1]: { name: "全社", kind: "全社", canEdit: false, version: "u1v", json: JSON.stringify({ pages: [{ id: "zp1", name: "全社", widgets: [
        { id: "zn", type: "notice", title: "お知らせ", size: "l", rows: 3, scope: U1 },
        { id: "zt", type: "todo", title: "全社 ToDo", size: "m", rows: 3, categories: [{ id: "c1", name: "全員" }], items: [{ id: "i1", text: "年末調整の書類を出す", done: false, categoryId: "c1" }] },
        { id: "zl", type: "links", title: "社内リンク", size: "m", rows: 2, view: "list", items: [{ id: "l1", title: "就業規則", url: "https://example.com/rules", icon: "", description: "" }] },
      ] }] }), notices: [
        { id: "n1", title: "年末年始の休業について", body: "12/29〜1/3 は休業です。\n\n- 緊急連絡は [こちら](https://example.com)", important: true, start: "", end: "", author: "admin@example.com", postedAt: "2026-11-09T01:00:00Z" },
        { id: "n2", title: "健康診断の受付が始まりました", body: "総務までご連絡ください。", important: false, start: "", end: "2026-12-01", author: "soumu@example.com", postedAt: "2026-11-05T01:00:00Z" },
      ] },
      [U2]: { name: "営業部", kind: "部署", canEdit: true, json: null, version: null, notices: [
        { id: "n3", title: "週次定例は木曜 10 時に変更", body: "", important: false, start: "", end: "", author: "boss@example.com", postedAt: "2026-11-08T01:00:00Z" },
      ] },
    },
    read: [],
  };
  let seq = 0;
  const ver = () => `v${++seq}`;
  function notices() {
    return Object.entries(db.units).flatMap(([id, u]) => u.notices.map((n) => ({ ...n, id: `${id}:${n.id}`, noticeId: n.id, unitId: id, unitName: u.name })));
  }
  function load() {
    return {
      user: { email: "taro@example.com" },
      title: "チームダッシュボード",
      personal: { ...db.personal },
      units: Object.entries(db.units).map(([id, u]) => ({ id, name: u.name, kind: u.kind, canEdit: u.canEdit, json: u.json, version: u.version })),
      notices: notices(),
      noticeRead: db.read.slice(),
    };
  }
  const ok = (data) => new Promise((r) => setTimeout(() => r({ ok: true, data }), 30));
  window.PD_MOCK = {
    api_load: () => ok(load()),
    api_savePersonal: (json, base) => {
      MOCK_LOG.push(["savePersonal", json.length, base]);
      if (db.personal.version && db.personal.version !== base) return ok({ conflict: true, ...db.personal });
      db.personal = { json, version: ver() };
      return ok({ version: db.personal.version });
    },
    api_saveUnit: (id, json, base) => {
      MOCK_LOG.push(["saveUnit", id, base]);
      const u = db.units[id];
      if (!u.canEdit) return ok(null).then(() => ({ ok: false, error: "権限がありません" }));
      if (u.version && u.version !== base) return ok({ conflict: true, json: u.json, version: u.version });
      u.json = json; u.version = ver();
      return ok({ version: u.version });
    },
    api_postNotice: (id, n) => {
      MOCK_LOG.push(["postNotice", id, n.title]);
      db.units[id].notices.unshift({ id: `p${++seq}`, ...n, author: "taro@example.com", postedAt: new Date().toISOString() });
      return ok(notices());
    },
    api_deleteNotice: (id, nid) => {
      MOCK_LOG.push(["deleteNotice", id, nid]);
      db.units[id].notices = db.units[id].notices.filter((n) => n.id !== nid);
      return ok(notices());
    },
    api_markNoticesRead: (ids) => { MOCK_LOG.push(["read", ids]); db.read.push(...ids); return ok(db.read); },
    api_calendar: () => {
      const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0);
      const e = new Date(d); e.setHours(e.getHours() + 1);
      return ok([{ id: "c1", title: "営業会議", start: { dateTime: d.toISOString() }, end: { dateTime: e.toISOString() }, link: "", location: "", meet: "https://meet.google.com/x", color: "#4285f4", calendar: "" }]);
    },
    api_gmail: () => ok({ unreadMessages: 12, unreadThreads: 9 }),
  };
  window.MOCK_DB = db;
})();
