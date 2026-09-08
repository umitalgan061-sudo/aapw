/**
 * Render adapter for `riverNetwork.js`.
 *
 * The network authority stays renderer-independent. This module converts all accepted river paths
 * into one disconnected BufferGeometry so eight major channels cost one river draw call rather than
 * eight. Existing `rivers.js` remains the optical authority: we borrow the exact animated
 * MeshStandardMaterial produced by `createRiverMesh`, preserving its fog/day-night response and
 * downstream foam shader while replacing only the old single-polyline geometry.
 *
 * The bank breakup in this module is deliberately render-only: river centerlines, terrain heights,
 * owner-map hydrology and collision authority are never modified. Width perturbation is deterministic
 * in world space and curvature-aware so long channels stop reading as uniformly extruded ribbons.
 * The network material adds a second, bounded physical reading layer: outer bends stay slightly
 * faster/cleaner, inner banks accumulate sediment, and irregular bank-edge foam/roughness responds to
 * the already-rendered width asymmetry without changing a single hydrology sample.
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
  id: 'major-river-render-2026-09-02-v3-bank-flow-material',
  renderOnly: true,
  deterministic: true,
  canonicalHeightAuthorityUnchanged: true,
  canonicalHydrologyAuthority: 'world/riverNetwork.js',
  canonicalCenterlinesUnchanged: true,
  canonicalColliderUnchanged: true,
  disconnectedSingleGeometry: true,
  pointWidthAware: true,
  curvatureAwareBankAsymmetry: true,
  worldSpaceBankBreakup: true,
  bankFlowMaterialVariation: true,
  innerBankSedimentResponse: true,
  outerBankCurrentResponse: true,
  irregularBankFoam: true,
  worldSpaceTurbidityBreakup: true,
  worldSpaceRoughnessBreakup: true,
  maximumWaterfallMeshesDesktop: 14,
  maximumWaterfallMeshesMobile: 7,
  verticalSurfaceOffsetMeters: 0.30,
  baseFlowSpeedMetersPerSecond: 1.20,
  gradeFlowGain: 6.0,
  bankBreakupMaximumFraction: 0.16,
  outerBankMaximumFraction: 0.13,
  minimumRenderedHalfWidthMeters: 0.55,
});

const POOL_COLOR = new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.water.riverPool);
const RAPID_COLOR = new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.water.rapid);
const BANK_SEDIMENT_COLOR = new THREE.Color(0x5c6958);
const BANK_AERATED_COLOR = new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.water.foam);
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const smooth01 = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const fract = (value) => value - Math.floor(value);

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

function riverBankNoise(worldX, worldZ, arcLengthMeters, seedOffset) {
  // Irrational carriers plus a hashed low-frequency cell keep the signal deterministic while avoiding
  // a visible repeating sine strip along long rivers. This only affects rendered bank position.
  const carrierA = Math.sin(worldX * 0.0217 + worldZ * 0.0131 + arcLengthMeters * 0.035 + seedOffset * 1.73);
  const carrierB = Math.sin(worldX * -0.0083 + worldZ * 0.0299 - arcLengthMeters * 0.017 + seedOffset * 2.41);
  const cellX = Math.floor(worldX / 61 + seedOffset * 7.0);
  const cellZ = Math.floor(worldZ / 47 - seedOffset * 11.0);
  const hash = fract(Math.sin(cellX * 127.1 + cellZ * 311.7 + seedOffset * 74.7) * 43758.5453123) * 2 - 1;
  return carrierA * 0.46 + carrierB * 0.29 + hash * 0.25;
}

function signedPlanCurvature(previous, point, next) {
  const ax = point.x - previous.x;
  const az = point.z - previous.z;
  const bx = next.x - point.x;
  const bz = next.z - point.z;
  const aLength = Math.hypot(ax, az);
  const bLength = Math.hypot(bx, bz);
  if (aLength < 1e-6 || bLength < 1e-6) return 0;
  const cross = (ax / aLength) * (bz / bLength) - (az / aLength) * (bx / bLength);
  const dot = Math.max(-1, Math.min(1, (ax * bx + az * bz) / (aLength * bLength)));
  const turn = Math.atan2(cross, dot);
  const support = Math.max(8, (aLength + bLength) * 0.5);
  return Math.max(-1, Math.min(1, turn * (72 / support)));
}

function renderedHalfWidths(point, previous, next, arcLengthMeters, widthMeters, riverIndex) {
  const baseHalfWidth = Math.max(MAJOR_RIVER_RENDER_POLICY.minimumRenderedHalfWidthMeters, widthMeters * 0.5);
  const leftNoise = riverBankNoise(point.x, point.z, arcLengthMeters, riverIndex * 2 + 0.37);
  const rightNoise = riverBankNoise(point.x, point.z, arcLengthMeters, riverIndex * 2 + 1.19);
  const curvature = signedPlanCurvature(previous, point, next);
  const bendStrength = smooth01(Math.abs(curvature));
  const outerFraction = bendStrength * MAJOR_RIVER_RENDER_POLICY.outerBankMaximumFraction;
  const breakup = MAJOR_RIVER_RENDER_POLICY.bankBreakupMaximumFraction;
  const leftOuter = curvature < 0 ? outerFraction : -outerFraction * 0.35;
  const rightOuter = curvature > 0 ? outerFraction : -outerFraction * 0.35;
  return {
    left: Math.max(MAJOR_RIVER_RENDER_POLICY.minimumRenderedHalfWidthMeters, baseHalfWidth * (1 + leftNoise * breakup + leftOuter)),
    right: Math.max(MAJOR_RIVER_RENDER_POLICY.minimumRenderedHalfWidthMeters, baseHalfWidth * (1 + rightNoise * breakup + rightOuter)),
    curvature,
  };
}

/**
 * Builds one disconnected ribbon geometry for every accepted river in the network.
 * Each river starts a fresh index strip, so no triangles bridge the end of one river to the source
 * of the next. Per-point network widths naturally grow downstream. Rendered banks gain bounded,
 * deterministic asymmetry while the authoritative centerline remains exactly on each source point.
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
  const bankFactors = new Float32Array(vertexCount);
  const bendFactors = new Float32Array(vertexCount);
  const indices = new Uint32Array(triangleCount * 3);

  let vertexBase = 0;
  let indexCursor = 0;
  let totalFlowLengthMeters = 0;
  let maximumRenderedWidthMeters = 0;
  let maximumBankAsymmetryMeters = 0;
  let maximumAbsoluteCurvature = 0;

  for (let riverIndex = 0; riverIndex < rivers.length; riverIndex += 1) {
    const river = rivers[riverIndex];
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

      if (i > 0) {
        arcLengthMeters += Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z);
      }

      const halfWidths = renderedHalfWidths(point, previous, next, arcLengthMeters, widthMeters, riverIndex);
      const renderedWidthMeters = halfWidths.left + halfWidths.right;
      maximumRenderedWidthMeters = Math.max(maximumRenderedWidthMeters, renderedWidthMeters);
      maximumBankAsymmetryMeters = Math.max(maximumBankAsymmetryMeters, Math.abs(halfWidths.left - halfWidths.right));
      maximumAbsoluteCurvature = Math.max(maximumAbsoluteCurvature, Math.abs(halfWidths.curvature));

      const neighbourhoodRunMeters = Math.hypot(next.x - previous.x, next.z - previous.z) || 1;
      const grade = Math.max(0, (previous.y - next.y) / neighbourhoodRunMeters);
      const flowSpeed = MAJOR_RIVER_RENDER_POLICY.baseFlowSpeedMetersPerSecond
        + Math.sqrt(grade) * MAJOR_RIVER_RENDER_POLICY.gradeFlowGain;
      const rapidMix = smooth01((flowSpeed - 1.2) / (4.5 - 1.2));
      const color = POOL_COLOR.clone().lerp(RAPID_COLOR, rapidMix);
      const leftWetVariation = 0.94 + riverBankNoise(point.x, point.z, arcLengthMeters, riverIndex * 2 + 2.73) * 0.038;
      const rightWetVariation = 0.94 + riverBankNoise(point.x, point.z, arcLengthMeters, riverIndex * 2 + 3.91) * 0.038;
      const bendStrength = smooth01(Math.abs(halfWidths.curvature));
      const leftInner = halfWidths.curvature > 0 ? bendStrength : 0;
      const rightInner = halfWidths.curvature < 0 ? bendStrength : 0;
      const leftOuter = halfWidths.curvature < 0 ? bendStrength : 0;
      const rightOuter = halfWidths.curvature > 0 ? bendStrength : 0;
      const leftColor = color.clone().multiplyScalar(leftWetVariation)
        .lerp(BANK_SEDIMENT_COLOR, leftInner * 0.12)
        .lerp(BANK_AERATED_COLOR, leftOuter * rapidMix * 0.045);
      const rightColor = color.clone().multiplyScalar(rightWetVariation)
        .lerp(BANK_SEDIMENT_COLOR, rightInner * 0.12)
        .lerp(BANK_AERATED_COLOR, rightOuter * rapidMix * 0.045);

      const left = vertexBase + i * 2;
      const right = left + 1;
      positions[left * 3] = point.x + perpendicularX * halfWidths.left;
      positions[left * 3 + 1] = point.y + verticalOffsetMeters;
      positions[left * 3 + 2] = point.z + perpendicularZ * halfWidths.left;
      positions[right * 3] = point.x - perpendicularX * halfWidths.right;
      positions[right * 3 + 1] = point.y + verticalOffsetMeters;
      positions[right * 3 + 2] = point.z - perpendicularZ * halfWidths.right;
      writeColor(colors, left * 3, leftColor);
      writeColor(colors, right * 3, rightColor);
      flowDistances[left] = arcLengthMeters;
      flowDistances[right] = arcLengthMeters;
      flowSpeeds[left] = flowSpeed;
      flowSpeeds[right] = flowSpeed;
      flowSides[left] = -1;
      flowSides[right] = 1;
      bankFactors[left] = halfWidths.left / Math.max(0.001, widthMeters * 0.5);
      bankFactors[right] = halfWidths.right / Math.max(0.001, widthMeters * 0.5);
      bendFactors[left] = halfWidths.curvature;
      bendFactors[right] = halfWidths.curvature;

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
  geometry.setAttribute('aBankFactor', new THREE.BufferAttribute(bankFactors, 1));
  geometry.setAttribute('aBendFactor', new THREE.BufferAttribute(bendFactors, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.majorRiverNetwork = Object.freeze({
    policyId: MAJOR_RIVER_RENDER_POLICY.id,
    riverCount: rivers.length,
    totalFlowLengthMeters,
    maximumRenderedWidthMeters,
    maximumBankAsymmetryMeters,
    maximumAbsoluteCurvature,
    disconnected: true,
    canonicalCenterlinesUnchanged: true,
  });
  return geometry;
}

function installMajorRiverBankMaterial(material) {
  if (!material?.isMeshStandardMaterial) return material;
  if (material.userData?.majorRiverBankMaterial === MAJOR_RIVER_RENDER_POLICY.id) return material;
  const priorCompile = material.onBeforeCompile.bind(material);
  const priorCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    priorCompile(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aBankFactor;\nattribute float aBendFactor;\nvarying float vMajorRiverBankFactor;\nvarying float vMajorRiverBendFactor;\nvarying vec3 vMajorRiverWorldPosition;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvMajorRiverBankFactor=aBankFactor;\nvMajorRiverBendFactor=aBendFactor;\nvMajorRiverWorldPosition=(modelMatrix*vec4(transformed,1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vMajorRiverBankFactor;
varying float vMajorRiverBendFactor;
varying vec3 vMajorRiverWorldPosition;
float majorRiverHash(vec2 p){
  p=fract(p*vec2(0.1031,0.1030));
  p+=dot(p,p.yx+33.33);
  return fract((p.x+p.y)*p.x);
}
float majorRiverNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  float a=majorRiverHash(i),b=majorRiverHash(i+vec2(1.0,0.0));
  float c=majorRiverHash(i+vec2(0.0,1.0)),d=majorRiverHash(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
float majorRiverFbm(vec2 p){
  return majorRiverNoise(p)*0.57+majorRiverNoise(p*2.11+vec2(13.7,-5.1))*0.29+majorRiverNoise(p*4.73+vec2(-8.9,21.4))*0.14;
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float majorRiverBankDistance=clamp(abs(vFlowSide),0.0,1.0);
float majorRiverBend=clamp(vMajorRiverBendFactor,-1.0,1.0);
float majorRiverOuter=smoothstep(0.05,0.70,majorRiverBend*vFlowSide);
float majorRiverInner=smoothstep(0.05,0.70,-majorRiverBend*vFlowSide);
vec2 majorRiverXZ=vMajorRiverWorldPosition.xz;
float majorRiverMacro=majorRiverFbm(majorRiverXZ/180.0+vec2(7.1,-12.3));
float majorRiverMeso=majorRiverFbm(majorRiverXZ/47.0+vec2(-19.4,4.7));
float majorRiverFine=majorRiverNoise(majorRiverXZ/11.0+vec2(31.2,18.6));
float majorRiverBankIrregular=smoothstep(0.48,0.82,majorRiverMacro*0.52+majorRiverMeso*0.34+majorRiverFine*0.14);
float majorRiverSediment=majorRiverInner*majorRiverBankDistance*majorRiverBankIrregular*(1.0-smoothstep(2.2,4.6,vFlowSpeed));
float majorRiverShear=majorRiverOuter*smoothstep(1.5,4.4,vFlowSpeed)*(0.58+majorRiverMeso*0.42);
float majorRiverBankFoam=smoothstep(0.66,0.98,majorRiverBankDistance)*smoothstep(0.53,0.86,majorRiverMeso)*(0.28+majorRiverShear*0.72);
float majorRiverWidthWet=clamp((vMajorRiverBankFactor-0.82)/0.38,0.0,1.0);
vec3 majorRiverSedimentColor=vec3(0.19,0.245,0.205);
vec3 majorRiverDeepCurrent=vec3(0.075,0.285,0.335);
vec3 majorRiverFoamColor=vec3(0.82,0.91,0.90);
diffuseColor.rgb=mix(diffuseColor.rgb,majorRiverSedimentColor,majorRiverSediment*0.18);
diffuseColor.rgb=mix(diffuseColor.rgb,majorRiverDeepCurrent,majorRiverShear*0.12);
diffuseColor.rgb=mix(diffuseColor.rgb,majorRiverFoamColor,majorRiverBankFoam*0.11);
diffuseColor.rgb*=1.0+(majorRiverMacro-0.5)*0.055+(majorRiverFine-0.5)*0.018*majorRiverWidthWet;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
float majorRiverRoughMacro=majorRiverFbm(vMajorRiverWorldPosition.xz/71.0+vec2(5.8,17.1));
float majorRiverRoughBank=smoothstep(0.62,0.98,abs(vFlowSide));
roughnessFactor=clamp(roughnessFactor+(majorRiverRoughMacro-0.5)*0.10+majorRiverRoughBank*0.045-majorRiverShear*0.065,0.18,0.92);`,
      );
  };
  material.customProgramCacheKey = () => `${priorCacheKey()}|${MAJOR_RIVER_RENDER_POLICY.id}`;
  material.userData.majorRiverBankMaterial = MAJOR_RIVER_RENDER_POLICY.id;
  material.needsUpdate = true;
  return material;
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
  installMajorRiverBankMaterial(material);
  material.userData.majorRiverNetwork = Object.freeze({
    policyId: MAJOR_RIVER_RENDER_POLICY.id,
    networkPolicyId: network.policyId,
    riverCount: network.rivers.length,
    singleDrawCall: true,
    naturalizedBanks: true,
    curvatureAwareFlowMaterial: true,
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
      naturalizedBanks: river != null,
      curvatureAwareFlowMaterial: river != null,
      totalLengthMeters: network?.stats?.totalLengthMeters ?? 0,
    }),
  });
}
