#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  STRUCTURE_GROUNDING_POLICY,
  classifyStructureGrounding,
  resolveStructureSurfaceProfile,
} from '../src/3d/world/structureGroundingPolicy.js';
import { resolveWorldSurfacePlacement } from '../src/3d/world/WorldAssetPlacementPipeline.js';
import { isEditorStructureAsset } from '../src/3d/editor/EditorTerrainFoundationGrounder.js';

function makeMesh() {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(18, 9, 12),
    new THREE.MeshBasicMaterial(),
  );
  mesh.geometry.translate(0, 4.5, 0);
  mesh.position.set(72, 100, -46);
  mesh.rotation.y = Math.PI / 7;
  mesh.scale.set(1.2, 1, 0.85);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function place(metadata, userData = {}) {
  const object = makeMesh();
  object.userData = { ...userData };
  let queryCount = 0;
  const result = resolveWorldSurfacePlacement(object, {
    metadata,
    surfaceQuery(x, z) {
      queryCount += 1;
      return {
        height: 24 + x * 0.01 - z * 0.008,
        slopeDegrees: 5,
        waterDepth: 0,
        roadDistance: 10,
        settlementDistance: 18,
        moisture: 0.4,
        biome: 'settlement',
        waterType: 'none',
      };
    },
    requireSurfaceContext: true,
    footprintGrounding: 'auto',
  });
  assert.equal(result.ok, true, `${metadata.id || metadata.category}: ${result.error}`);
  return { result, queryCount };
}

assert.match(STRUCTURE_GROUNDING_POLICY.id, /extended-families/);

const dryFamilies = [
  { id: 'guardhouse', category: 'guardhouse' },
  { id: 'watch-post', subtype: 'frontier-watch-post', category: 'Prop' },
  { id: 'prison', category: 'prison' },
  { id: 'bathhouse', category: 'bathhouse' },
  { id: 'observatory', category: 'observatory' },
  { id: 'grandstand', category: 'grandstand' },
  { id: 'platform', category: 'platform' },
  { id: 'stairs', category: 'stairs' },
  { id: 'staircase', type: 'staircase', category: 'Prop' },
  { id: 'mine-entrance', category: 'mine-entrance' },
  { id: 'tunnel-entrance', category: 'tunnel-entrance' },
  { id: 'tunnel-portal', category: 'tunnel-portal' },
  { id: 'windmill', category: 'windmill' },
  { id: 'watermill', category: 'watermill' },
  { id: 'kiln', category: 'kiln' },
  { id: 'tannery', category: 'tannery' },
  { id: 'smokehouse', category: 'smokehouse' },
  { id: 'dovecote', category: 'dovecote' },
  { id: 'localized-prison', category: 'Hapishane' },
  { id: 'localized-bathhouse', category: 'Hamam' },
  { id: 'localized-observatory', name: 'Kuzey Gözlemevi', category: 'Prop' },
  { id: 'localized-mine', name: 'Demir Madeni Girişi', category: 'Prop' },
  { id: 'localized-tunnel', category: 'Tünel' },
  { id: 'localized-stairs', category: 'Merdiven' },
  { id: 'localized-tannery', category: 'Tabakhane' },
  { id: 'localized-dovecote', category: 'Güvercinlik' },
];

for (const metadata of dryFamilies) {
  const classification = classifyStructureGrounding(metadata);
  assert.equal(classification.isStructure, true, `${metadata.id} must be a terrain-foundation structure`);
  assert.equal(isEditorStructureAsset(metadata), true, `${metadata.id} editor/runtime classifier drift`);
  assert.equal(resolveStructureSurfaceProfile(metadata), 'building', `${metadata.id} must use dry building placement rules`);
  const runtime = place(metadata);
  assert.equal(runtime.queryCount, 9, `${metadata.id} must sample center + corners + edge midpoints`);
  assert.equal(runtime.result.footprint?.samples?.length, 9, `${metadata.id} must expose the full footprint audit`);
}

const watersideFamilies = [
  { id: 'fishery', category: 'fishery' },
  { id: 'customs-house', category: 'customs-house' },
  { id: 'fishery-src', category: 'Prop', src: 'assets/models/coast/fishery.glb' },
];
for (const metadata of watersideFamilies) {
  assert.equal(classifyStructureGrounding(metadata).isStructure, true, `${metadata.id} must classify as structure`);
  assert.equal(resolveStructureSurfaceProfile(metadata), 'waterside', `${metadata.id} must retain shoreline-compatible placement`);
  assert.equal(place(metadata).queryCount, 9, `${metadata.id} must use footprint grounding`);
}

const fallback = place({}, {
  editorId: 'rehydrated-mine-entry',
  category: 'Prop',
  assetSubtype: 'mine-entrance',
});
assert.equal(fallback.queryCount, 9, 'rehydrated extended-family metadata must still trigger footprint grounding');

for (const primitive of ['terrain', 'water', 'tree', 'road', 'soldier']) {
  const metadata = {
    id: `protected-${primitive}`,
    primitive,
    category: 'platform',
    terrainFoundation: true,
    structureLike: true,
  };
  const classification = classifyStructureGrounding(metadata);
  assert.equal(classification.isStructure, false, `${primitive} must stay protected even when a new family term is present`);
  assert.match(classification.reason, /^protected-primitive:/);
  assert.equal(place(metadata).queryCount, 1, `${primitive} must stay on center-only placement`);
}

for (const metadata of [
  { id: 'portal-effect', category: 'Prop', name: 'Magic Portal Effect' },
  { id: 'open-cave', category: 'Prop', name: 'Natural Cave' },
  { id: 'wood-stack', category: 'Prop', name: 'Wood Stack' },
]) {
  assert.equal(classifyStructureGrounding(metadata).isStructure, false, `${metadata.id} must not become structural by loose substring matching`);
}

console.log(JSON.stringify({
  policy: STRUCTURE_GROUNDING_POLICY.id,
  dryExtendedFamilies: dryFamilies.length,
  watersideExtendedFamilies: watersideFamilies.length,
  footprintProbesPerStructure: 9,
  fallbackMetadataCovered: true,
  protectedPrimitiveRegressionCovered: true,
}, null, 2));
