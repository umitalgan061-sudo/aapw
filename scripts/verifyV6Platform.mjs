import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'src/3d/modern/v6/deterministicKernel.ts',
  'src/3d/modern/v6/assetGraph.ts',
  'src/3d/modern/v6/scenePlanner.ts',
  'src/3d/modern/v6/commandPipeline.ts',
  'src/3d/modern/v6/networkSession.ts',
  'src/3d/modern/v6/uiState.ts',
  'src/3d/modern/v6/performanceGovernor.ts',
  'src/3d/modern/v6/pwaRuntime.ts',
  'src/3d/modern/v6/securityTelemetry.ts',
  'src/3d/modern/v6/worldState.ts',
  'src/3d/modern/v6/workerProtocol.ts',
  'src/3d/modern/v6/saveCodec.ts',
  'src/3d/modern/v6/migrationBoundary.ts',
  'src/3d/modern/v6/platform.ts',
  'src/3d/modern/v6/verification.ts',
  'tests/modern/v6Platform.test.ts',
];

for (const relative of required) {
  const path = resolve(root, relative);
  const source = readFileSync(path, 'utf8');
  if (source.trim().length < 64) throw new Error(`V6 file is unexpectedly small: ${relative}`);
  if (/Math\.random\(|eval\(|new Function\(/.test(source)) {
    throw new Error(`Unsafe primitive detected in V6 surface: ${relative}`);
  }
}

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
if (packageJson.type !== 'module') throw new Error('V6 requires native ESM package mode');
if (!String(packageJson.engines?.node ?? '').includes('24')) throw new Error('V6 requires Node 24 runtime baseline');

execFileSync(process.execPath, ['--check', resolve(root, 'scripts/verifyV6Platform.mjs')], { stdio: 'inherit' });
console.log(`[V6] verified ${required.length} core files and package runtime contract`);
