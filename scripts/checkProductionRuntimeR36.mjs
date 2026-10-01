import { readFile } from 'node:fs/promises';

const required = [
  'src/3d/strict/productionRuntimeSupervisorR36.ts',
  'src/3d/strict/runtimeWatchdogR33.ts',
  'src/3d/strict/runtimeHardeningV25.ts',
  'src/3d/strict/runtimeCircuitBreakerR12.ts',
  'src/3d/strict/renderBackendRuntime.ts',
  'tests/modern/productionRuntimeSupervisorR36.test.ts',
  'tsconfig.production-runtime-r36.json',
];

const failures = [];
for (const path of required) {
  const content = await readFile(path, 'utf8').catch(() => null);
  if (!content) failures.push(path);
}

const supervisor = await readFile('src/3d/strict/productionRuntimeSupervisorR36.ts', 'utf8');
for (const forbidden of ['Math.random(', 'Date.now(', 'eval(', 'new Function(']) {
  if (supervisor.includes(forbidden)) failures.push(`forbidden:${forbidden}`);
}

const index = await readFile('src/3d/strict/index.ts', 'utf8');
if (!index.includes('productionRuntimeSupervisorR36.ts')) failures.push('strict/index.ts: R36 export missing');

if (failures.length) {
  console.error(`R36 production runtime gate failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('R36 production runtime gate passed.');
