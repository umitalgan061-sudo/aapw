import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const OUT = resolve(ROOT, 'artifacts/typed-runtime-r1/runtime-compatibility.matrix');
const axes = Object.freeze({
  backend: ['webgpu', 'webgl2', 'headless', 'auto'],
  quality: ['safe', 'low', 'medium', 'high'],
  input: ['keyboard', 'touch', 'gamepad', 'hybrid'],
  storage: ['memory', 'local', 'indexed', 'none'],
  worker: ['off', 'visibility', 'navigation', 'full'],
  pressure: ['idle', 'nominal', 'elevated', 'critical'],
});

const names = Object.keys(axes);
const values = Object.values(axes);
const rows = [];
const recurse = (depth, selected) => {
  if (depth === names.length) {
    const index = rows.length;
    const hash = [...selected].reduce((acc, value) => {
      let h = acc >>> 0;
      for (const char of String(value)) {
        h ^= char.charCodeAt(0);
        h = Math.imul(h, 16777619) >>> 0;
      }
      return h >>> 0;
    }, 2166136261);
    rows.push(`${String(index).padStart(4, '0')}|${hash.toString(16).padStart(8, '0')}|${selected.join('|')}`);
    return;
  }
  for (const value of values[depth]) recurse(depth + 1, [...selected, value]);
};
recurse(0, []);

const header = [
  '# AAPW typed-runtime compatibility matrix R1',
  '# Exhaustive Cartesian coverage: 4^6 = 4096 deterministic runtime configurations',
  '# Columns: caseId|stableHash|backend|quality|input|storage|worker|pressure',
];
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${[...header, ...rows].join('\n')}\n`, 'utf8');

const text = await readFile(OUT, 'utf8');
const dataRows = text.split('\n').filter(line => /^\d{4}\|/.test(line));
if (dataRows.length !== 4096) throw new Error(`matrix row count mismatch: ${dataRows.length}`);
if (new Set(dataRows).size !== 4096) throw new Error('matrix contains duplicate rows');
if (!dataRows.every((row, index) => row.startsWith(`${String(index).padStart(4, '0')}|`))) throw new Error('matrix IDs are not contiguous');
console.log(`typed runtime matrix generated: ${dataRows.length} unique cases`);
