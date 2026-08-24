#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  STRUCTURE_GROUNDING_POLICY,
  classifyStructureGrounding,
  isStructureGroundingCandidate,
  resolveStructureSurfaceProfile,
} from '../src/3d/world/structureGroundingPolicy.js';
import { resolveWorldSurfacePlacement } from '../src/3d/world/WorldAssetPlacementPipeline.js';
import { isEditorStructureAsset } from '../src/3d/editor/EditorTerrainFoundationGrounder.js';

function makeMesh() {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(9, 6, 7),
    new THREE.MeshBasicMaterial(),
  );
  mesh.geometry.translate(0, 3, 0);
  mesh.position.set(35, 100, -22);
  mesh.rotation.y = Math.PI / 9;
  mesh.updateMatrixWorld(true);
  return mesh;
}

function surfaceAt(x, z) {
  return {
    height: 14 + x * 0.025 - z * 0.011,
    slopeDegrees: 4,
    waterDepth: 0,
    roadDistance: 8,
    settlementDistance: 12,
    moisture: 0.45,
    biome: 'settlement',
    waterType: 'none',
  };
}

function runAuto(metadata = {}, userData = {}) {
  const object = makeMesh();
  object.userData = { ...userData };
  let queryCount = 0;
  const result = resolveWorldSurfacePlacement(object, {
    metadata,
    surfaceQuery(x, z) {
      queryCount += 1;
      return surfaceAt(x, z);
    },
    requireSurfaceContext: true,
    footprintGrounding: 'auto',
  });
  assert.equal(result.ok, true, result.error);
  return { object, result, queryCount };
}

assert.match(STRUCTURE_GROUNDING_POLICY.id, /surface-profile/);
assert.equal(STRUCTURE_GROUNDING_POLICY.footprintProbeCount, 9);
assert.equal(STRUCTURE_GROUNDING_POLICY.primaryMetadataOverridesFallback, true);
assert.equal(STRUCTURE_GROUNDING_POLICY.protectedPrimitivesOverrideOptIn, true);
assert.deepEqual(STRUCTURE_GROUNDING_POLICY.surfaceProfiles, ['building', 'bridge', 'waterside']);

const positiveAssets = [
  { id: 'building', category: 'building' },
  { id: 'palace', category: 'palace' },
  { id: 'manor', name: 'Riverlands Manor', category: 'prop' },
  { id: 'watchtower', name: 'Northern Watchtower', category: 'prop' },
  { id: 'lighthouse', category: 'lighthouse' },
  { id: 'warehouse', category: 'warehouse' },
  { id: 'forge', name: 'Village Forge', category: 'prop' },
  { id: 'mill', category: 'mill' },
  { id: 'crypt', category: 'crypt' },
  { id: 'temple', category: 'temple' },
  { id: 'abbey', category: 'abbey' },
  { id: 'barracks', category: 'barracks' },
  { id: 'shipyard', category: 'shipyard' },
  { id: 'aqueduct', category: 'aqueduct' },
  { id: 'dock', category: 'dock' },
  { id: 'pier', category: 'pier' },
  { id: 'ruin', category: 'ruin' },
  { id: 'well', category: 'well' },
  { id: 'localized-building', category: 'Bina' },
  { id: 'localized-palace', category: 'Saray' },
  { id: 'localized-watchtower', name: 'Gözetleme Kulesi', category: 'Prop' },
  { id: 'localized-pier', name: 'Balıkçı İskelesi', category: 'Prop' },
  { id: 'localized-shipyard', category: 'Tersane' },
  { id: 'localized-mill', category: 'Değirmen' },
  { id: 'localized-workshop', category: 'Atölye' },
  { id: 'localized-temple', category: 'Tapınak' },
  { id: 'localized-library', category: 'Kütüphane' },
  { id: 'localized-fountain', category: 'Çeşme' },
  { id: 'alias-category', assetCategory: 'Saray' },
  { id: 'src-signal', src: 'models/fortress/gatehouse.glb', category: 'Prop' },
];

for (const asset of positiveAssets) {
  const classification = classifyStructureGrounding(asset);
  assert.equal(classification.isStructure, true, `${asset.id} must classify as a structure: ${classification.reason}`);
  assert.equal(isStructureGroundingCandidate(asset), true, `${asset.id} shared classifier mismatch`);
  assert.equal(isEditorStructureAsset(asset), true, `${asset.id} editor wrapper must use shared classifier`);
  const runtime = runAuto(asset);
  assert.equal(runtime.queryCount, 9, `${asset.id} runtime auto grounding must sample the full 9-probe footprint`);
  assert.equal(runtime.result.footprint?.samples?.length, 9, `${asset.id} runtime auto grounding must expose nine surface samples`);
  assert.equal(runtime.result.footprint?.groundingMode, 'embedded-low-side');
}

for (const metadata of [
  { category: 'palace' },
  { category: 'temple' },
  { category: 'Saray' },
  { name: 'Gözetleme Kulesi', category: 'Prop' },
  { structureLike: true, category: 'custom-import' },
]) {
  assert.equal(resolveStructureSurfaceProfile(metadata), 'building',
    `${JSON.stringify(metadata)} should use the dry building surface profile`);
}
for (const metadata of [
  { category: 'bridge' },
  { category: 'aqueduct' },
  { category: 'Köprü' },
  { name: 'Taş Köprüsü', category: 'Prop' },
]) {
  assert.equal(resolveStructureSurfaceProfile(metadata), 'bridge',
    `${JSON.stringify(metadata)} should use the spanning bridge surface profile`);
}
for (const metadata of [
  { category: 'dock' },
  { category: 'pier' },
  { category: 'shipyard' },
  { category: 'lighthouse' },
  { name: 'Balıkçı İskelesi', category: 'Prop' },
  { category: 'Tersane' },
  { name: 'Kuzey Limanı', category: 'Prop' },
]) {
  assert.equal(resolveStructureSurfaceProfile(metadata), 'waterside',
    `${JSON.stringify(metadata)} should use the waterside structure surface profile`);
}
assert.equal(resolveStructureSurfaceProfile({}, { category: 'Saray' }), 'building',
  'surface profile must consume fallback object metadata for rehydrated structures');
assert.equal(resolveStructureSurfaceProfile({}, { name: 'Balıkçı İskelesi', category: 'Prop' }), 'waterside',
  'rehydrated waterside structures must retain their waterside profile');
assert.equal(resolveStructureSurfaceProfile({ structureLike: false }, { category: 'castle' }), null,
  'primary explicit opt-out must suppress fallback surface profiles');
assert.equal(resolveStructureSurfaceProfile({ primitive: 'tree', category: 'Bina', structureLike: true }), null,
  'protected primitives must never receive a structure surface profile');

const explicitCustom = { id: 'custom-hall', category: 'Prop', structureLike: true };
assert.equal(classifyStructureGrounding(explicitCustom).reason, 'explicit-opt-in');
assert.equal(runAuto(explicitCustom).queryCount, 9, 'explicit custom structures must use runtime footprint grounding');

const fallbackRuntime = runAuto({}, {
  editorId: 'rehydrated-great-hall',
  structureLike: true,
  category: 'custom-import',
  src: 'imports/great-hall.glb',
});
assert.equal(fallbackRuntime.queryCount, 9,
  'runtime auto grounding must consume object userData when library metadata is absent');
assert.equal(fallbackRuntime.result.footprint?.samples?.length, 9);

const fallbackNameRuntime = runAuto({}, {
  editorId: 'rehydrated-watchtower',
  name: 'Coastal Watchtower',
  category: 'Prop',
});
assert.equal(fallbackNameRuntime.queryCount, 9,
  'runtime auto grounding must classify rehydrated structure names from object userData');

const optedOut = runAuto(
  { id: 'instance-opt-out', structureLike: false },
  { structureLike: true, name: 'Castle Keep', category: 'castle' },
);
assert.equal(optedOut.queryCount, 1,
  'primary asset metadata explicit opt-out must override fallback object structure signals');
assert.equal(optedOut.result.footprint, null);

for (const primitive of ['tree', 'road-segment', 'water-cell', 'terrain-cell', 'soldier']) {
  const metadata = {
    id: `protected-${primitive}`,
    primitive,
    category: 'Bina',
    structureLike: true,
    terrainFoundation: true,
  };
  const classification = classifyStructureGrounding(metadata);
  assert.equal(classification.isStructure, false, `${primitive} must remain protected from terrain foundations`);
  assert.match(classification.reason, /^protected-primitive:/);
  assert.equal(isEditorStructureAsset(metadata), false, `${primitive} editor classification must respect hard exclusion`);
  assert.equal(resolveStructureSurfaceProfile(metadata), null, `${primitive} must not receive a structure surface profile`);
  const runtime = runAuto(metadata);
  assert.equal(runtime.queryCount, 1, `${primitive} runtime auto grounding must stay on center sampling`);
  assert.equal(runtime.result.footprint, null, `${primitive} must not own a terrain footprint`);
}

for (const metadata of [
  { id: 'ordinary-prop', category: 'Prop', name: 'Wooden Crate' },
  { id: 'ordinary-rock', category: 'rock', name: 'Granite Boulder' },
  { id: 'ordinary-vegetation', category: 'vegetation', name: 'Low Shrub' },
]) {
  assert.equal(isStructureGroundingCandidate(metadata), false, `${metadata.id} must remain non-structural`);
  assert.equal(isEditorStructureAsset(metadata), false, `${metadata.id} editor wrapper mismatch`);
  assert.equal(resolveStructureSurfaceProfile(metadata), null, `${metadata.id} must not receive a structure surface profile`);
  const runtime = runAuto(metadata);
  assert.equal(runtime.queryCount, 1, `${metadata.id} must keep the center-grounding path`);
  assert.equal(runtime.result.footprint, null);
}

console.log(JSON.stringify({
  policy: STRUCTURE_GROUNDING_POLICY.id,
  positiveStructureFamilies: positiveAssets.length,
  footprintProbeCount: STRUCTURE_GROUNDING_POLICY.footprintProbeCount,
  surfaceProfiles: STRUCTURE_GROUNDING_POLICY.surfaceProfiles,
  fallbackObjectMetadata: true,
  primaryOptOutWins: true,
  protectedPrimitiveCount: 5,
  editorRuntimeClassifierShared: true,
}, null, 2));
