import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
export const modelFiles=['assets/core.js','assets/quant.js','assets/evidence.js','assets/adaptive-model.js','assets/research-engine.js','scripts/research-utils.mjs'];
export async function modelIdentity(){return createHash('sha256').update((await Promise.all(modelFiles.map(p=>readFile(p)))).map(b=>b.toString()).join('\n')).digest('hex');}
