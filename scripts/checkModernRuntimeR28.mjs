import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const runtimeFiles = [
  'environment.ts','inputDom.ts','browserHost.ts','rendererBridge.ts','renderScheduler.ts',
  'saveStorage.ts','serviceWorkerClient.ts','assetFetchAdapter.ts','worldBridge.ts',
  'diagnosticsPanel.ts','session.ts','inputReplay.ts','lifecycle.ts','assetCoordinator.ts',
  'telemetry.ts','cameraController.ts','focusManager.ts','errorRecovery.ts','resourceRegistry.ts',
  'browserSession.ts','sceneBridge.ts','networkAdapter.ts','storageCodec.ts','resizeManager.ts',
  'qualityPolicy.ts','virtualConsole.ts','diagnosticsBridge.ts','legacyAudit.ts',
  'bootCoordinator.ts','workerPool.ts'
];
const failures = [];
for (const file of runtimeFiles) {
  const path = join(root, 'src/3d/modern/r28', file);
  if (!existsSync(path)) failures.push('missing-runtime:' + file);
  else {
    const source = readFileSync(path, 'utf8');
    if (source.includes('eval(') || source.includes('new Function(')) failures.push('dynamic-code:' + file);
    if (source.includes('node:crypto')) failures.push('node-crypto-in-browser-runtime:' + file);
  }
}
const modernIndex = readFileSync(join(root, 'src/3d/modern/index.ts'), 'utf8');
if (!modernIndex.includes('./r28/index.ts')) failures.push('r28-barrel-missing');
const r28Index = readFileSync(join(root, 'src/3d/modern/r28/index.ts'), 'utf8');
if (!r28Index.includes('workerPool.ts')) failures.push('worker-pool-not-exported');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const name of ['verify:modern:r28','test:modern:r28','check:modern:r28']) {
  if (!pkg.scripts?.[name]) failures.push('package-script-missing:' + name);
}
if (failures.length) {
  console.error('R28 verification failed');
  for (const failure of failures.sort()) console.error(failure);
  process.exit(1);
}
console.log('R28 verification passed: ' + runtimeFiles.length + ' runtime files inspected.');
