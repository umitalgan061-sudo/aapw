import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = 'src/3d/strict/r37';

const entries = await readdir(root, { withFileTypes: true });
const files = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
  .map((entry) => join(root, entry.name))
  .sort();

if (files.length < 30) throw new Error('R37 gate expected at least 30 strict TypeScript surfaces');

let lineCount = 0;
for (const file of files) {
  const source = await readFile(file, 'utf8');
  lineCount += source.split('\n').length;
  if (!source.trim()) throw new Error('empty R37 surface: ' + file);
  if (/Math\.random\(|Date\.now\(|eval\(|new Function\(/.test(source)) {
    throw new Error('unsafe or nondeterministic primitive detected: ' + file);
  }
  if (source.includes('// @ts-nocheck') || source.includes('// @ts-ignore')) {
    throw new Error('R37 surface must remain strictly checked: ' + file);
  }
}

if (lineCount < 4000) throw new Error('R37 strict surface regressed below 4000 meaningful source lines');

const index = await readFile(join(root, 'index.ts'), 'utf8');
if (!index.includes('export * from')) throw new Error('R37 barrel exports are missing');

console.log(JSON.stringify({ ok: true, files: files.length, lineCount }));
