/**
 * main.js — Web アプリの入り口
 *
 * デプロイの設定（appsscript.json と同じ）
 *   次のユーザーとして実行：ウェブアプリケーションにアクセスしているユーザー
 *   アクセスできるユーザー：組織内の全員
 */

function doGet() {
  const template = HtmlService.createTemplateFromFile('index');
  // 最初の表示に必要なデータを埋め込んで、開いてからの往復を 1 回減らす
  template.bootJson = scriptJson_(run_(function () { return loadAll_({}); }));
  return template.evaluate()
    .setTitle(APP.title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // Google サイトに埋め込めるように
}

/** index.html から、ほかのファイル（CSS・JS）を読み込む */
function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** <script> の中に安全に書ける JSON（</script> などで途切れないよう < をエスケープ） */
function scriptJson_(value) {
  const LS = new RegExp(String.fromCharCode(0x2028), 'g'); // 行区切り文字（JSON では使えるが、古い JS では文字列を途切れさせる）
  const PS = new RegExp(String.fromCharCode(0x2029), 'g');
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(LS, '\\u2028')
    .replace(PS, '\\u2029');
}
