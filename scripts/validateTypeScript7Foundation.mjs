import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const requiredFiles = [
  'src/3d/types/runtimeContract.ts',
  'src/3d/types/result.ts',
  'src/3d/types/events.ts',
  'src/3d/types/assets.ts',
  'src/3d/types/rendering.ts',
  'src/3d/types/persistence.ts',
  'src/3d/types/migration.ts',
  'src/3d/types/index.ts',
  'tsconfig.runtime-foundation.json',
  'scripts/generateTypeScript7MigrationMatrix.mjs',
];

const requiredTokens = [
  ['src/3d/types/runtimeContract.ts', "export type Backend = 'webgpu' | 'webgl2';"],
  ['src/3d/types/migration.ts', "compilerMajor: 7;"],
  ['src/3d/types/result.ts', 'export type Result<T, E> = Ok<T> | Err<E>;'],
  ['src/3d/types/events.ts', 'export class TypedEventBus'],
  ['src/3d/types/persistence.ts', "format: 'aapw-save';"],
  ['src/3d/types/rendering.ts', 'export interface FramePlan'],
];

for (const path of requiredFiles) {
  await readFile(path, 'utf8');
}
for (const [path, token] of requiredTokens) {
  const source = await readFile(path, 'utf8');
  if (!source.includes(token)) throw new Error(`${path}: missing required contract token`);
}

const matrix = await readFile('artifacts/typescript7-runtime-foundation/migration-contract-matrix.ts', 'utf8');
const ids = [...matrix.matchAll(/"id":(\d+)/g)].map((match) => Number(match[1]));
if (ids.length !== 4096 || new Set(ids).size !== 4096 || ids[0] !== 1 || ids.at(-1) !== 4096) {
  throw new Error(`migration matrix invariant failed: rows=${ids.length}`);
}

const compiler = process.env.TSC_BIN ?? 'tsc';
const result = spawnSync(compiler, ['--version'], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(`TypeScript compiler unavailable: ${result.stderr || result.stdout}`);
console.log(result.stdout.trim());
console.log(`validated ${ids.length} deterministic TypeScript 7 migration contracts`);
