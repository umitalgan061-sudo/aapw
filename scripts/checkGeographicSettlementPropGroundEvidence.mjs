import assert from 'node:assert/strict';
import * as THREE from 'three';
import { prepareWorldAssetForPlacement, auditWorldAssetPlacement } from '../src/3d/world/WorldAssetPlacementPipeline.js';

const object = new THREE.Group();
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 2),
  new THREE.MeshStandardMaterial({ name: 'authored-ground-evidence' }),
);
object.add(mesh);

const prepared = prepareWorldAssetForPlacement(object, {
  metadata: { id: 'ground-evidence-prop', category: 'settlement-prop', src: 'assets/models/props/ground-evidence.glb' },
  paletteId: 'wood',
  textureSize: 256,
  position: { x: 18, y: 4, z: -12 },
  groundHeight: 7,
  surfaceQuery: () => ({ height: 7, slopeDegrees: 4, waterDepth: 0, roadDistance: 18 }),
  placementPolicy: { maxSlopeDegrees: 22, maxWaterDepth: 0.02, minRoadDistance: 6 },
  requireSurfaceContext: true,
  requireGeneratedTexture: false,
});

assert.equal(prepared.ok, true, prepared.error);
assert.equal(prepared.surface.height, 7);
assert.equal(prepared.manifest.placementSurface.height, 7);
assert.ok(prepared.manifest.placement);
assert.equal(object.userData.materialReadyForWorld, true);

const audit = auditWorldAssetPlacement(object);
assert.equal(audit.ok, true, audit.errors.join('; '));
assert.equal(audit.surface.height, 7);
assert.ok(audit.manifest.placementSurface);

console.log(JSON.stringify({
  ok: true,
  placementSurface: audit.surface,
  manifestPlacement: audit.manifest.placement,
}));
