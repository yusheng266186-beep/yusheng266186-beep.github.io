import {readFile,access} from 'node:fs/promises';import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
const html=await readFile('index.html','utf8'),app=await readFile('assets/app.js','utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]),set=new Set(ids);
if(set.size!==ids.length)throw new Error('Duplicate element IDs');
for(const m of app.matchAll(/\$\("([^"]+)"\)/g))if(!set.has(m[1]))throw new Error('Missing element: '+m[1]);
for(const path of ['assets/app.js','assets/core.js','assets/scene.js','assets/gold-world.js','assets/gold-geometry.js','scripts/fetch-market-snapshot.mjs','scripts/fetch-market-history.mjs','scripts/fetch-official-news.mjs','scripts/news-utils.mjs','scripts/build-embedded-data.mjs'])execFileSync(process.execPath,['--check',path]);
for(const path of ['data/market-history.json','data/market-snapshot.json','data/news.json'])JSON.parse(await readFile(path,'utf8'));
const visited=new Set();
async function checkModule(file){
  file=resolve(file);if(visited.has(file))return;visited.add(file);
  const source=await readFile(file,'utf8');
  for(const match of source.matchAll(/(?:import\s*\(\s*|from\s*)["'](\.[^"']+)["']/g))await checkModule(resolve(dirname(file),match[1]));
}
await checkModule('assets/gold-world.js');
await access('assets/environment/studio-small-03-1k.hdr');
for(const match of html.matchAll(/(?:src|href)="(assets\/[^"?#]+)"/g))await access(match[1]);
console.log('DOM references, syntax, data, and local sculpture dependencies verified.');
