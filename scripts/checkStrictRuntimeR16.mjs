import { readFile } from 'node:fs/promises';

const files = [
  'src/3d/renderQuality.ts',
  'src/3d/fog.ts',
  'src/3d/safeMode.ts',
  'src/3d/gameplay/health.ts',
];

const failures = [];
for (const file of files) {
  const source = await readFile(file, 'utf8').catch(() => '');
  if (!source) failures.push(`${file}: missing`);
  if (source.includes('@ts-nocheck')) failures.push(`${file}: strict TypeScript escape hatch remains`);
  if (!source.includes('Production TypeScript owner') && !source.includes('/** Production TypeScript owner')) {
    failures.push(`${file}: production ownership marker missing`);
  }
}

const shims = [
  ['src/3d/renderQuality.js', './renderQuality.ts'],
  ['src/3d/fog.js', './fog.ts'],
  ['src/3d/safeMode.js', './safeMode.ts'],
  ['src/3d/gameplay/health.js', './health.ts'],
];
for (const [shim, target] of shims) {
  const source = await readFile(shim, 'utf8').catch(() => '');
  if (!source.includes('export * from') || !source.includes(target)) {
    failures.push(`${shim}: compatibility boundary is not a TypeScript barrel`);
  }
}

if (failures.length) {
  console.error(`R16 strict runtime gate failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  suite: 'strict-runtime-r16',
  strictOwners: files.length,
  escapeHatches: 0,
}));
