import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'artifacts/wasm-hotpath/validation-matrix.ndjson');
const GROUPS = ['height', 'lod', 'distance', 'spatial', 'bilinear', 'quantize'];
const LOD_DISTANCES = [0, 1, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, Number.POSITIVE_INFINITY];
const STEPS = [0.25, 0.5, 1, 2, 5, 10, 25, 100];
const signed = (value, modulus, center) => (value % modulus) - center;
const vectorFor = (id, group) => {
  const cycle = Math.floor(id / GROUPS.length);
  switch (group) {
    case 'height':
      return { x: signed(cycle * 7919, 42001, 21000), z: signed(cycle * 104729, 36001, 18000), seed: (0x9e3779b9 * (cycle + 1)) >>> 0 };
    case 'lod':
      return { distance: LOD_DISTANCES[cycle % LOD_DISTANCES.length], near: cycle % 7, far: 100 + (cycle % 9) * 250 };
    case 'distance':
      return { a: [signed(cycle * 31, 401, 200), signed(cycle * 17, 303, 151), signed(cycle * 13, 201, 100)], b: [signed(cycle * 23, 401, 200), signed(cycle * 29, 303, 151), signed(cycle * 7, 201, 100)] };
    case 'spatial':
      return { cellX: signed(cycle * 97, 4001, 2000), cellZ: signed(cycle * 193, 4001, 2000) };
    case 'bilinear':
      return { h: [signed(cycle * 3, 101, 50), signed(cycle * 5, 151, 75), signed(cycle * 7, 201, 100), signed(cycle * 11, 251, 125)], tx: (cycle % 11) / 10, tz: ((cycle * 3) % 11) / 10 };
    case 'quantize':
      return { value: signed(cycle * 37, 10001, 5000), step: STEPS[cycle % STEPS.length] };
    default: throw new Error(`unknown group: ${group}`);
  }
};

const rows = Array.from({ length: 4096 }, (_, id) => {
  const group = GROUPS[id % GROUPS.length];
  const boundary = id < 768 || id % 17 === 0 || id % 31 === 0;
  return JSON.stringify({ schema: 1, id, group, boundary, input: vectorFor(id, group) });
});

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${rows.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ output: OUT, vectors: rows.length, groups: GROUPS, schema: 1 }, null, 2));
