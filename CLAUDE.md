# CLAUDE.md

Google Apps Script（GAS）の Web アプリ。personal-dashboard（GitHub Pages＋Firebase）の画面を移植し、
組織（全社・部署）の共通タブとお知らせを足したもの。仕様と導入手順は README.md。

## 構成の要点

- `src/` だけを clasp で push する（`.clasp.json` の `rootDir`）。ビルド工程はない
- サーバー：`main.js`（doGet）→ `api.js`（google.script.run の公開関数）→ `service_*.js`
  - 公開関数は `run_()` で包み、`{ ok, data } / { ok, error }` を返す。利用者に見せるエラーは `UserError`
  - 内部の関数は末尾 `_`（クライアントから呼べなくする）
  - 書き込みは `withLock_()` で排他。組織は ScriptLock、個人は UserLock
- データ
  - 組織の一覧：管理用スプレッドシート「組織」シート（Script Property `CONFIG_SPREADSHEET_ID`）
  - 組織のタブ：組織のスプレッドシートの `_dashboard` シート（A1＝版、A2 以降＝JSON を分割）
  - お知らせ：組織のスプレッドシートの「お知らせ」シート（列はヘッダー名で引く）
  - 自分のタブ・既読：UserProperties（`dash.v` / `dash.n` / `dash.0…`、`notice.read`）
  - 権限はスプレッドシートの共有設定がすべて（閲覧者＝見える、編集者＝編集できる）。Drive API の capabilities.canEdit で判定
- クライアント：`index.html` が `include_()` で CSS・JS を読み込む
  - 各 `js_*.html` は IIFE で、`PD.<名前>` に公開する（元の ES Modules の import / export を置き換えたもの）
  - `js_storage.html` が「組織のタブ＋自分のタブ」を 1 つのダッシュボードとして画面に渡し、保存時に分ける。
    組織のタブには `page.unit`（組織のスプレッドシート ID）が付く
  - `js_app.html` の `editMode`（編集モード）と `editing`（今のタブを編集できるか）を混同しない
- 書類ワークフロー（`service_docflow.js`）：ステータス＝保存先フォルダ内のサブフォルダ。作成者・承認者・判断の記録はファイルの appProperties（`pdCreator` / `pdApprover0…4` など）。
  ウィジェットの設定は、画面から受け取らず、サーバーが保存済みのダッシュボードから `ref`（`{ unit, widgetId }`）で読む
- 文言は `js_locale_ja.html` / `js_locale_en.html`。追加するときは両方に足す

## 落とし穴：テンプレート文字列の中に // を書かない

Apps Script は画面の HTML を書き出すときに `<script>` のコメントを消すが、テンプレート文字列（`…`）を
文字列として扱わないため、`https://…` のような `//` 以降が消えて構文エラーになる
（画面には見出しだけが出て止まる）。

- URL などを組み立てるときは、文字列の連結（`"https://…/" + id`）を使う
- 外部ライブラリは同じ理由で同梱できないので、`index.html` で CDN から読み込む（版を固定し、integrity 付き）
- `npm test` の `tests/html.test.js` が、同じ削除をかけてから構文を確かめる。`npm run preview` も同じ削除をかける

## 確かめ方

- `npm test`：サーバー側のテスト（GAS の機能を見本に置き換えて Node で実行）
- `npm run preview`：`dev/preview.html` を作る。`dev/mock.js` の見本データで画面を確かめられる
- 実際の動作は、`clasp push` してテスト用のデプロイ（デプロイ → デプロイをテスト）で確かめる
