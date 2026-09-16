import { mkdir, writeFile } from 'node:fs/promises';

const axes = [
  ['2d-map', '3d-world', 'rts', 'editor'],
  ['browser-main', 'dedicated-worker', 'shared-worker', 'headless'],
  ['webgpu', 'webgl2', 'offscreen-webgl2', 'no-render'],
  ['keyboard', 'pointer', 'touch', 'gamepad'],
  ['primary-save', 'backup-save', 'checkpoint', 'memory-only'],
  ['observe', 'bridge', 'typed', 'native'],
];
const expected = 4096;
const names = ['surface', 'host', 'renderer', 'input', 'persistence', 'stage'];
const pick = (id) => {
  let cursor = id - 1;
  return axes.map((axis) => {
    const value = axis[cursor % axis.length];
    cursor = Math.floor(cursor / axis.length);
    return value;
  });
};
const riskFor = ({ renderer, input, persistence, stage }) => {
  let risk = 'low';
  if (renderer === 'no-render') risk = 'medium';
  if (renderer === 'offscreen-webgl2') risk = 'medium';
  if (input === 'gamepad') risk = risk === 'medium' ? risk : 'medium';
  if (persistence === 'memory-only') risk = risk === 'high' ? risk : 'medium';
  if (stage === 'observe') risk = 'high';
  if (stage === 'bridge') risk = risk === 'high' ? risk : 'medium';
  if (renderer === 'webgpu' && stage === 'native') risk = 'medium';
  return risk;
};
const rows = [];
for (let id = 1; id <= expected; id += 1) {
  const values = pick(id);
  const item = Object.fromEntries(names.map((name, index) => [name, values[index]]));
  item.id = id;
  item.risk = riskFor(item);
  item.mustPreserveFallback = item.renderer === 'webgpu';
  item.requiresAdapter = item.stage !== 'native';
  item.deterministicClock = true;
  rows.push(`  ${JSON.stringify(item)} as const,`);
}
const output = [
  '// GENERATED FILE: TypeScript 7 Game3D V3 cutover regression corpus.',
  '// Source: scripts/generateTypeScript7V3CutoverMatrix.mjs',
  '',
  'export interface TypeScript7V3CutoverCase {',
  '  readonly id: number;',
  '  readonly surface: string;',
  '  readonly host: string;',
  '  readonly renderer: string;',
  '  readonly input: string;',
  '  readonly persistence: string;',
  '  readonly stage: string;',
  '  readonly risk: string;',
  '  readonly mustPreserveFallback: boolean;',
  '  readonly requiresAdapter: boolean;',
  '  readonly deterministicClock: boolean;',
  '}',
  '',
  'export const TYPESCRIPT7_V3_CUTOVER_CASES = [',
  ...rows,
  '] as const satisfies readonly TypeScript7V3CutoverCase[];',
  '',
  'export const TYPESCRIPT7_V3_CUTOVER_COUNT = TYPESCRIPT7_V3_CUTOVER_CASES.length;',
  '',
  'export const getTypeScript7V3CutoverCase = (id: number): TypeScript7V3CutoverCase | undefined => TYPESCRIPT7_V3_CUTOVER_CASES[id - 1];',
  '',
].join('\n');
await mkdir('artifacts/typescript7-v3-cutover', { recursive: true });
await writeFile('artifacts/typescript7-v3-cutover/cutover-matrix.ts', output, 'utf8');
console.log(`generated ${expected} TypeScript 7 V3 cutover cases`);
