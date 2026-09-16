import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const required = [
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  'src/3d/modern/index.ts',
  'src/3d/modern/types.ts',
  'src/3d/modern/runtime.ts',
  'src/3d/modern/legacyBridge.ts',
  'src/3d/modern/renderPacket.ts',
  'src/3d/modern/frameGraph.ts',
  'src/3d/modern/streamingPlanner.ts',
];

const missing = required.filter((file) => !existsSync(resolve(root, file)));
if (missing.length) {
  console.error(`Missing modern platform files:\n${missing.join('\n')}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const assertions = [
  [pkg.type === 'module', 'package must use native ESM'],
  [pkg.devDependencies?.typescript, 'TypeScript must be a dev dependency'],
  [pkg.devDependencies?.vite, 'Vite must be a dev dependency'],
  [pkg.devDependencies?.vitest, 'Vitest must be a dev dependency'],
  [pkg.engines?.node?.startsWith('>=24'), 'Node 24+ is required for the modern toolchain'],
  [pkg.scripts?.typecheck, 'typecheck script is required'],
  [pkg.scripts?.['build:modern'], 'build:modern script is required'],
];
const failures = assertions.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) {
  console.error(`Modern platform manifest is invalid:\n${failures.join('\n')}`);
  process.exit(1);
}

const deterministicFiles = [
  'src/3d/modern/types.ts',
  'src/3d/modern/deterministic.ts',
  'src/3d/modern/commandJournal.ts',
  'src/3d/modern/entityWorld.ts',
  'src/3d/modern/navigationPlanner.ts',
  'src/3d/modern/streamingPlanner.ts',
  'src/3d/modern/motionState.ts',
  'src/3d/modern/inputReplay.ts',
  'src/3d/modern/renderPacket.ts',
  'src/3d/modern/networkSnapshot.ts',
];
const forbidden = ['Math.random(', 'Date.now('];
const deterministicViolations = [];
for (const file of deterministicFiles) {
  const source = readFileSync(resolve(root, file), 'utf8');
  for (const token of forbidden) {
    if (source.includes(token)) deterministicViolations.push(`${file}: ${token}`);
  }
}
if (deterministicViolations.length) {
  console.error(`Deterministic modules use forbidden non-deterministic APIs:\n${deterministicViolations.join('\n')}`);
  process.exit(1);
}

console.log(`Modern platform manifest OK: ${required.length} required surfaces present; deterministic guard covers ${deterministicFiles.length} modules.`);
