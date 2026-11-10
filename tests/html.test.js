// 画面の JS が、Apps Script の書き出し（コメントの削除）で壊れないかを確かめる：npm test
// 各 js_*.html の <script> に、Apps Script と同じようにコメントの削除をかけてから、構文を確かめる。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { stripLikeGas } = require("./gas-html.js");

const src = path.join(__dirname, "..", "src");
let failed = 0;
for (const name of fs.readdirSync(src).filter((f) => /\.html$/.test(f))) {
  // テンプレートの差し込み（<?!= … ?>）は、実際には値が入るので null に置き換えて確かめる
  const html = fs.readFileSync(path.join(src, name), "utf8").replace(/<\?!=[\s\S]*?\?>/g, "null");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  scripts.forEach((code, i) => {
    try {
      new vm.Script(stripLikeGas(code), { filename: `${name}#${i + 1}` });
    } catch (err) {
      failed += 1;
      console.error(`${name}（${i + 1} 番目の <script>）：${err.message}`);
      console.error("  テンプレート文字列（`…`）の中に // や /* がないか確かめてください。文字列の連結（\"…\" + x）に書き換えると直ります。");
    }
  });
}
if (failed) process.exit(1);
console.log("html tests passed");
