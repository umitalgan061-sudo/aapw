import * as THREE from 'three';

/**
 * World-space footprint geometry helpers for `WorldAssetPlacementPipeline.js`.
 *
 * Extracted from `WorldAssetPlacementPipeline.js` (Run 357) to bring that file under
 * GOVERNANCE.md's 600-line file cap (Altın Kural 7) — a pure lossless move, zero logic changes.
 * These functions/constants were already private to the pipeline module (no external importers per
 * a repo-wide grep) and cover one cohesive concern: sampling an object's world-space ground-contact
 * footprint (center, corners, edge midpoints, and disconnected "island" sub-footprints) so the
 * placement core can ground structures without trusting a single origin sample.
 */

function expandBoxWithGeometryCorners(targetBox, geometryBox, matrixWorld, inverseRoot, scratch) {
  for (const x of [geometryBox.min.x, geometryBox.max.x]) {
    for (const y of [geometryBox.min.y, geometryBox.max.y]) {
      for (const z of [geometryBox.min.z, geometryBox.max.z]) {
        scratch.set(x, y, z).applyMatrix4(matrixWorld).applyMatrix4(inverseRoot);
        targetBox.expandByPoint(scratch);
      }
    }
  }
}

const GROUND_CONTACT_BAND_POLICY = Object.freeze({
  minimumMeters: 0.5,
  maximumMeters: 2,
  structureHeightFraction: 0.12,
});

const GROUND_CONTACT_ISLAND_POLICY = Object.freeze({ mergeGapMeters: 1.5, maximumIslands: 4 });

function boxesConnectedInXZ(a, b, gapMeters) {
  const gapX = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const gapZ = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return gapX <= gapMeters && gapZ <= gapMeters;
}

function clusterGroundContactBoxes(boxes) {
  if (!Array.isArray(boxes) || boxes.length <= 1) return boxes?.length ? [boxes[0].clone()] : [];
  const groups = [];
  for (const box of boxes) {
    const touching = [];
    for (let index = 0; index < groups.length; index += 1) {
      if (groups[index].members.some((member) => boxesConnectedInXZ(member, box, GROUND_CONTACT_ISLAND_POLICY.mergeGapMeters))) touching.push(index);
    }
    if (!touching.length) { groups.push({ members: [box], bounds: box.clone() }); continue; }
    const target = groups[touching[0]];
    target.members.push(box); target.bounds.union(box);
    for (let index = touching.length - 1; index >= 1; index -= 1) {
      const merged = groups[touching[index]];
      target.members.push(...merged.members); target.bounds.union(merged.bounds); groups.splice(touching[index], 1);
    }
  }
  const islands = groups.map((group) => group.bounds);
  return islands.length <= GROUND_CONTACT_ISLAND_POLICY.maximumIslands ? islands : [];
}

function rootLocalGeometryBounds(object) {
  object.updateMatrixWorld?.(true);
  const inverseRoot = object.matrixWorld.clone().invert();
  const scratch = new THREE.Vector3();
  const geometryBoxes = [];
  object.traverse?.((node) => {
    if (node?.userData?.terrainFootprintExclude === true || node?.userData?.foundationFootprintExclude === true) return;
    const geometry = node?.geometry;
    if (!geometry?.attributes?.position) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return;
    const nodeBox = new THREE.Box3();
    expandBoxWithGeometryCorners(nodeBox, geometry.boundingBox, node.matrixWorld, inverseRoot, scratch);
    if (!nodeBox.isEmpty()) geometryBoxes.push(nodeBox);
  });
  if (!geometryBoxes.length) return null;

  const allGeometryBox = new THREE.Box3();
  geometryBoxes.forEach((box) => allGeometryBox.union(box));
  if (allGeometryBox.isEmpty()) return null;

  const structureHeight = Math.max(0, allGeometryBox.max.y - allGeometryBox.min.y);
  const groundContactBandMeters = Math.max(
    GROUND_CONTACT_BAND_POLICY.minimumMeters,
    Math.min(
      GROUND_CONTACT_BAND_POLICY.maximumMeters,
      structureHeight * GROUND_CONTACT_BAND_POLICY.structureHeightFraction,
    ),
  );
  const groundContactCeiling = allGeometryBox.min.y + groundContactBandMeters;
  const groundedBox = new THREE.Box3();
  const groundedGeometryBoxes = [];
  for (const box of geometryBoxes) {
    if (box.min.y > groundContactCeiling + 1e-6) continue;
    groundedBox.union(box);
    groundedGeometryBoxes.push(box);
  }

  // Defensive fallback: precision/authoring anomalies must never erase a valid structure footprint.
  const resolvedBox = groundedGeometryBoxes.length > 0 && !groundedBox.isEmpty() ? groundedBox : allGeometryBox;
  const candidateBoxes = groundedGeometryBoxes.length > 0 ? groundedGeometryBoxes : geometryBoxes;
  const islands = clusterGroundContactBoxes(candidateBoxes);
  if (islands.length > 1) resolvedBox.groundContactIslands = islands;
  return resolvedBox;
}

export function worldFootprintFor(object) {
  if (!object?.isObject3D) return null;
  object.updateMatrixWorld?.(true);
  const localBox = rootLocalGeometryBounds(object);
  if (!localBox) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return null;
    const minX = box.min.x;
    const maxX = box.max.x;
    const minZ = box.min.z;
    const maxZ = box.max.z;
    const centerX = (minX + maxX) * 0.5;
    const centerZ = (minZ + maxZ) * 0.5;
    return {
      baseOffsetY: box.min.y - object.position.y,
      orientedFootprint: null,
      footprintIslands: [],
      bounds: Object.freeze({ minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ }),
      points: [
        { label: 'center', x: centerX, z: centerZ },
        { label: 'north-west', x: minX, z: minZ },
        { label: 'north-east', x: maxX, z: minZ },
        { label: 'south-west', x: minX, z: maxZ },
        { label: 'south-east', x: maxX, z: maxZ },
        { label: 'north-mid', x: centerX, z: minZ },
        { label: 'south-mid', x: centerX, z: maxZ },
        { label: 'west-mid', x: minX, z: centerZ },
        { label: 'east-mid', x: maxX, z: centerZ },
      ],
    };
  }

  const localCenterX = (localBox.min.x + localBox.max.x) * 0.5;
  const localCenterZ = (localBox.min.z + localBox.max.z) * 0.5;
  const halfWidth = (localBox.max.x - localBox.min.x) * 0.5;
  const halfDepth = (localBox.max.z - localBox.min.z) * 0.5;
  const localRecords = [
    ['center', localCenterX, localCenterZ],
    ['north-west', localBox.min.x, localBox.min.z],
    ['north-east', localBox.max.x, localBox.min.z],
    ['south-west', localBox.min.x, localBox.max.z],
    ['south-east', localBox.max.x, localBox.max.z],
    ['north-mid', localCenterX, localBox.min.z],
    ['south-mid', localCenterX, localBox.max.z],
    ['west-mid', localBox.min.x, localCenterZ],
    ['east-mid', localBox.max.x, localCenterZ],
  ];
  const points = localRecords.map(([label, localX, localZ]) => {
    const world = object.localToWorld(new THREE.Vector3(localX, localBox.min.y, localZ));
    return { label, x: world.x, z: world.z };
  });
  const centerWorld = object.localToWorld(new THREE.Vector3(localCenterX, localBox.min.y, localCenterZ));
  const xWorld = object.localToWorld(new THREE.Vector3(localCenterX + 1, localBox.min.y, localCenterZ));
  const zWorld = object.localToWorld(new THREE.Vector3(localCenterX, localBox.min.y, localCenterZ + 1));
  const axisXLength = Math.hypot(xWorld.x - centerWorld.x, xWorld.z - centerWorld.z) || 1;
  const axisZLength = Math.hypot(zWorld.x - centerWorld.x, zWorld.z - centerWorld.z) || 1;
  const orientedFootprint = Object.freeze({
    centerX: centerWorld.x,
    centerZ: centerWorld.z,
    axisX: Object.freeze({ x: (xWorld.x - centerWorld.x) / axisXLength, z: (xWorld.z - centerWorld.z) / axisXLength }),
    axisZ: Object.freeze({ x: (zWorld.x - centerWorld.x) / axisZLength, z: (zWorld.z - centerWorld.z) / axisZLength }),
    halfWidthMeters: halfWidth * axisXLength,
    halfDepthMeters: halfDepth * axisZLength,
  });
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minZ = Math.min(...points.map((point) => point.z));
  const maxZ = Math.max(...points.map((point) => point.z));
  const bottomWorldY = Math.min(...localRecords.slice(1, 5).map(([, localX, localZ]) => (
    object.localToWorld(new THREE.Vector3(localX, localBox.min.y, localZ)).y
  )));
  const islandBoxes = Array.isArray(localBox.groundContactIslands) ? localBox.groundContactIslands : [];
  const footprintIslands = islandBoxes.map((islandBox, index) => {
    const islandCenterX = (islandBox.min.x + islandBox.max.x) * 0.5;
    const islandCenterZ = (islandBox.min.z + islandBox.max.z) * 0.5;
    const islandCenter = object.localToWorld(new THREE.Vector3(islandCenterX, islandBox.min.y, islandCenterZ));
    const corners = [
      [islandBox.min.x, islandBox.min.z], [islandBox.max.x, islandBox.min.z],
      [islandBox.max.x, islandBox.max.z], [islandBox.min.x, islandBox.max.z],
    ].map(([localX, localZ]) => object.localToWorld(new THREE.Vector3(localX, islandBox.min.y, localZ)));
    return Object.freeze({
      index, centerX: islandCenter.x, centerZ: islandCenter.z,
      axisX: orientedFootprint.axisX, axisZ: orientedFootprint.axisZ,
      halfWidthMeters: (islandBox.max.x - islandBox.min.x) * 0.5 * axisXLength,
      halfDepthMeters: (islandBox.max.z - islandBox.min.z) * 0.5 * axisZLength,
      bounds: Object.freeze({
        minX: Math.min(...corners.map((point) => point.x)), maxX: Math.max(...corners.map((point) => point.x)),
        minZ: Math.min(...corners.map((point) => point.z)), maxZ: Math.max(...corners.map((point) => point.z)),
      }),
    });
  });
  return {
    baseOffsetY: bottomWorldY - object.position.y,
    orientedFootprint,
    footprintIslands,
    bounds: Object.freeze({ minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ }),
    points,
  };
}
