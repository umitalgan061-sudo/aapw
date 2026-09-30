import { readFile } from 'node:fs/promises';
import process from 'node:process';

const required = [
  'src/3d/modern/r29/contracts.ts',
  'src/3d/modern/r29/eventBus.ts',
  'src/3d/modern/r29/clock.ts',
  'src/3d/modern/r29/serviceRegistry.ts',
  'src/3d/modern/r29/budgetDirector.ts',
  'src/3d/modern/r29/worldRuntime.ts',
  'src/3d/modern/r29/renderCoordinator.ts',
  'src/3d/modern/r29/networkCoordinator.ts',
  'src/3d/modern/r29/assetCache.ts',
  'src/3d/modern/r29/inputRuntime.ts',
  'src/3d/modern/r29/telemetry.ts',
  'src/3d/modern/r29/runtime.ts',
  'src/3d/modern/r29/browserBridge.ts',
  'src/3d/modern/r29/compatibilityBridge.ts',
  'src/3d/modern/r29/worldQuery.ts',
  'src/3d/modern/r29/workerScheduler.ts',
  'src/3d/modern/r29/hostAdapters.ts',
  'src/3d/modern/r29/saveLedger.ts',
  'src/3d/modern/r29/migrationAudit.ts',
  'src/3d/modern/r29/replayJournal.ts',
  'src/3d/modern/r29/security.ts',
  'src/3d/modern/r29/index.ts',
  'tests/modern/r29Runtime.test.ts',
  'tests/modern/r29Subsystems.test.ts',
  'tests/modern/r29Advanced.test.ts',
  'tests/modern/r29PersistenceAndMigration.test.ts',
  'tests/modern/r29BrowserAndSecurity.test.ts',
  'tests/modern/r29Verification.test.ts',
  'tests/modern/r29MigrationAudit.test.ts',
];

const failures = [];
for (const file of required) {
  try {
    const content = await readFile(file, 'utf8');
    if (!content.trim()) failures.push(file + ':empty');
  } catch {
    failures.push(file + ':missing');
  }
}

const runtime = await readFile('src/3d/modern/r29/runtime.ts', 'utf8').catch(() => '');
const barrel = await readFile('src/3d/modern/r29/index.ts', 'utf8').catch(() => '');
const checks = [
  ['r29 runtime version', runtime.includes("runtimeVersion: 'r29'")],
  ['fixed-step clock', runtime.includes('R29FixedStepClock')],
  ['budget director', runtime.includes('R29BudgetDirector')],
  ['network coordinator', runtime.includes('R29NetworkCoordinator')],
  ['render coordinator', runtime.includes('R29RenderCoordinator')],
  ['world runtime', runtime.includes('R29WorldRuntime')],
  ['asset cache', runtime.includes('R29AssetCache')],
  ['re-exported save ledger', barrel.includes("./saveLedger.ts")],
  ['re-exported security boundary', barrel.includes("./security.ts")],
  ['typed imports', !runtime.includes("from './runtime.js'")],
];
for (const [name, ok] of checks) if (!ok) failures.push('runtime:' + name);

const forbidden = [/Math\\.random\\s*\\(/, /Date\\.now\\s*\\(/, /new Function\\s*\\(/, /eval\\s*\\(/];
for (const file of required.filter((item) => item.endsWith('.ts'))) {
  const content = await readFile(file, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(content)) failures.push(file + ':forbidden:' + pattern);
  }
}

if (failures.length) {
  console.error('R29 verification failed');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('R29 verification passed for ' + required.length + ' files');
