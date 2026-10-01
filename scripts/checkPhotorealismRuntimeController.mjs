import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = [
  'src/3d/world/photorealismRuntimeController.ts',
  'src/3d/world/photorealismBatchExecutor.ts',
  'tests/world/photorealismRuntimeController.test.ts',
];
for (const file of files) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.equal(source.includes('EditorMaterialStudio'), false, `${file} must not import editor DOM runtime`);
  const isTest = file.includes('test');
  const staysInsidePlacementBoundary =
    source.includes('placementQuery') ||
    source.includes('batchAcceptance') ||
    source.includes('WorldAssetPlacementPipeline') ||
    isTest;
  assert.equal(staysInsidePlacementBoundary, true, `${file} must stay inside the shared placement/acceptance boundary or test it`);
}
const controller = await readFile(new URL('../src/3d/world/photorealismRuntimeController.ts', import.meta.url), 'utf8');
for (const token of ['visible-failure-gate', 'applyObservation', 'deterministicKey', 'maxOperationsPerFrame', 'isRuntimeControllerReceipt', 'placementQuery']) {
  assert.ok(controller.includes(token), `missing runtime controller contract: ${token}`);
}
const batch = await readFile(new URL('../src/3d/world/photorealismBatchExecutor.ts', import.meta.url), 'utf8');
for (const token of ['stableSort', 'maxBatchSize', 'batchAcceptance', 'budgetClampedCount']) {
  assert.ok(batch.includes(token), `missing batch contract: ${token}`);
}
console.log('Photorealism runtime controller contract: PASS');
