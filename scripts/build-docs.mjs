import { readFile, writeFile } from 'node:fs/promises';
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const inline = text => escape(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
const lines = (await readFile('README.md', 'utf8')).split('\n');
let html = '', list = false, code = false;
for (const line of lines) {
  if (line.startsWith('```')) { if (list) { html += '</ul>'; list = false; } html += code ? '</code></pre>' : '<pre><code>'; code = !code; continue; }
  if (code) { html += escape(line) + '\n'; continue; }
  if (line.startsWith('- ')) { if (!list) html += '<ul>'; list = true; html += '<li>' + inline(line.slice(2)) + '</li>'; continue; }
  if (list) { html += '</ul>'; list = false; }
  const heading = line.match(/^(#{1,3}) (.+)$/);
  if (heading) html += `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
  else if (line.trim()) html += '<p>' + inline(line) + '</p>';
}
if (list) html += '</ul>';
await writeFile('README.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AURUM · 使用与方法</title><link rel="stylesheet" href="assets/fonts.css"><style>*{box-sizing:border-box}body{margin:0;background:#f2f1ed;color:#262a25;font:14px/1.95 'Noto Sans SC',sans-serif}main{max-width:900px;margin:70px auto;padding:0 28px 60px}h1,h2{font-family:'Noto Serif SC',serif;font-weight:500}h1{font-size:38px;line-height:1.5;margin:35px 0}h2{margin-top:42px;font-size:24px}p,li{color:#676c62}a{color:#95753c;text-underline-offset:4px}code{background:#dfded655;padding:2px 5px;font-size:12px;overflow-wrap:anywhere}pre{padding:18px;background:#e4e3dc;overflow:auto}pre code{padding:0;background:none}li{margin:9px 0}@media(max-width:600px){main{margin-top:30px}h1{font-size:28px}}</style><main><a href="index.html">← AURUM</a>${html}</main></html>\n`);
console.log('README.html updated.');
