import {createHash} from 'node:crypto';
import {readFile, rename, writeFile} from 'node:fs/promises';

export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

export async function writeJson(path, value) {
  const encoded = JSON.stringify(value) + '\n';
  const previous = await readFile(path, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return '';
  });
  if (previous === encoded) return false;
  const temporary = path + '.tmp';
  await writeFile(temporary, encoded);
  await rename(temporary, path);
  return true;
}

export async function studyRevision() {
  const files = ['docs/validation/5.4.0/protocol.md', 'scripts/forecast-study-model.mjs', 'scripts/forecast-study-ledger.mjs'];
  return hash(await Promise.all(files.map(path => readFile(path, 'utf8'))));
}
