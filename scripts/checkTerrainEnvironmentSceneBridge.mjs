import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TERRAIN_ENVIRONMENT_SCENE_BRIDGE_POLICY, sceneObjectEnvironmentContext, annotateEnvironmentObject, sceneEnvironmentSpatialFingerprint, compareSceneEnvironmentFingerprints, validateSceneEnvironmentBridge } from '../src/3d/world/terrainEnvironmentSceneBridge.js';
import { TERRAIN_ENVIRONMENT_ASSET_MANIFEST } from '../src/3d/world/terrainEnvironmentAssetManifest.js';

const root = new THREE.Group();
root.name = 'BirchTree_Bridge';
const material = new THREE.MeshStandardMaterial({ name: 'BirchTree_Bark', color: 0x6f573a, roughness: 0.9, metalness: 0 });
const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4, 0.6), material);
mesh.position.y = 2;
root.add(mesh);

const asset = TERRAIN_ENVIRONMENT_ASSET_MANIFEST.find((entry) => entry.src.includes('birch_trees')) ?? TERRAIN_ENVIRONMENT_ASSET_MANIFEST[0];
const sample = {
  worldX: 80,
  worldZ: -120,
  heightMeters: 28,
  heightAboveSeaMeters: 20,
  slopeDegrees: 7,
  rockWeight: 0.05,
  snowWeight: 0,
  waterWeight: 0,
  waterDepth: 0,
  moisture: 0.64,
  biome: 'forest',
  temperatureC: 11,
  windExposure: 0.34,
  season: 'summer',
  settlementDistance: 380,
  roadDistance: 28,
  distanceFromGroveCenterMeters: 70,
  groveRadiusMeters: 165,
};

const context = sceneObjectEnvironmentContext(root, { asset, category: 'tree', sample, distanceMeters: 44, visibility: 1, seed: 7, seedOrdinal: 3, auditTextures: true });
assert.equal(TERRAIN_ENVIRONMENT_SCENE_BRIDGE_POLICY.annotationOnly, true);
assert.ok(context.profile);
assert.ok(context.lod);
assert.ok(context.spatial);
assert.ok(Number.isFinite(context.density));
assert.ok(Number.isFinite(context.climate.forestScore));
assert.ok(Number.isFinite(context.plan?.distribution?.density ?? 0));
assert.equal(context.annotations.objectTransformUntouched, true);

const annotated = annotateEnvironmentObject(root, { asset, category: 'tree', sample, distanceMeters: 44, seed: 7, seedOrdinal: 3 });
assert.equal(annotated.ok, context.ok);
assert.equal(root.userData.terrainEnvironmentBridge.annotationOnly, true);

const a = sceneEnvironmentSpatialFingerprint([{ root, context: { asset, category: 'tree', sample, distanceMeters: 44, seed: 7, seedOrdinal: 3 } }]);
const b = sceneEnvironmentSpatialFingerprint([{ root, context: { asset, category: 'tree', sample, distanceMeters: 44, seed: 7, seedOrdinal: 3 } }]);
assert.equal(compareSceneEnvironmentFingerprints(a, b).equal, true);
const audit = validateSceneEnvironmentBridge([{ root, context: { asset, category: 'tree', sample, distanceMeters: 44, seed: 7, seedOrdinal: 3 } }]);
assert.equal(audit.acceptance.annotationOnly, true);
assert.equal(audit.acceptance.noGeometryReplacement, true);
assert.equal(audit.acceptance.deterministic, true);

mesh.geometry.dispose();
material.dispose();
console.log(JSON.stringify({ ok: true, category: context.profile?.category, density: context.density, fingerprint: a.hash }));
