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
await writeFile('README.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#080909"><title>AURUM · 使用与方法</title><link rel="stylesheet" href="assets/fonts.css"><link rel="stylesheet" href="assets/styles.css"><link rel="stylesheet" href="assets/cinematic.css"><style>main.doc{position:relative;z-index:1;max-width:950px;margin:35px auto 0;padding:30px 36px 90px;background:#080d08ad}.doc h1{font-size:42px;line-height:1.5;margin:20px 0 35px}.doc h2{margin-top:44px;font-size:26px;color:#dfc995}.doc p,.doc li{color:#b6c0a7;font-size:13px;line-height:2.1}.doc p{margin:14px 0}.doc a{color:#d5b981;text-decoration:underline;text-underline-offset:4px}.doc code{background:#b5b57710;padding:2px 5px;font-size:12px;overflow-wrap:anywhere}.doc pre{padding:18px;background:#11190f;border:1px solid #b6b57532;overflow:auto}.doc pre code{padding:0;background:none}.doc li{margin:9px 0}.doc-topbar{position:sticky;z-index:5}.doc-topbar>a:last-child{font-size:12px;color:#c9b47c}.doc-topbar .header-tools{margin-left:auto}@media(max-width:600px){main.doc{margin-top:0;padding:25px 24px 60px}.doc h1{font-size:29px}.doc h2{font-size:23px}.doc p,.doc li{font-size:12px}}</style><body data-chapter="intelligence"><div class="gold-world" id="goldWorld" aria-hidden="true" data-scene="intelligence"><img class="world-poster" src="assets/gold-sculpture-master.png" alt="" width="1672" height="941"><canvas class="world-canvas"></canvas><div class="world-shade"></div></div><header class="topbar doc-topbar"><a class="brand" href="index.html"><span><strong>AURUM</strong><small>使用与方法</small></span></a><div class="header-tools"><button class="icon-button" type="button" id="motionToggle" aria-label="减少动态效果" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="m12 3-2 6-6 3 6 2 2 7 2-7 6-2-6-3Z"></path></svg></button></div><a href="index.html">返回市场 ↗</a></header><main class="doc">${html}</main><script src="assets/gold-geometry.js"></script><script src="assets/gold-world.js"></script></body></html>\n`);
console.log('README.html updated.');
