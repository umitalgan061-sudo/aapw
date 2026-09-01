#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  NATURAL_GEOLOGY_RENDER_POLICY,
  createNaturalRockPrototypeGeometry,
  resolveNaturalGeologyAssetFamily,
} from '../src/3d/world/naturalGeology.js';

const ROOT = resolve(import.meta.dirname, '..');
const rendererSource = readFileSync(resolve(ROOT, 'src/3d/world/naturalGeology.js'), 'utf8');
const P = NATURAL_GEOLOGY_RENDER_POLICY;

assert(P.id.includes('v7-faceted-fallback-and-biome-assets'));
assert.equal(P.renderOnly, true);
assert.equal(P.geographyAuthorityUnchanged, true);
assert.equal(P.geographicAssetRouting, true);
assert.equal(P.fbxHydrationSupported, true);
assert.equal(P.snowAssetRestrictedToColdHighland, true);
assert.equal(P.valyriaNeverUsesSnowAsset, true);
assert.equal(P.fallbackGeometryFamily, 'stratified-faceted-geologic-ledges');
assert.equal(P.platonicFallbackGeometry, false);
assert.equal(P.directAssetUrls.length, 4);
assert(new Set(P.directAssetUrls).size === P.directAssetUrls.length);
assert.equal(P.smallRockAsset, 'assets/models/fbx/Free_rock_Rock_1.fbx');
assert.equal(P.snowRockAsset, 'assets/models/fbx/snow_terrain_low_poly.glb');
assert.equal(P.knownDirectAssetBytes[P.smallRockAsset], 74044);
assert.equal(P.knownDirectAssetBytes[P.snowRockAsset], 5180716);
for (const asset of P.directAssetUrls) {
  const bytes = P.knownDirectAssetBytes[asset];
  assert(Number.isFinite(bytes) && bytes >= P.hostedPreflightMinBytes, `${asset} missing realistic byte metadata`);
  assert(bytes <= P.maximumHydratedSourceBytes, `${asset} violates hydration source budget`);
}
assert(!P.directAssetUrls.includes(P.referenceLandscapeAsset));

const routeCases = [
  [{ kind: 'asset-proxy', volcanic: true, northness: 1, southernDryness: 0, heightAboveSeaMeters: 600 }, 'rocky-terrain'],
  [{ kind: 'asset-proxy', volcanic: false, northness: 0.90, southernDryness: 0.10, heightAboveSeaMeters: 160 }, 'snow-terrain'],
  [{ kind: 'asset-proxy', volcanic: false, northness: 0.20, southernDryness: 0.25, heightAboveSeaMeters: 460 }, 'snow-terrain'],
  [{ kind: 'asset-proxy', volcanic: false, northness: 0.10, southernDryness: 0.88, heightAboveSeaMeters: 90 }, 'desert-rocks'],
  [{ kind: 'asset-proxy', volcanic: false, northness: 0.42, southernDryness: 0.40, heightAboveSeaMeters: 90, sourceClusterKind: 'boulder-field', slopeDegrees: 22 }, 'free-rock'],
  [{ kind: 'asset-proxy', volcanic: false, northness: 0.42, southernDryness: 0.40, heightAboveSeaMeters: 90, sourceClusterKind: 'bedrock-band', slopeDegrees: 9 }, 'free-rock'],
  [{ kind: 'asset-proxy', volcanic: false, northness: 0.42, southernDryness: 0.40, heightAboveSeaMeters: 90, sourceClusterKind: 'bedrock-band', slopeDegrees: 28 }, 'rocky-terrain'],
];
for (const [placement, expected] of routeCases) {
  assert.equal(resolveNaturalGeologyAssetFamily(placement), expected, `wrong geography asset family for ${JSON.stringify(placement)}`);
}
assert.equal(resolveNaturalGeologyAssetFamily({ kind: 'bedrock' }), null);
assert.equal(resolveNaturalGeologyAssetFamily(null), null);

const kinds = ['fractured-scarp', 'bedrock', 'low-outcrop', 'talus', 'boulder', 'asset-proxy'];
const metrics = {};
for (const kind of kinds) {
  const geometry = createNaturalRockPrototypeGeometry(kind);
  try {
    const position = geometry.getAttribute('position');
    assert(position?.count >= 20, `${kind} has too few silhouette vertices`);
    assert(geometry.index?.count >= 36, `${kind} has too few facets`);
    assert.equal(geometry.userData.naturalRockPrototype, P.fallbackGeometryFamily);
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    const sx = bounds.max.x - bounds.min.x;
    const sy = bounds.max.y - bounds.min.y;
    const sz = bounds.max.z - bounds.min.z;
    assert([sx, sy, sz].every((value) => Number.isFinite(value) && value > 0.08));

    const vertices = [];
    const yLevels = new Set();
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const z = position.getZ(index);
      assert([x, y, z].every(Number.isFinite), `${kind} produced a non-finite vertex`);
      vertices.push(`${x.toFixed(5)}:${y.toFixed(5)}:${z.toFixed(5)}`);
      yLevels.add(Math.round(y * 20));
    }
    assert(new Set(vertices).size > position.count * 0.82, `${kind} geometry collapsed onto repeated vertices`);
    assert(yLevels.size >= 5, `${kind} lost stratified vertical breakup`);

    metrics[kind] = {
      vertices: position.count,
      triangles: geometry.index.count / 3,
      size: [sx, sy, sz].map((value) => Number(value.toFixed(4))),
      yLevelBuckets: yLevels.size,
    };
  } finally {
    geometry.dispose();
  }
}

assert(metrics['fractured-scarp'].size[1] / metrics['fractured-scarp'].size[2] > 1.45,
  'fractured scarp lost its cliff-like vertical silhouette');
assert(metrics['low-outcrop'].size[1] / metrics['low-outcrop'].size[0] < 0.70,
  'low outcrop became an artificial upright boulder');
assert(metrics.talus.size[1] / metrics.talus.size[0] > 0.95,
  'talus shard lost its angular shard silhouette');
assert.notDeepEqual(metrics.bedrock.size, metrics.boulder.size,
  'bedrock and boulder fallback silhouettes became identical');

for (const forbidden of [
  'new THREE.IcosahedronGeometry',
  'new THREE.DodecahedronGeometry',
  'new THREE.TetrahedronGeometry',
]) {
  assert(!rendererSource.includes(forbidden), `Platonic fallback returned: ${forbidden}`);
}
for (const required of [
  'createStratifiedRockGeometry',
  'loadFBXModel',
  'resolveNaturalGeologyAssetFamily',
  "'free-rock'",
  "'snow-terrain'",
  'sourceFormat',
]) {
  assert(rendererSource.includes(required), `asset-diversity wiring missing: ${required}`);
}
assert(rendererSource.indexOf("if (placement.volcanic) return 'rocky-terrain'")
  < rendererSource.indexOf("return 'snow-terrain'"), 'Valyria must be routed before snow/highland routing');

console.log('[checkNaturalGeologyAssetDiversity] PASS');
console.log(JSON.stringify({
  policyId: P.id,
  directAssets: P.directAssetUrls,
  knownDirectAssetBytes: P.knownDirectAssetBytes,
  assetRoutingCases: routeCases.map(([placement, family]) => ({ placement, family })),
  fallbackGeometryFamily: P.fallbackGeometryFamily,
  geometryMetrics: metrics,
}, null, 2));
