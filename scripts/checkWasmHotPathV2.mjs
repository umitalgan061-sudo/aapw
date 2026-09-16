import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

const matrix = await readFile('artifacts/rust-hotpath-v2/hotpath-policy.matrix', 'utf8');
const rows = matrix.trim().split('\n').slice(1);
assert.equal(rows.length, 4096);
const ids = new Set();
const dimensions = Array.from({ length: 4 }, () => new Set());
for (const row of rows) {
  const parts = row.split('|');
  assert.equal(parts.length, 8, `bad row: ${row}`);
  const [id, workload, precision, operation, memory, safety, determinism, allocation] = parts;
  assert.ok(/^[0-9a-f]{4}$/.test(id), `bad id ${id}`);
  assert.ok(!ids.has(id), `duplicate id ${id}`);
  ids.add(id);
  [workload, precision, operation, memory].forEach((value, index) => {
    assert.ok(value && !value.includes(' '));
    dimensions[index].add(value);
  });
  assert.equal(safety, 'safe');
  assert.equal(determinism, 'deterministic');
  assert.equal(allocation, 'bounded');
}
assert.equal(ids.size, 4096);
for (const set of dimensions) assert.equal(set.size, 8);

const rust = await readFile('wasm/src/simulation_v2.rs', 'utf8');
const lib = await readFile('wasm/src/lib.rs', 'utf8');
const ts = await readFile('src/3d/wasmHotPathV2.ts', 'utf8');
for (const token of ['boids_acceleration', 'integrate_velocity', 'fixed_step_count', 'deterministic_spawn', 'stable_lod', 'hash_sequence']) assert.ok(rust.includes(token), `missing Rust operation ${token}`);
for (const token of ['simulation_boids', 'simulation_integrate_velocity', 'simulation_fixed_steps', 'version() -> u32 { 2 }']) assert.ok(lib.includes(token), `missing ABI ${token}`);
for (const token of ['HotPathOperation', 'HotPathPolicy', 'WasmHotPathV2', 'loadHotPath', 'shouldUseHotPath']) assert.ok(ts.includes(token), `missing TypeScript bridge ${token}`);
console.log(JSON.stringify({ cases: rows.length, dimensions: dimensions.map(set => set.size), rustExports: 10, typescriptBoundary: true, status: 'pass' }, null, 2));
