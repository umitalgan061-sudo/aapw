import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const required = [
  'src/3d/modern/r2/index.ts',
  'src/3d/modern/r2/simulationKernel.ts',
  'src/3d/modern/r2/ecsRuntime.ts',
  'src/3d/modern/r2/streamingOrchestrator.ts',
  'src/3d/modern/r2/networkReplicationV3.ts',
  'src/3d/modern/r2/saveMigrationEngine.ts',
  'src/3d/modern/r2/observabilityHub.ts',
  'src/3d/modern/r2/runtimeApplication.ts',
  'src/3d/modern/r2/predictionReconciliation.ts',
  'src/3d/modern/r2/worldQueryRuntime.ts',
  'src/3d/modern/r2/gameplayBridge.ts',
];
const forbidden = /\b(eval|Function)\s*\(|Math\.random\s*\(|Date\.now\s*\(/;

for (const relative of required) {
  const absolute = resolve(root, relative);
  await access(absolute);
  const source = await readFile(absolute, 'utf8');
  if (forbidden.test(source)) throw new Error(`forbidden ambient primitive in ${relative}`);
}

const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
if (packageJson.type !== 'module') throw new Error('runtime-r2 requires native ESM package mode');
if (!String(packageJson.engines?.node ?? '').includes('24')) throw new Error('runtime-r2 requires Node 24+ baseline');

console.info(`[runtime-r2] verified ${required.length} runtime files`);
