import {readFile} from 'node:fs/promises';import {execFileSync} from 'node:child_process';
const html=await readFile('index.html','utf8'),app=await readFile('assets/app.js','utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]),set=new Set(ids);
if(set.size!==ids.length)throw new Error('Duplicate element IDs');
for(const m of app.matchAll(/\$\("([^"]+)"\)/g))if(!set.has(m[1]))throw new Error('Missing element: '+m[1]);
for(const path of ['assets/app.js','assets/core.js','assets/scene.js','scripts/fetch-market-snapshot.mjs','scripts/fetch-market-history.mjs','scripts/fetch-official-news.mjs','scripts/news-utils.mjs','scripts/build-embedded-data.mjs'])execFileSync(process.execPath,['--check',path]);
for(const path of ['data/market-history.json','data/market-snapshot.json','data/news.json'])JSON.parse(await readFile(path,'utf8'));
console.log('DOM references, syntax, and data files verified.');
