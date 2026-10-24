import {readFile,access} from 'node:fs/promises';import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
const html=await readFile('index.html','utf8'),app=await readFile('assets/app.js','utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]),set=new Set(ids);
if(set.size!==ids.length)throw new Error('Duplicate element IDs');
for(const source of [app,await readFile('assets/journal-ui.js','utf8')])for(const m of source.matchAll(/\$\("([^"]+)"\)/g))if(!set.has(m[1]))throw new Error('Missing element: '+m[1]);
const {version}=JSON.parse(await readFile('package.json','utf8'));
for(const path of ['assets/core.js','assets/quant.js','assets/evidence.js','assets/app.js','assets/scene.js','assets/gold-world.js','assets/journal-ui.js','assets/research-journal.js','assets/cinematic.css','assets/layout.css'])if(!html.includes(path+'?v='+version+'"'))throw Error('Release entry version mismatch: '+path);
for(const match of html.matchAll(/(?:src|href)="(assets\/[^"?]+\.(?:js|css))(?:\?v=([^"&]+))?"/g))if(match[2]!==version)throw Error('Mixed release entries: '+match[1]);
for(const path of ['assets/app.js','assets/core.js','assets/quant.js','assets/evidence.js','assets/scene.js','assets/gold-world.js','assets/gold-geometry.js','assets/research-journal.js','assets/journal-ui.js','assets/render-policy.js','assets/gold-surface.js','assets/gold-worker.js','assets/prediction-worker.js','scripts/fetch-market-snapshot.mjs','scripts/fetch-market-history.mjs','scripts/fetch-official-news.mjs','scripts/news-utils.mjs','scripts/research-utils.mjs','scripts/build-prediction-ledger.mjs','scripts/ledger-utils.mjs','scripts/fetch-research-factors.mjs','scripts/quote-collector.mjs','scripts/build-embedded-data.mjs'])execFileSync(process.execPath,['--check',path]);
for(const path of ['data/market-history.json','data/market-snapshot.json','data/news.json','data/research-factors.json','data/forecast-ledger.json'])JSON.parse(await readFile(path,'utf8'));
const visited=new Set();
async function checkModule(file){
  file=resolve(file);if(visited.has(file))return;visited.add(file);
  const source=await readFile(file,'utf8');
  for(const match of source.matchAll(/(?:import\s*\(\s*|from\s*)["'](\.[^"']+)["']/g))await checkModule(resolve(dirname(file),match[1]));
}
await checkModule('assets/gold-world.js');
await access('assets/environment/studio-small-03-1k.hdr');
for(const match of html.matchAll(/(?:src|href)="(assets\/[^"?#]+)(?:[?#][^"]*)?"/g))await access(match[1]);
const fonts=await readFile('assets/fonts.css','utf8');
for(const match of fonts.matchAll(/url\(["']?([^\s)'"?#]+)/g))await access(resolve('assets',match[1]));
console.log('DOM references, syntax, data, local fonts, and sculpture dependencies verified.');
