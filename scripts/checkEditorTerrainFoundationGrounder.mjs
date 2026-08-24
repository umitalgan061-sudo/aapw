#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEditorTerrainFoundationGrounder, isEditorStructureAsset } from '../src/3d/editor/EditorTerrainFoundationGrounder.js';

const flattenPads = [];
const loaded = new Map([['0,0', { name: 'terrain-0-0' }]]);
let rebuilds = 0;
const chunkManager = {
  loaded,
  flattenPads,
  chunkSizeMeters: 100,
  unloadChunk(x, z) {
    loaded.delete(`${x},${z}`);
    rebuilds += 1;
  },
  loadChunk(x, z) {
    const mesh = { name: `terrain-${x}-${z}-rebuilt` };
    loaded.set(`${x},${z}`, mesh);
    return mesh;
  },
};

function flattenWeight(distance, inner, outer) {
  if (distance <= inner) return 1;
  if (distance >= outer) return 0;
  const t = 1 - (distance - inner) / (outer - inner);
  return t * t * (3 - 2 * t);
}

function baseHeight(x, z) {
  return 20 + x * 0.08 - z * 0.035;
}

function orientedFootprintProbePoints(orientedFootprint) {
  assert(orientedFootprint, 'rotated structures must publish oriented footprint geometry');
  const { centerX, centerZ, axisX, axisZ, halfWidthMeters, halfDepthMeters } = orientedFootprint;
  const point = (alongX, alongZ) => ({
    x: centerX + axisX.x * halfWidthMeters * alongX + axisZ.x * halfDepthMeters * alongZ,
    z: centerZ + axisX.z * halfWidthMeters * alongX + axisZ.z * halfDepthMeters * alongZ,
  });
  return [
    point(0, 0),
    point(-1, -1), point(1, -1), point(-1, 1), point(1, 1),
    point(0, -1), point(0, 1), point(-1, 0), point(1, 0),
  ];
}

const groundCollider = {
  getGroundHeight(x, z) {
    const raw = baseHeight(x, z);
    let strongest = 0;
    let anchor = raw;
    for (const pad of flattenPads) {
      const weight = flattenWeight(Math.hypot(x - pad.x, z - pad.z), pad.innerRadiusMeters, pad.outerRadiusMeters);
      if (weight > strongest) {
        strongest = weight;
        anchor = pad.anchorHeightMeters;
      }
    }
    return strongest > 0 ? raw + (anchor - raw) * strongest : raw;
  },
};

const grounder = createEditorTerrainFoundationGrounder({ chunkManager, groundCollider });
const castleAsset = { id: 'castle-test', name: 'Northern Keep', category: 'castle', src: 'keep.glb' };
assert.equal(isEditorStructureAsset(castleAsset), true);
assert.equal(isEditorStructureAsset({ id: 'editor-building-001', name: 'Taş Konut', category: 'Bina' }), true, 'localized Bina category must use footprint foundations');
assert.equal(isEditorStructureAsset({ id: 'editor-architecture-001', name: 'Dekoratif Yapı', category: 'Mimari' }), true, 'localized Mimari category must use footprint foundations');
assert.equal(isEditorStructureAsset({ id: 'waterside-001', name: 'Balıkçı İskelesi', category: 'Prop' }), true, 'dock/pier-like authored names must use footprint foundations');
assert.equal(isEditorStructureAsset({ id: 'custom-structure', category: 'Prop', structureLike: true }), true, 'authors can explicitly opt custom structures into terrain foundations');
assert.equal(isEditorStructureAsset({ id: 'fake-building-sign', category: 'Prop', structureLike: false }), false, 'explicit non-structure metadata must override naming heuristics');
assert.equal(isEditorStructureAsset({ id: 'tree-test', primitive: 'tree', category: 'vegetation' }), false);
assert.equal(isEditorStructureAsset({ id: 'road-building-marker', primitive: 'road-segment', category: 'Bina' }), false, 'terrain/road primitives must never create foundations even if mislabeled');

for (const asset of [
  { id: 'palace-01', category: 'palace' },
  { id: 'watchtower-01', name: 'Coastal Watchtower', category: 'prop' },
  { id: 'lighthouse-01', category: 'lighthouse' },
  { id: 'warehouse-01', category: 'warehouse' },
  { id: 'forge-01', name: 'Village Forge', category: 'prop' },
  { id: 'mill-01', category: 'mill' },
  { id: 'crypt-01', category: 'crypt' },
  { id: 'shipyard-01', category: 'shipyard' },
  { id: 'aqueduct-01', category: 'aqueduct' },
  { id: 'well-01', category: 'well' },
  { id: 'saray-01', category: 'Saray' },
  { id: 'gozetleme-01', name: 'Gözetleme Kulesi', category: 'Prop' },
  { id: 'tersane-01', category: 'Tersane' },
  { id: 'degirmen-01', category: 'Değirmen' },
  { id: 'atolye-01', category: 'Atölye' },
  { id: 'cesme-01', category: 'Çeşme' },
]) {
  assert.equal(isEditorStructureAsset(asset), true, `${asset.id} must use footprint terrain foundations`);
}

const castle = new THREE.Mesh(new THREE.BoxGeometry(12, 8, 10), new THREE.MeshBasicMaterial());
castle.geometry.translate(0, 4, 0);
castle.rotation.y = Math.PI / 7;
castle.userData.editorId = 'castle-test-placed-0001';
const first = grounder.groundObject(castle, castleAsset, { x: 8, z: -6 });
assert.equal(first.ok, true, first.error);
assert.equal(first.mode, 'terrain-conform');
assert.equal(first.footprint?.samples?.length, 9);
assert(first.footprint?.orientedFootprint, 'rotated castle must expose its real oriented footprint');
assert.equal(flattenPads.length, 4, 'first non-degenerate structural placement must register one four-pad terrain cluster');
assert(flattenPads.every((pad) => pad.foundationClusterSize === 4), 'castle cluster must advertise its four-pad footprint size');
assert.equal(castle.userData.editorFoundationKey, 'asset:castle-test-placed-0001');
assert(rebuilds >= 1, 'resident terrain intersecting the pad cluster must rebuild');

const firstCastlePads = [...flattenPads];
const firstAnchorHeight = first.footprint.targetGroundHeight;
assert(firstCastlePads.every((pad) => pad.anchorHeightMeters === firstAnchorHeight), 'all pads in one structure cluster must share the footprint target height');
for (const sample of orientedFootprintProbePoints(first.footprint.orientedFootprint)) {
  assert(
    Math.abs(groundCollider.getGroundHeight(sample.x, sample.z) - firstAnchorHeight) < 1e-6,
    'shared collider must read the newly installed foundation plane across the complete oriented footprint',
  );
}
const aabbCorner = { x: first.footprint.bounds.minX, z: first.footprint.bounds.minZ };
const aabbBaseHeight = baseHeight(aabbCorner.x, aabbCorner.z);
const aabbConformedHeight = groundCollider.getGroundHeight(aabbCorner.x, aabbCorner.z);
const fullFoundationDelta = firstAnchorHeight - aabbBaseHeight;
const actualAabbDelta = aabbConformedHeight - aabbBaseHeight;
assert(Math.abs(fullFoundationDelta) > 1e-6, 'AABB feather regression requires a measurable foundation/base height difference');
assert(
  Math.abs(actualAabbDelta) < Math.abs(fullFoundationDelta) * 0.98,
  'terrain inside the world AABB but outside the true rotated footprint must not be locked to the full foundation plane; bounded feather influence is allowed',
);

const beforeRepeat = flattenPads.length;
const second = grounder.groundObject(castle, castleAsset, { x: 9, z: -5 });
assert.equal(second.ok, true, second.error);
assert.equal(flattenPads.length, beforeRepeat, 're-grounding the same editor id must replace, not duplicate, its pad cluster');
assert(firstCastlePads.every((pad) => !flattenPads.includes(pad)), 're-grounding must retire the old physical pad cluster');
assert(flattenPads.every((pad) => pad.foundationKey === castle.userData.terrainFoundationKey), 'replacement cluster must retain the same runtime-object foundation identity');
const expectedSecondUnderlyingMax = Math.max(
  ...orientedFootprintProbePoints(second.footprint.orientedFootprint).map(({ x, z }) => baseHeight(x, z)),
);
assert(
  Math.abs(second.footprint.targetGroundHeight - expectedSecondUnderlyingMax) < 1e-9,
  `re-grounding must sample canonical terrain beneath its own old pad; expected ${expectedSecondUnderlyingMax}, got ${second.footprint.targetGroundHeight}`,
);
assert(
  Math.abs(second.footprint.targetGroundHeight - firstAnchorHeight) > 1e-4,
  'moving a structure inside its former pad must not feed the stale foundation height back into the new foundation',
);
assert(flattenPads.every((pad) => pad.anchorHeightMeters === second.footprint.targetGroundHeight),
  'shared collider/render cluster must receive the newly sampled underlying-terrain target');

const localizedBuilding = new THREE.Mesh(new THREE.BoxGeometry(7, 5, 9), new THREE.MeshBasicMaterial());
localizedBuilding.geometry.translate(0, 2.5, 0);
localizedBuilding.userData.editorId = 'localized-building-placed-0001';
const localizedResult = grounder.groundObject(localizedBuilding, {
  id: 'asset-001',
  name: 'Kuzey Konutu',
  category: 'Bina',
}, { x: 55, z: 18 });
assert.equal(localizedResult.ok, true, localizedResult.error);
assert.equal(localizedResult.mode, 'terrain-conform', 'localized building metadata must reach the footprint conformer');
assert.equal(localizedResult.footprint?.samples?.length, 9);
assert.equal(flattenPads.length, beforeRepeat + 4, 'second distinct structure must own an independent four-pad foundation cluster');

const importedStructure = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 8), new THREE.MeshBasicMaterial());
importedStructure.geometry.translate(0, 3, 0);
importedStructure.userData = {
  editorId: 'imported-structure-0001',
  structureLike: true,
  category: 'custom-import',
  src: 'imports/custom-great-hall.glb',
};
const importedResult = grounder.groundObject(importedStructure, null, { x: -34, z: 21 });
assert.equal(importedResult.ok, true, importedResult.error);
assert.equal(importedResult.mode, 'terrain-conform', 'object metadata must opt library-external structures into terrain conforming');
assert.equal(importedResult.footprint?.samples?.length, 9, 'imported custom structures must use the complete footprint probe set');
assert.equal(importedStructure.userData.editorFoundationKey, 'asset:imported-structure-0001');
assert.equal(flattenPads.length, beforeRepeat + 8, 'imported structure must own an independent four-pad shared foundation cluster');

const tree = new THREE.Mesh(new THREE.BoxGeometry(1, 4, 1), new THREE.MeshBasicMaterial());
tree.geometry.translate(0, 2, 0);
tree.userData.editorId = 'tree-placed-0001';
const treeResult = grounder.groundObject(tree, { id: 'tree', primitive: 'tree', category: 'vegetation' }, { x: 40, z: 30 });
assert.equal(treeResult.ok, true, treeResult.error);
assert.equal(treeResult.mode, 'center-base');
assert.equal(flattenPads.length, beforeRepeat + 8, 'non-structures must never deform terrain');
tree.updateMatrixWorld(true);
const treeBox = new THREE.Box3().setFromObject(tree);
assert(Math.abs(treeBox.min.y - groundCollider.getGroundHeight(40, 30)) < 1e-6);

const removed = grounder.removeObjectFoundation(castle);
assert.equal(removed.ok, true, removed.error);
assert.equal(removed.removedPadCount, 4, 'single editor structure removal must retire its whole physical pad cluster');
assert.equal(removed.removedCount, 1, 'editor-facing single removal count must remain structure-based');
assert.equal(flattenPads.length, 8, 'removing one structure foundation must preserve the other two four-pad clusters');
const localizedRemoved = grounder.removeObjectFoundation(localizedBuilding);
assert.equal(localizedRemoved.ok, true, localizedRemoved.error);
assert.equal(flattenPads.length, 4, 'localized foundation removal must preserve imported structure cluster');
const importedRemoved = grounder.removeObjectFoundation(importedStructure);
assert.equal(importedRemoved.ok, true, importedRemoved.error);
assert.equal(flattenPads.length, 0, 'removing all structures must restore the shared pad authority');

console.log('[checkEditorTerrainFoundationGrounder] PASS: broad English/Turkish/custom/imported structure families conform shared render/physics terrain with compact oriented four-pad clusters, rotated AABB-only terrain is never locked to the full foundation plane beyond the real footprint, protected primitives stay center-grounded, repeated grounding ignores stale self-foundation feedback without leaking old pads, and structure-level removal counts remain independent of physical pad counts.');
