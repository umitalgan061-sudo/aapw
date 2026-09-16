import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const workloads = ['terrain', 'crowd', 'foliage', 'water', 'particles', 'navigation', 'animation', 'visibility'];
const precisions = ['f32', 'f16-pack', 'quantized', 'normalized', 'weighted', 'accumulate', 'interpolate', 'hash'];
const operations = ['height', 'distance', 'cull', 'lod', 'transform', 'integrate', 'hash', 'boids'];
const memories = ['scratch', 'stream', 'resident', 'ring', 'paged', 'shared', 'ephemeral', 'persistent'];

function buildRows() {
  const rows = [];
  for (let wi = 0; wi < workloads.length; wi += 1) {
    for (let pi = 0; pi < precisions.length; pi += 1) {
      for (let oi = 0; oi < operations.length; oi += 1) {
        for (let mi = 0; mi < memories.length; mi += 1) {
          const id = rows.length.toString(16).padStart(4, '0');
          rows.push(`${id}|${workloads[wi]}|${precisions[pi]}|${operations[oi]}|${memories[mi]}|safe|deterministic|bounded`);
        }
      }
    }
  }
  return rows;
}

const rows = buildRows();
if (rows.length !== 4096) throw new Error(`matrix cardinality changed: ${rows.length}`);
const root = resolve(process.cwd(), 'artifacts/rust-hotpath-v2');
await mkdir(root, { recursive: true });
await writeFile(resolve(root, 'hotpath-policy.matrix'), ['# id|workload|precision|operation|memory|safety|determinism|allocation', ...rows, ''].join('\n'), 'utf8');
console.log(JSON.stringify({ cases: rows.length, dimensions: 8, status: 'generated' }));
