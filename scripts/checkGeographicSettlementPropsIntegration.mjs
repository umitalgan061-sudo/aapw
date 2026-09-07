import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname, '..');
const sceneManager = readFileSync(resolve(ROOT, 'src/3d/sceneManager.js'), 'utf8');
const geographicProps = readFileSync(resolve(ROOT, 'src/3d/world/geographicSettlementProps.js'), 'utf8');
const quality = readFileSync(resolve(ROOT, 'src/3d/world/geographicSettlementPropQuality.js'), 'utf8');
const harness = readFileSync(resolve(ROOT, 'scripts/geographic-settlement-props-harness.html'), 'utf8');

const requiredSceneTokens = [
  "import { createGeographicSettlementPropLayer } from './world/geographicSettlementProps.js';",
  'createGeographicSettlementPropLayer({',
  'sampleHeightMeters: groundCollider.getGroundHeight',
  'seats: settlementsResult.seats',
  'roadEdges: roadsResult.edges',
  'geographicSettlementPropsReady',
  'decorateGeographicSettlementPropGroup',
  'auditGeographicSettlementPropGroup',
  'buildGeographicSettlementPropRuntimeSummary',
  'applyShadowRoles(result.group, { quality: renderQuality })',
  'geographicSettlementProps: null',
];
for (const token of requiredSceneTokens) assert.ok(sceneManager.includes(token), `sceneManager regression: missing ${token}`);
assert.ok(sceneManager.indexOf('createGeographicSettlementPropLayer({') > sceneManager.indexOf('const villagesResult = createVillages({'));
assert.ok(sceneManager.includes('radiusMeters: previewRadiusChunks * CHUNK_CONFIG.CHUNK_SIZE_METERS'));

const sharedMaterialTokens = [
  "from '../materials/MaterialAssignmentCore.js'",
  "from './WorldAssetPlacementPipeline.js'",
  'prepareWorldAssetForPlacement',
  'attachPreparedWorldAsset',
  'validateMaterialAssignment',
  'createMaterialManifest',
];
for (const token of sharedMaterialTokens) assert.ok(geographicProps.includes(token), `shared contract regression: missing ${token}`);
assert.ok(!geographicProps.includes('EditorMaterialStudio.js'), 'runtime must not import editor DOM/UI material studio');
assert.ok(!quality.includes('EditorMaterialStudio.js'), 'quality layer must remain DOM-free');
assert.ok(!quality.includes('AssetLoader'), 'quality layer must not duplicate the loader/placement framework');
assert.ok(!geographicProps.includes('Math.random('), 'placement must remain deterministic');

const requiredGeographicTokens = [
  "canonicalMapAuthority: 'owner-world-map-2026-08-08'",
  "placementAuthority: 'WorldAssetPlacementPipeline'",
  "materialAuthority: 'MaterialAssignmentCore'",
  'ringMeters: Object.freeze({ min: 162, max: 204 })',
  'spacingMeters: 13',
  'maxSlopeDegrees: 22',
  'minRoadDistanceMeters: 6',
  "assets/models/props/barrel_zjCQP1TAci.glb",
  "assets/models/props/crate_3OEFd1AWfa.glb",
  "assets/models/props/greek_stone_bench.glb",
  "assets/models/props/bonfire_Azj9hJwwwG.glb",
  "assets/models/props/farm_dirt_8BQFbUMOeC.glb",
  'requireGeneratedTexture: true',
  'restoreOriginalMaterials(object)',
  'authoredPbrPreserved: true',
];
for (const token of requiredGeographicTokens) assert.ok(geographicProps.includes(token), `geographic prop regression: missing ${token}`);

const requiredQualityTokens = [
  'GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY',
  'collectGeographicPropMaterialEvidence',
  'deriveGeographicSettlementPropContext',
  'scoreGeographicSettlementPropContext',
  'auditGeographicSettlementPropPlan',
  'auditGeographicSettlementPropGroup',
  'buildGeographicSettlementPropRuntimeSummary',
  'buildStablePropFingerprint',
  'authoredPbrEvidence',
  'textureSizes',
];
for (const token of requiredQualityTokens) assert.ok(quality.includes(token), `quality regression: missing ${token}`);

const forbiddenSecondFrameworkTokens = [
  'class GeographicSettlementManager',
  'class SettlementManager',
  'new QuestSystem',
  'new Economy',
  'new Inventory',
  'createSettlementManager',
];
for (const token of forbiddenSecondFrameworkTokens) {
  assert.ok(!sceneManager.includes(token), `ownership regression: sceneManager contains ${token}`);
  assert.ok(!geographicProps.includes(token), `ownership regression: geographic props contains ${token}`);
}

const requiredHarnessTokens = [
  "import { createScene } from '../src/3d/sceneManager.js';",
  'state.geographicSettlementPropsReady',
  'productionOwnedRuntime',
  'materialEvidence',
  'placementSurface',
  'consoleErrors',
];
for (const token of requiredHarnessTokens) assert.ok(harness.includes(token), `browser proof regression: missing ${token}`);
assert.ok(!harness.includes('createGeographicSettlementPropLayer({'), 'browser harness must not bypass sceneManager ownership by directly booting the layer');

const importCount = (sceneManager.match(/createGeographicSettlementPropLayer/g) || []).length;
assert.equal(importCount, 2, 'sceneManager should contain one import and one production call');

console.log(JSON.stringify({
  ok: true,
  productionRuntimeWired: true,
  sharedPlacementContractReferenced: true,
  editorMaterialStudioExcluded: true,
  deterministicPlanning: true,
  directHarnessBypass: false,
  qualityAuditWired: true,
}));
