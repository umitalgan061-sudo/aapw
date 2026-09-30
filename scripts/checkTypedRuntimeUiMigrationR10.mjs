import { readFile } from 'node:fs/promises';

const owners = [
  ['src/3d/gameLoopHelpers.ts', 'src/3d/gameLoopHelpers.js'],
  ['src/3d/safeMode.ts', 'src/3d/safeMode.js'],
  ['src/3d/ui/pauseMenu.ts', 'src/3d/ui/pauseMenu.js'],
  ['src/3d/ui/touchJoystick.ts', 'src/3d/ui/touchJoystick.js'],
];
const failures = [];
for (const [typedPath, legacyPath] of owners) {
  const typed = await readFile(typedPath, 'utf8').catch(() => null);
  const legacy = await readFile(legacyPath, 'utf8').catch(() => null);
  if (!typed) failures.push(`${typedPath}: missing TypeScript owner`);
  if (!legacy) failures.push(`${legacyPath}: missing compatibility boundary`);
  else if (!legacy.includes('.ts') || !legacy.includes('export * from')) failures.push(`${legacyPath}: invalid TypeScript compatibility barrel`);
}
const game3d = await readFile('src/3d/game3d.ts', 'utf8');
for (const specifier of [
  './gameLoopHelpers.ts',
  './safeMode.ts',
  './ui/pauseMenu.ts',
  './ui/touchJoystick.ts',
]) {
  if (!game3d.includes(`from '${specifier}'`)) failures.push(`game3d.ts: TypeScript owner not wired: ${specifier}`);
}
const loop = await readFile('src/3d/gameLoopHelpers.ts', 'utf8');
if (!loop.includes("from './config.ts'") || !loop.includes("from './sceneManager.ts'")) failures.push('gameLoopHelpers.ts: legacy internal imports remain');
const touch = await readFile('src/3d/ui/touchJoystick.ts', 'utf8');
if (!touch.includes("from '../config.ts'") || !touch.includes("from '../input.ts'")) failures.push('touchJoystick.ts: legacy internal imports remain');
const ledger = await readFile('src/3d/modern/migrationLedgerR10.ts', 'utf8');
for (const [, legacyPath] of owners) if (!ledger.includes(`legacyPath: '${legacyPath}'`)) failures.push(`R10 ledger missing ${legacyPath}`);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(JSON.stringify({ ok: true, suite: 'typed-runtime-ui-migration-r10', owners: owners.length, productionWiring: true, compatibilityBarrels: true }));
