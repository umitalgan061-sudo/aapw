/**
 * Render adapter for `riverNetwork.js`.
 *
 * The network authority stays renderer-independent. This module converts all accepted river paths
 * into one disconnected BufferGeometry so eight major channels cost one river draw call rather than
 * eight. Existing `rivers.js` remains the optical authority: we borrow the exact animated
 * MeshStandardMaterial produced by `createRiverMesh`, preserving its fog/day-night response and
 * downstream foam shader while replacing only the old single-polyline geometry.
 *
 * @module world/riverNetworkRender
 */

import * as THREE from 'three';
import {
  createRiverMesh,
  createWaterfallMesh,
  detectWaterfalls,
} from './rivers.js';
import { GEOGRAPHIC_REFERENCE_PALETTE } from './geographicReferencePalette.js';

export const MAJOR_RIVER_RENDER_POLICY = Object.freeze({
  id: 'major-river-render-2026-09-01-v1-single-draw-network',
  renderOnly: true,
  canonicalHeightAuthorityUnchanged: true,
  canonicalHydrologyAuthority: 'world/riverNetwork.js',
  disconnectedSingleGeometry: true,
  pointWidthAware: true,
  maximumWaterfallMeshesDesktop: 14,
  maximumWaterfallMeshesMobile: 7,
  verticalSurfaceOffsetMeters: 0.30,
  baseFlowSpeedMetersPerSecond: 1.20,
  gradeFlowGain: 6.0,
});

const POOL_COLOR = new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.water.riverPool);
const RAPID_COLOR = new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.water.rapid);
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const smooth01 = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

function localWidth(point, fallbackWidth) {
  const width = Number(point?.widthMeters);
  return Number.isFinite(width) && width > 0.5 ? width : fallbackWidth;
}

function writeColor(target, offset, color) {
  target[offset] = color.r;
  target[offset + 1] = color.g;
  target[offset + 2] = color.b;
}

function countNetworkVertices(network) {
  return (network?.rivers ?? []).reduce((sum, river) => sum + (river?.points?.length ?? 0) * 2, 0);
}

function countNetworkTriangles(network) {
  return (network?.rivers ?? []).reduce((sum, river) => {
    const count = river?.points?.length ?? 0;
    return sum + Math.max(0, count - 1) * 2;
  }, 0);
}

/**
 * Builds one disconnected ribbon geometry for every accepted river in the network.
 * Each river starts a fresh index strip, so no triangles bridge the end of one river to the source
 * of the next. Per-point network widths naturally grow downstream.
 */
export function createMajorRiverNetworkGeometry(network, {
  fallbackWidthMeters = 10,
  verticalOffsetMeters = MAJOR_RIVER_RENDER_POLICY.verticalSurfaceOffsetMeters,
} = {}) {
  const rivers = network?.rivers ?? [];
  const vertexCount = countNetworkVertices(network);
  const triangleCount = countNetworkTriangles(network);
  if (vertexCount < 4 || triangleCount < 2) return null;

  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const flowDistances = new Float32Array(vertexCount);
  const flowSpeeds = new Float32Array(vertexCount);
  const flowSides = new Float32Array(vertexCount);
  const indices = new Uint32Array(triangleCount * 3);

  let vertexBase = 0;
  let indexCursor = 0;
  let totalFlowLengthMeters = 0;
  let maximumRenderedWidthMeters = 0;

  for (const river of rivers) {
    const points = river?.points ?? [];
    if (points.length < 2) continue;
    let arcLengthMeters = 0;

    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      const previous = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      const tangentX = next.x - previous.x;
      const tangentZ = next.z - previous.z;
      const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
      const perpendicularX = -tangentZ / tangentLength;
      const perpendicularZ = tangentX / tangentLength;
      const widthMeters = localWidth(point, fallbackWidthMeters);
      const halfWidth = widthMeters * 0.5;
      maximumRenderedWidthMeters = Math.max(maximumRenderedWidthMeters, widthMeters);

      if (i > 0) {
        arcLengthMeters += Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z);
      }

      const neighbourhoodRunMeters = Math.hypot(next.x - previous.x, next.z - previous.z) || 1;
      const grade = Math.max(0, (previous.y - next.y) / neighbourhoodRunMeters);
      const flowSpeed = MAJOR_RIVER_RENDER_POLICY.baseFlowSpeedMetersPerSecond
        + Math.sqrt(grade) * MAJOR_RIVER_RENDER_POLICY.gradeFlowGain;
      const rapidMix = smooth01((flowSpeed - 1.2) / (4.5 - 1.2));
      const color = POOL_COLOR.clone().lerp(RAPID_COLOR, rapidMix);

      const left = vertexBase + i * 2;
      const right = left + 1;
      positions[left * 3] = point.x + perpendicularX * halfWidth;
      positions[left * 3 + 1] = point.y + verticalOffsetMeters;
      positions[left * 3 + 2] = point.z + perpendicularZ * halfWidth;
      positions[right * 3] = point.x - perpendicularX * halfWidth;
      positions[right * 3 + 1] = point.y + verticalOffsetMeters;
      positions[right * 3 + 2] = point.z - perpendicularZ * halfWidth;
      writeColor(colors, left * 3, color);
      writeColor(colors, right * 3, color);
      flowDistances[left] = arcLengthMeters;
      flowDistances[right] = arcLengthMeters;
      flowSpeeds[left] = flowSpeed;
      flowSpeeds[right] = flowSpeed;
      flowSides[left] = -1;
      flowSides[right] = 1;

      if (i > 0) {
        const previousLeft = left - 2;
        const previousRight = right - 2;
        indices[indexCursor++] = previousLeft;
        indices[indexCursor++] = previousRight;
        indices[indexCursor++] = left;
        indices[indexCursor++] = previousRight;
        indices[indexCursor++] = right;
        indices[indexCursor++] = left;
      }
    }

    totalFlowLengthMeters += arcLengthMeters;
    vertexBase += points.length * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aFlowDistance', new THREE.BufferAttribute(flowDistances, 1));
  geometry.setAttribute('aFlowSpeed', new THREE.BufferAttribute(flowSpeeds, 1));
  geometry.setAttribute('aFlowSide', new THREE.BufferAttribute(flowSides, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.majorRiverNetwork = Object.freeze({
    policyId: MAJOR_RIVER_RENDER_POLICY.id,
    riverCount: rivers.length,
    totalFlowLengthMeters,
    maximumRenderedWidthMeters,
    disconnected: true,
  });
  return geometry;
}

function createAnimatedRiverMaterial(network) {
  const firstRiver = network?.rivers?.find((river) => river?.points?.length >= 2);
  if (!firstRiver) return null;
  // `createRiverMesh` is the existing visual authority. We only borrow its configured material;
  // the temporary geometry is disposed immediately and never reaches the scene.
  const prototype = createRiverMesh(firstRiver.points, firstRiver.points[0]?.widthMeters ?? 10);
  if (!prototype) return null;
  const material = prototype.material;
  prototype.geometry.dispose();
  material.userData.majorRiverNetwork = Object.freeze({
    policyId: MAJOR_RIVER_RENDER_POLICY.id,
    networkPolicyId: network.policyId,
    riverCount: network.rivers.length,
    singleDrawCall: true,
  });
  return material;
}

export function createMajorRiverNetworkMesh(network) {
  const geometry = createMajorRiverNetworkGeometry(network);
  if (!geometry) return null;
  const material = createAnimatedRiverMaterial(network);
  if (!material) {
    geometry.dispose();
    return null;
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'major-river-network';
  mesh.frustumCulled = true;
  mesh.userData.majorRiverNetwork = Object.freeze({
    policyId: MAJOR_RIVER_RENDER_POLICY.id,
    networkPolicyId: network.policyId,
    stats: network.stats,
  });
  return mesh;
}

function waterfallCandidates(network) {
  const candidates = [];
  for (let riverIndex = 0; riverIndex < (network?.rivers?.length ?? 0); riverIndex += 1) {
    const river = network.rivers[riverIndex];
    const falls = detectWaterfalls(river.points);
    for (const fall of falls) {
      let nearestIndex = 0;
      let nearestDistance = Infinity;
      for (let pointIndex = 0; pointIndex < river.points.length; pointIndex += 1) {
        const point = river.points[pointIndex];
        const distance = Math.hypot(point.x - fall.top.x, point.z - fall.top.z);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = pointIndex;
        }
      }
      candidates.push({
        riverIndex,
        fall,
        widthMeters: localWidth(river.points[nearestIndex], 10),
      });
    }
  }
  candidates.sort((a, b) => b.fall.dropMeters - a.fall.dropMeters || a.riverIndex - b.riverIndex);
  return candidates;
}

export function createMajorRiverWaterfalls(network, { isMobileClass = false } = {}) {
  const maximum = isMobileClass
    ? MAJOR_RIVER_RENDER_POLICY.maximumWaterfallMeshesMobile
    : MAJOR_RIVER_RENDER_POLICY.maximumWaterfallMeshesDesktop;
  const selected = waterfallCandidates(network).slice(0, maximum);
  return selected.map(({ riverIndex, fall, widthMeters }, index) => {
    const mesh = createWaterfallMesh(fall, widthMeters);
    mesh.name = `major-river-waterfall-${riverIndex}-${index}`;
    mesh.userData.majorRiverNetwork = Object.freeze({
      policyId: MAJOR_RIVER_RENDER_POLICY.id,
      riverIndex,
      dropMeters: fall.dropMeters,
    });
    return mesh;
  });
}

export function createMajorRiverRenderSet(network, options = {}) {
  const river = createMajorRiverNetworkMesh(network);
  const waterfalls = createMajorRiverWaterfalls(network, options);
  return Object.freeze({
    river,
    waterfalls: Object.freeze(waterfalls),
    stats: Object.freeze({
      policyId: MAJOR_RIVER_RENDER_POLICY.id,
      riverCount: network?.stats?.riverCount ?? 0,
      waterfallCount: waterfalls.length,
      singleRiverDrawCall: river != null,
      totalLengthMeters: network?.stats?.totalLengthMeters ?? 0,
    }),
  });
}
