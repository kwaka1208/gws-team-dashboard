// Apps Script（HtmlService）が画面の HTML を書き出すときの「コメントの削除」をまねる。
// 文字列（' "）とエスケープは区別するが、テンプレート文字列（`）は区別しない。
// そのため `https://…` のように、テンプレート文字列の中の // 以降が消えてしまう。
function stripLikeGas(code) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < code.length) {
    const c = code[i];
    if (quote) {
      out += c;
      if (c === "\\") { out += code[i + 1] ?? ""; i += 2; continue; }
      if (c === quote || c === "\n") quote = null;
      i += 1;
      continue;
    }
    if (c === "\\") { out += c + (code[i + 1] ?? ""); i += 2; continue; }
    if (c === "'" || c === '"') { quote = c; out += c; i += 1; continue; }
    if (c === "/" && code[i + 1] === "/") { while (i < code.length && code[i] !== "\n") i += 1; continue; }
    if (c === "/" && code[i + 1] === "*") { const end = code.indexOf("*/", i + 2); i = end < 0 ? code.length : end + 2; continue; }
    out += c;
    i += 1;
  }
  return out;
}

/** HTML の中の <script>（src のないもの）に stripLikeGas をかける */
function stripScripts(html) {
  return html.replace(/<script>([\s\S]*?)<\/script>/g, (_, code) => `<script>${stripLikeGas(code)}</script>`);
}

module.exports = { stripLikeGas, stripScripts };
