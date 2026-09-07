import assert from 'node:assert/strict';
import {
  WORLD_ASSET_GEOGRAPHY_RUNTIME_CONTRACT_POLICY,
  buildWorldAssetGeographyMetadata,
  buildWorldAssetGeographySurface,
  normalizeWorldAssetGeographyFamily,
  resolveWorldAssetPlacementPoint,
  validateWorldAssetGeographyRuntimeContext,
  attachWorldAssetGeographyRuntimeDiagnostics,
} from '../src/3d/world/worldAssetGeographyRuntimeContract.js';

function fixture(position = { x: 120, y: 40, z: -85 }) {
  return {
    position: { ...position },
    userData: {
      assetId: 'pine-tree-07',
      assetCategory: 'tree',
    },
  };
}

function run() {
  assert.equal(WORLD_ASSET_GEOGRAPHY_RUNTIME_CONTRACT_POLICY.deterministic, true);
  assert.equal(WORLD_ASSET_GEOGRAPHY_RUNTIME_CONTRACT_POLICY.transformRewrite, false);
  assert.equal(WORLD_ASSET_GEOGRAPHY_RUNTIME_CONTRACT_POLICY.canonicalTerrainReadOnly, true);

  const object = fixture();
  assert.equal(normalizeWorldAssetGeographyFamily({ category: 'village-house' }, object), 'tree');
  assert.equal(normalizeWorldAssetGeographyFamily({ family: 'building' }, object), 'building');
  assert.equal(normalizeWorldAssetGeographyFamily({ id: 'ice-cave-entrance' }, null), 'snow');
  assert.equal(normalizeWorldAssetGeographyFamily({ category: 'riverbank-rock' }, null), 'waterside');

  const point = resolveWorldAssetPlacementPoint(object, {
    footprint: { samples: [{ x: 999, z: 999 }] },
  });
  assert.deepEqual(point, { x: 120, z: -85, source: 'object-position' });

  const detachedPoint = resolveWorldAssetPlacementPoint(null, {
    footprint: { samples: [{ x: 15, z: 22 }] },
  });
  assert.deepEqual(detachedPoint, { x: 15, z: 22, source: 'footprint-sample' });

  const prepared = {
    object,
    surface: {
      height: 41,
      slope: 0.12,
      moisture: 0.55,
      worldX: 120,
      worldZ: -85,
    },
    footprint: { samples: [{ x: 999, z: 999 }] },
    metadata: { category: 'tree' },
  };
  const surface = buildWorldAssetGeographySurface(prepared);
  assert.equal(surface.x, 120);
  assert.equal(surface.z, -85);
  assert.equal(surface.worldX, 120);
  assert.equal(surface.worldZ, -85);
  assert.equal(surface.placementPointSource, 'object-position');

  const metadata = buildWorldAssetGeographyMetadata({ category: 'village-house' }, object);
  assert.equal(metadata.family, 'tree');
  assert.equal(metadata.id, 'pine-tree-07');

  const context = validateWorldAssetGeographyRuntimeContext(prepared);
  assert.equal(context.ok, true);
  assert.equal(context.errors.length, 0);

  const missing = validateWorldAssetGeographyRuntimeContext({ object, surface: null });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.errors, ['missing-surface-context']);

  const beforePosition = { ...object.position };
  attachWorldAssetGeographyRuntimeDiagnostics(object, {
    runtimeContext: context,
    decision: { accept: true },
  });
  assert.deepEqual(object.position, beforePosition);
  assert.equal(object.userData.worldAssetGeographyRuntimeContract, WORLD_ASSET_GEOGRAPHY_RUNTIME_CONTRACT_POLICY.id);
  assert.equal(object.userData.worldAssetGeographyDecision.accept, true);

  const repeatA = buildWorldAssetGeographySurface(prepared);
  const repeatB = buildWorldAssetGeographySurface(prepared);
  assert.deepEqual(repeatA, repeatB);

  console.log(JSON.stringify({
    ok: true,
    policy: WORLD_ASSET_GEOGRAPHY_RUNTIME_CONTRACT_POLICY.id,
    checks: 17,
    placementPoint: point,
    family: metadata.family,
  }, null, 2));
}

run();
