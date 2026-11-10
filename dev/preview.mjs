// 手元のブラウザで画面を確かめるためのプレビューを作る（Apps Script にデプロイしなくても見られる）
//   node dev/preview.mjs  →  dev/preview.html をブラウザで開く
// サーバーの代わりに dev/mock.js（見本のデータ）を使う。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");
let html = fs.readFileSync(path.join(src, "index.html"), "utf8");
html = html.replace(/<\?!= include_\('(\w+)'\); \?>/g, (_, name) => fs.readFileSync(path.join(src, `${name}.html`), "utf8"));
html = html.replace("<?!= bootJson ?>", "null");
const mock = fs.readFileSync(path.join(root, "dev", "mock.js"), "utf8");
html = html.replace("<head>", `<head>\n<script>\n${mock}\n</script>`);
fs.writeFileSync(path.join(root, "dev", "preview.html"), html);
console.log("dev/preview.html を作りました");
