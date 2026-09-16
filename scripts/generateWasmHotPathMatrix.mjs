import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'artifacts/wasm-hotpath/vectors');
const SHARDS = 4;
const PER_SHARD = 1024;

await mkdir(OUT, { recursive: true });
for (let shard = 0; shard < SHARDS; shard += 1) {
  const start = shard * PER_SHARD;
  const rows = Array.from({ length: PER_SHARD }, (_, offset) => String(start + offset));
  const path = join(OUT, `part-${String(shard).padStart(2, '0')}.ndjson`);
  await writeFile(path, `${rows.join('\n')}\n`, 'utf8');
}
console.log(JSON.stringify({ output: OUT, shards: SHARDS, vectors: SHARDS * PER_SHARD, deterministic: true, schema: 1 }, null, 2));
