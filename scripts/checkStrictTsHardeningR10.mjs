import { readFile } from 'node:fs/promises';

const strictOwners = [
  'src/3d/ui/interactionPrompt.ts',
  'src/3d/ui/touchJoystick.ts',
  'src/3d/ui/healthBar.ts',
  'src/3d/safeMode.ts',
];

const failures = [];
for (const path of strictOwners) {
  const source = await readFile(path, 'utf8').catch(() => null);
  if (!source) {
    failures.push(`${path}: missing`);
    continue;
  }
  if (source.includes('@ts-nocheck')) failures.push(`${path}: @ts-nocheck is forbidden in the R10 strict set`);
  if (!/export (class|interface|type|function)/.test(source)) failures.push(`${path}: expected explicit TypeScript exports`);
}

const game3d = await readFile('src/3d/game3d.ts', 'utf8');
for (const specifier of [
  './ui/interactionPrompt.ts',
  './ui/touchJoystick.ts',
  './ui/healthBar.ts',
  './audio/audioManager.ts',
  './safeMode.ts',
]) {
  if (!game3d.includes(`from '${specifier}'`)) failures.push(`game3d.ts: production entrypoint missing direct TS owner ${specifier}`);
}

const ledger = await readFile('src/3d/modern/migrationLedgerR10.ts', 'utf8');
for (const path of strictOwners) if (!ledger.includes(path)) failures.push(`R10 ledger missing ${path}`);

if (failures.length) {
  console.error(`R10 strict TypeScript hardening failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok:true,
  suite:'strict-ts-hardening-r10',
  strictOwners:strictOwners.length,
  noTsNocheck:true,
  directProductionTsImports:true,
}));
