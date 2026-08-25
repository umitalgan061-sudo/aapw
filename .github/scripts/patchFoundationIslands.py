from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, got {count}')
    return text.replace(old, new, 1)


pipeline_path = Path('src/3d/world/WorldAssetPlacementPipeline.js')
pipeline = pipeline_path.read_text()
pipeline = replace_once(
    pipeline,
    "      orientedFootprint: footprintGeometry.orientedFootprint || null,\n      points: pointRecords.map((point) => ({ ...point })),",
    "      orientedFootprint: footprintGeometry.orientedFootprint || null,\n      footprintIslands: footprintGeometry.footprintIslands || [],\n      points: pointRecords.map((point) => ({ ...point })),",
    'conform payload islands',
)
pipeline = replace_once(
    pipeline,
    "    orientedFootprint: footprintGeometry.orientedFootprint || null,\n    samples: normalizedSamples.map(stripPlacementCoordinates),",
    "    orientedFootprint: footprintGeometry.orientedFootprint || null,\n    footprintIslands: footprintGeometry.footprintIslands || [],\n    samples: normalizedSamples.map(stripPlacementCoordinates),",
    'stored footprint islands',
)
marker = "const GROUND_CONTACT_BAND_POLICY = Object.freeze({\n  minimumMeters: 0.5,\n  maximumMeters: 2,\n  structureHeightFraction: 0.12,\n});\n"
pipeline = replace_once(
    pipeline,
    marker,
    marker + "\nconst GROUND_CONTACT_ISLAND_POLICY = Object.freeze({ mergeGapMeters: 1.5, maximumIslands: 4 });\n\nfunction boxesConnectedInXZ(a, b, gapMeters) {\n  const gapX = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);\n  const gapZ = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);\n  return gapX <= gapMeters && gapZ <= gapMeters;\n}\n\nfunction clusterGroundContactBoxes(boxes) {\n  if (!Array.isArray(boxes) || boxes.length <= 1) return boxes?.length ? [boxes[0].clone()] : [];\n  const groups = [];\n  for (const box of boxes) {\n    const touching = [];\n    for (let index = 0; index < groups.length; index += 1) {\n      if (groups[index].members.some((member) => boxesConnectedInXZ(member, box, GROUND_CONTACT_ISLAND_POLICY.mergeGapMeters))) touching.push(index);\n    }\n    if (!touching.length) { groups.push({ members: [box], bounds: box.clone() }); continue; }\n    const target = groups[touching[0]];\n    target.members.push(box); target.bounds.union(box);\n    for (let index = touching.length - 1; index >= 1; index -= 1) {\n      const merged = groups[touching[index]];\n      target.members.push(...merged.members); target.bounds.union(merged.bounds); groups.splice(touching[index], 1);\n    }\n  }\n  const islands = groups.map((group) => group.bounds);\n  return islands.length <= GROUND_CONTACT_ISLAND_POLICY.maximumIslands ? islands : [];\n}\n",
    'ground contact island helpers',
)
pipeline = replace_once(
    pipeline,
    "  const groundedBox = new THREE.Box3();\n  let groundedGeometryCount = 0;\n  for (const box of geometryBoxes) {\n    if (box.min.y > groundContactCeiling + 1e-6) continue;\n    groundedBox.union(box);\n    groundedGeometryCount += 1;\n  }\n\n  // Defensive fallback: precision/authoring anomalies must never erase a valid structure footprint.\n  return groundedGeometryCount > 0 && !groundedBox.isEmpty() ? groundedBox : allGeometryBox;",
    "  const groundedBox = new THREE.Box3();\n  const groundedGeometryBoxes = [];\n  for (const box of geometryBoxes) {\n    if (box.min.y > groundContactCeiling + 1e-6) continue;\n    groundedBox.union(box);\n    groundedGeometryBoxes.push(box);\n  }\n\n  // Defensive fallback: precision/authoring anomalies must never erase a valid structure footprint.\n  const resolvedBox = groundedGeometryBoxes.length > 0 && !groundedBox.isEmpty() ? groundedBox : allGeometryBox;\n  const candidateBoxes = groundedGeometryBoxes.length > 0 ? groundedGeometryBoxes : geometryBoxes;\n  const islands = clusterGroundContactBoxes(candidateBoxes);\n  if (islands.length > 1) resolvedBox.groundContactIslands = islands;\n  return resolvedBox;",
    'ground contact clustering',
)
pipeline = replace_once(
    pipeline,
    "      orientedFootprint: null,\n      bounds: Object.freeze({ minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ }),",
    "      orientedFootprint: null,\n      footprintIslands: [],\n      bounds: Object.freeze({ minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ }),",
    'fallback island field',
)
pipeline = replace_once(
    pipeline,
    "  return {\n    baseOffsetY: bottomWorldY - object.position.y,\n    orientedFootprint,\n    bounds: Object.freeze({ minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ }),\n    points,\n  };",
    "  const islandBoxes = Array.isArray(localBox.groundContactIslands) ? localBox.groundContactIslands : [];\n  const footprintIslands = islandBoxes.map((islandBox, index) => {\n    const islandCenterX = (islandBox.min.x + islandBox.max.x) * 0.5;\n    const islandCenterZ = (islandBox.min.z + islandBox.max.z) * 0.5;\n    const islandCenter = object.localToWorld(new THREE.Vector3(islandCenterX, islandBox.min.y, islandCenterZ));\n    const corners = [\n      [islandBox.min.x, islandBox.min.z], [islandBox.max.x, islandBox.min.z],\n      [islandBox.max.x, islandBox.max.z], [islandBox.min.x, islandBox.max.z],\n    ].map(([localX, localZ]) => object.localToWorld(new THREE.Vector3(localX, islandBox.min.y, localZ)));\n    return Object.freeze({\n      index, centerX: islandCenter.x, centerZ: islandCenter.z,\n      axisX: orientedFootprint.axisX, axisZ: orientedFootprint.axisZ,\n      halfWidthMeters: (islandBox.max.x - islandBox.min.x) * 0.5 * axisXLength,\n      halfDepthMeters: (islandBox.max.z - islandBox.min.z) * 0.5 * axisZLength,\n      bounds: Object.freeze({\n        minX: Math.min(...corners.map((point) => point.x)), maxX: Math.max(...corners.map((point) => point.x)),\n        minZ: Math.min(...corners.map((point) => point.z)), maxZ: Math.max(...corners.map((point) => point.z)),\n      }),\n    });\n  });\n  return {\n    baseOffsetY: bottomWorldY - object.position.y,\n    orientedFootprint,\n    footprintIslands,\n    bounds: Object.freeze({ minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ }),\n    points,\n  };",
    'publish footprint islands',
)
pipeline_path.write_text(pipeline)

conformer_path = Path('src/3d/world/terrainFoundationConformer.js')
conformer = conformer_path.read_text()
conformer = replace_once(
    conformer,
    "id: 'runtime-structure-foundation-conform-2026-08-25-v12-shape-aware-rebuild',",
    "id: 'runtime-structure-foundation-conform-2026-08-25-v13-disconnected-islands',",
    'policy id',
)
conformer = replace_once(
    conformer,
    "\tmaximumClusterPads: 4,\n\tchunkRebuildMode:",
    "\tmaximumClusterPads: 16,\n\tmaximumFoundationIslands: 4,\n\tchunkRebuildMode:",
    'island limits',
)
conformer = replace_once(
    conformer,
    "function createAdaptiveCellPads(bounds, orientedFootprint, targetHeight, key, safeInnerMargin, safeFeather) {",
    "function createAdaptiveCellPads(bounds, orientedFootprint, targetHeight, key, safeInnerMargin, safeFeather, islandIndex = 0, islandCount = 1) {",
    'adaptive signature',
)
conformer = replace_once(
    conformer,
    "        foundationClusterIndex: pads.length,\n        foundationClusterSize: columns * rows,\n        footprintBounds:",
    "        foundationClusterIndex: pads.length,\n        foundationClusterSize: columns * rows,\n        foundationIslandIndex: islandIndex,\n        foundationIslandCount: islandCount,\n        footprintBounds:",
    'pad island metadata',
)
conformer = replace_once(
    conformer,
    "\tconst key = structureKey(payload);\n\tconst orientedFootprint = normalizedOrientedFootprint(payload?.orientedFootprint);\n\tconst pads = createAdaptiveCellPads(bounds, orientedFootprint, targetHeight, key, safeInnerMargin, safeFeather);\n\tconst requestedCellRadius = Math.max(...pads.map((pad) => pad.innerRadiusMeters));",
    "\tconst key = structureKey(payload);\n\tconst orientedFootprint = normalizedOrientedFootprint(payload?.orientedFootprint);\n\tconst rawIslands = Array.isArray(payload?.footprintIslands)\n\t\t? payload.footprintIslands.map((entry) => ({ oriented: normalizedOrientedFootprint(entry), bounds: normalizedBounds(entry?.bounds) })).filter((entry) => entry.oriented && entry.bounds)\n\t\t: [];\n\tconst useIslands = rawIslands.length > 1 && rawIslands.length <= TERRAIN_FOUNDATION_CONFORM_POLICY.maximumFoundationIslands;\n\tconst sources = useIslands ? rawIslands : [{ oriented: orientedFootprint, bounds }];\n\tconst pads = sources.flatMap((source, islandIndex) => createAdaptiveCellPads(source.bounds, source.oriented, targetHeight, key, safeInnerMargin, safeFeather, islandIndex, sources.length));\n\tif (pads.length > TERRAIN_FOUNDATION_CONFORM_POLICY.maximumClusterPads) {\n\t\treturn { ok: false, error: 'foundation-too-many-island-pads', requestedPadCount: pads.length, maximumPadCount: TERRAIN_FOUNDATION_CONFORM_POLICY.maximumClusterPads };\n\t}\n\tpads.forEach((pad, index) => { pad.foundationClusterIndex = index; pad.foundationClusterSize = pads.length; });\n\tconst requestedCellRadius = Math.max(...pads.map((pad) => pad.innerRadiusMeters));",
    'build island clusters',
)
conformer = replace_once(
    conformer,
    "\t\t\tfoundationClusterSize: pads.length,\n\t\t\tfootprintBounds:",
    "\t\t\tfoundationClusterSize: pads.length,\n\t\t\tfoundationIslandCount: sources.length,\n\t\t\tfootprintBounds:",
    'compat island count',
)
conformer_path.write_text(conformer)

test_path = Path('scripts/checkDisconnectedFoundationIslands.mjs')
test_path.write_text(r'''#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolveWorldSurfacePlacement } from '../src/3d/world/WorldAssetPlacementPipeline.js';
import { createTerrainFoundationConformer } from '../src/3d/world/terrainFoundationConformer.js';
import { createHeightSampler } from '../src/3d/world/terrain.js';

function addGroundedBox(root, width, depth, x) {
  const geometry = new THREE.BoxGeometry(width, 8, depth);
  geometry.translate(0, 4, 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.position.x = x;
  root.add(mesh);
}

const structure = new THREE.Group();
structure.position.set(80, 0, -45);
structure.rotation.y = Math.PI / 6;
addGroundedBox(structure, 16, 18, -22);
addGroundedBox(structure, 16, 18, 22);
structure.updateMatrixWorld(true);

const baseSampler = createHeightSampler(317, undefined, []);
const flattenPads = [];
const conformedSampler = createHeightSampler(317, undefined, flattenPads);
const conformer = createTerrainFoundationConformer({ flattenPads, innerMarginMeters: 0, featherMeters: 2 });
let payload = null;
const result = resolveWorldSurfacePlacement(structure, {
  metadata: { category: 'building', id: 'two-wing-courtyard' },
  surfaceQuery(x, z) {
    return { height: baseSampler(x, z), slopeDegrees: 3, waterDepth: 0, roadDistance: 5, biome: 'settlement' };
  },
  requireSurfaceContext: true,
  conformTerrain(input) {
    payload = input;
    return conformer.conformTerrain(input);
  },
});
assert.equal(result.ok, true, result.error);
assert.equal(payload?.footprintIslands?.length, 2, 'two disconnected ground-contact wings must publish two foundation islands');
assert.equal(result.footprint?.footprintIslands?.length, 2, 'placement manifest must retain island topology');
assert.equal(flattenPads.length, 8, 'two ordinary islands should receive independent four-pad clusters');
assert(flattenPads.every((pad) => pad.foundationIslandCount === 2), 'all pads must retain the shared island count');
assert.deepEqual([...new Set(flattenPads.map((pad) => pad.foundationIslandIndex))], [0, 1]);

const left = structure.localToWorld(new THREE.Vector3(-22, 0, 0));
const right = structure.localToWorld(new THREE.Vector3(22, 0, 0));
const courtyard = structure.localToWorld(new THREE.Vector3(0, 0, 0));
const target = result.footprint.targetGroundHeight;
assert.equal(conformedSampler(left.x, left.z), target, 'left wing foundation must be fully conformed');
assert.equal(conformedSampler(right.x, right.z), target, 'right wing foundation must be fully conformed');
assert.equal(conformedSampler(courtyard.x, courtyard.z), baseSampler(courtyard.x, courtyard.z), 'open courtyard must preserve canonical terrain');

const regroundHeight = target + 1.25;
const reground = conformer.conformTerrain({ ...payload, targetHeight: regroundHeight });
assert.equal(reground.ok, true, reground.error);
assert.equal(flattenPads.length, 8, 're-grounding must replace the prior island cluster rather than leak pads');
assert.equal(conformedSampler(left.x, left.z), regroundHeight, 'shared sampler must follow the replacement island height');
assert.equal(conformedSampler(right.x, right.z), regroundHeight, 'both islands must share the replacement target plane');
assert.equal(conformedSampler(courtyard.x, courtyard.z), baseSampler(courtyard.x, courtyard.z), 're-grounding must still preserve the courtyard');

const removed = conformer.removeFoundation(structure);
assert.equal(removed.ok, true);
assert.equal(removed.removedCount, 8, 'removing the structure must retire every island pad');
assert.equal(flattenPads.length, 0);
assert.equal(conformedSampler(left.x, left.z), baseSampler(left.x, left.z), 'shared sampler must restore canonical height after island removal');

console.log('[checkDisconnectedFoundationIslands] PASS: disconnected grounded wings preserve the open courtyard, share one target plane/height authority, replace atomically on re-ground, and retire together.');
''')
