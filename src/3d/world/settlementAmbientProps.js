/**
 * Deterministic ambient prop dressing around canonical kingdom-seat settlements.
 *
 * This layer never creates a settlement coordinate and never changes terrain, hydrology, roads,
 * colliders or gameplay. It samples only the already-authoritative kingdom-seat anchors, live terrain
 * height field and routed roads, then places small non-interactive visual props in the outer castle
 * apron. The immediate representation is three low-cost instanced fallback families; desktop builds
 * opportunistically hydrate those placements from existing repository GLBs while preserving authored
 * maps and adding deterministic world-space weathering so repeated props do not read as cloned toys.
 * @module world/settlementAmbientProps
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AssetLoader } from '../assetLoader.js';
import { mulberry32 } from './terrain.js';
import { distancePointToSegment2D } from './vegetation.js';
import { northReferenceCryosphereAtWorldXZ } from './northReferenceCryosphere.js';
import { valyriaInfluenceAtWorldXZ } from './valyriaGeology.js';
import { resolveWorldSurfacePlacement } from './WorldAssetPlacementPipeline.js';

export const SETTLEMENT_AMBIENT_PROP_POLICY = Object.freeze({
  id: 'settlement-ambient-props-2026-09-02-v2-route-facing-surface-fabric',
  renderOnly: true,
  deterministic: true,
  canonicalSettlementAnchorsUnchanged: true,
  canonicalTerrainUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalRoadsUnchanged: true,
  canonicalCollidersUnchanged: true,
  gameplayInactive: true,
  innerRadiusMeters: 52,
  outerRadiusMeters: 86,
  desktopPropsPerSeat: 5,
  mobilePropsPerSeat: 3,
  minimumPropSpacingMeters: 8.5,
  minimumRoadDistanceMeters: 7,
  shorelineClearanceMeters: 1.5,
  maximumSlopeDegrees: 14,
  terrainSlopeSampleMeters: 2.5,
  maximumAttemptsPerProp: 18,
  logisticsSlotsPerSeat: 3,
  routeApproachMinSampleMeters: 28,
  routeApproachMaxSampleMeters: 145,
  routeShoulderAngleMinRadians: 0.38,
  routeShoulderAngleMaxRadians: 1.02,
  fallbackFabricTextureSize: 64,
  fallbackFabricRepeat: 2.6,
  hostedPreflightMinBytes: 512,
  maximumHydratedSourceBytes: 12 * 1024 * 1024,
  maximumHydratedPrimitiveCount: 18,
  sourceExtentEpsilonMeters: 0.001,
  maximumSourceAspectRatio: 24,
  groupName: 'settlement-ambient-props',
  hydratedGroupName: 'settlement-ambient-props-hydrated',
  placementAuthority: 'kingdom-seat + collider-owned terrain + routed roads',
  routeFacingDistribution: true,
  fallbackSurfaceFabric: true,
  climateAuthorities: Object.freeze([
    'northReferenceCryosphereAtWorldXZ',
    'valyriaInfluenceAtWorldXZ',
  ]),
});

export const SETTLEMENT_AMBIENT_PROP_FAMILIES = Object.freeze({
  barrel: Object.freeze({
    id: 'barrel',
    assetUrl: 'assets/models/props/barrel_zjCQP1TAci.glb',
    targetHorizontalMeters: 0.92,
    fallbackColor: 0x6d4b2f,
    roughnessFloor: 0.76,
    weatheringKind: 'wood',
  }),
  crate: Object.freeze({
    id: 'crate',
    assetUrl: 'assets/models/props/crate_3OEFd1AWfa.glb',
    targetHorizontalMeters: 1.18,
    fallbackColor: 0x725337,
    roughnessFloor: 0.79,
    weatheringKind: 'wood',
  }),
  bench: Object.freeze({
    id: 'bench',
    assetUrl: 'assets/models/props/greek_stone_bench.glb',
    targetHorizontalMeters: 2.65,
    fallbackColor: 0x817b70,
    roughnessFloor: 0.87,
    weatheringKind: 'stone',
  }),
});

const FAMILY_IDS = Object.freeze(Object.keys(SETTLEMENT_AMBIENT_PROP_FAMILIES));
const tempObject = new THREE.Object3D();
const tempMatrix = new THREE.Matrix4();
const tempColor = new THREE.Color();
const inFlightUpgrades = new WeakMap();
const clamp01 = (value) => Math.max(0, Math.min(1, value));

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function profileAtWorldXZ(x, z) {
  const north = northReferenceCryosphereAtWorldXZ(x, z) || {};
  const permanentIce = clamp01(finite(north.permanentIce));
  const tundra = clamp01(finite(north.tundra));
  const snow = clamp01(permanentIce * 0.92 + tundra * 0.36);
  const valyria = clamp01(finite(valyriaInfluenceAtWorldXZ(x, z)));
  return Object.freeze({ permanentIce, tundra, snow, valyria });
}

export function sampleAmbientPropTerrainFrame(sampleHeightMeters, x, z, offsetMeters = SETTLEMENT_AMBIENT_PROP_POLICY.terrainSlopeSampleMeters) {
  const offset = Math.max(0.5, finite(offsetMeters, 2.5));
  const height = sampleHeightMeters(x, z);
  const hPosX = sampleHeightMeters(x + offset, z);
  const hNegX = sampleHeightMeters(x - offset, z);
  const hPosZ = sampleHeightMeters(x, z + offset);
  const hNegZ = sampleHeightMeters(x, z - offset);
  if (![height, hPosX, hNegX, hPosZ, hNegZ].every(Number.isFinite)) {
    return Object.freeze({ height: Number.NaN, slopeDegrees: Number.POSITIVE_INFINITY, gradientX: 0, gradientZ: 0 });
  }
  const gradientX = (hPosX - hNegX) / (offset * 2);
  const gradientZ = (hPosZ - hNegZ) / (offset * 2);
  const slopeDegrees = Math.atan(Math.hypot(gradientX, gradientZ)) * 180 / Math.PI;
  return Object.freeze({ height, slopeDegrees, gradientX, gradientZ });
}

export function distanceToAmbientRoads(x, z, roadEdges = []) {
  let minimum = Infinity;
  for (const edge of roadEdges) {
    const points = edge?.points || [];
    for (let index = 1; index < points.length; index += 1) {
      minimum = Math.min(minimum, distancePointToSegment2D(
        x,
        z,
        points[index - 1].x,
        points[index - 1].z,
        points[index].x,
        points[index].z,
      ));
    }
  }
  return minimum;
}

function distanceToNearestSeat(x, z, seats = []) {
  let minimum = Infinity;
  for (const seat of seats) minimum = Math.min(minimum, Math.hypot(x - seat.x, z - seat.z));
  return minimum;
}

export function createAmbientPropSurfaceQuery({ sampleHeightMeters, seaLevelMeters, seats, roadEdges }) {
  return (x, z) => {
    const frame = sampleAmbientPropTerrainFrame(sampleHeightMeters, x, z);
    const waterDepth = Math.max(0, seaLevelMeters - frame.height);
    return {
      height: frame.height,
      slopeDegrees: frame.slopeDegrees,
      waterDepth,
      roadDistance: distanceToAmbientRoads(x, z, roadEdges),
      settlementDistance: distanceToNearestSeat(x, z, seats),
      moisture: null,
      biome: null,
      waterType: waterDepth > 0 ? 'water' : null,
    };
  };
}

function nearestRoadApproachAngle(seat, roadEdges = []) {
  const policy = SETTLEMENT_AMBIENT_PROP_POLICY;
  let best = null;
  for (const edge of roadEdges) {
    for (const point of edge?.points || []) {
      const dx = point.x - seat.x;
      const dz = point.z - seat.z;
      const distance = Math.hypot(dx, dz);
      if (distance < policy.routeApproachMinSampleMeters || distance > policy.routeApproachMaxSampleMeters) continue;
      const incident = edge.fromId === seat.id || edge.toId === seat.id;
      const score = distance + (incident ? -1000 : 0);
      if (!best || score < best.score) best = { score, angle: Math.atan2(dz, dx), incident };
    }
  }
  return best ? Object.freeze({ angle: best.angle, incident: best.incident }) : null;
}

function candidateAngleForSlot(rng, slot, approach) {
  const policy = SETTLEMENT_AMBIENT_PROP_POLICY;
  if (!approach || slot >= policy.logisticsSlotsPerSeat) return { angle: rng() * Math.PI * 2, role: 'social', routeFacing: false };
  const side = slot % 2 === 0 ? -1 : 1;
  const shoulder = policy.routeShoulderAngleMinRadians
    + rng() * (policy.routeShoulderAngleMaxRadians - policy.routeShoulderAngleMinRadians);
  return { angle: approach.angle + side * shoulder, role: 'logistics', routeFacing: true };
}

function familyForPlacement(roll, profile, slopeDegrees, role = 'social') {
  const snow = profile.snow;
  const valyria = profile.valyria;
  if (role === 'logistics') {
    if (snow > 0.62 || valyria > 0.48) return roll < 0.52 ? 'crate' : roll < 0.88 ? 'barrel' : 'bench';
    return roll < 0.54 ? 'barrel' : roll < 0.93 ? 'crate' : 'bench';
  }
  if (snow > 0.62) return roll < 0.66 ? 'bench' : roll < 0.86 ? 'crate' : 'barrel';
  if (valyria > 0.48) return roll < 0.70 ? 'bench' : roll < 0.88 ? 'crate' : 'barrel';
  if (slopeDegrees > 9.5) return roll < 0.42 ? 'crate' : roll < 0.66 ? 'barrel' : 'bench';
  return roll < 0.18 ? 'barrel' : roll < 0.36 ? 'crate' : 'bench';
}

function placementTint(familyId, profile, variation) {
  const family = SETTLEMENT_AMBIENT_PROP_FAMILIES[familyId];
  tempColor.setHex(family.fallbackColor);
  if (profile.snow > 0.01) tempColor.lerp(new THREE.Color(0xc6ced0), profile.snow * (familyId === 'bench' ? 0.32 : 0.22));
  if (profile.valyria > 0.01) tempColor.lerp(new THREE.Color(0x302b29), profile.valyria * (familyId === 'bench' ? 0.38 : 0.48));
  tempColor.offsetHSL((variation - 0.5) * 0.012, (variation - 0.5) * 0.05, (variation - 0.5) * 0.12);
  return tempColor.clone();
}

function isInsideWorld(x, z, worldWidthMeters, worldDepthMeters, margin = 4) {
  if (!Number.isFinite(worldWidthMeters) || !Number.isFinite(worldDepthMeters)) return true;
  return Math.abs(x) <= worldWidthMeters * 0.5 - margin && Math.abs(z) <= worldDepthMeters * 0.5 - margin;
}

function acceptedCandidate(candidate, {
  sampleHeightMeters,
  seaLevelMeters,
  seats,
  roadEdges,
  placed,
  worldWidthMeters,
  worldDepthMeters,
}) {
  const policy = SETTLEMENT_AMBIENT_PROP_POLICY;
  if (!isInsideWorld(candidate.x, candidate.z, worldWidthMeters, worldDepthMeters)) return null;
  const frame = sampleAmbientPropTerrainFrame(sampleHeightMeters, candidate.x, candidate.z);
  if (!Number.isFinite(frame.height) || frame.height <= seaLevelMeters + policy.shorelineClearanceMeters) return null;
  if (frame.slopeDegrees > policy.maximumSlopeDegrees) return null;
  const roadDistance = distanceToAmbientRoads(candidate.x, candidate.z, roadEdges);
  if (roadDistance < policy.minimumRoadDistanceMeters) return null;
  if (placed.some((other) => Math.hypot(candidate.x - other.x, candidate.z - other.z) < policy.minimumPropSpacingMeters)) return null;
  const nearestSeatDistance = distanceToNearestSeat(candidate.x, candidate.z, seats);
  if (nearestSeatDistance + 0.001 < candidate.anchorDistanceMeters - 2) return null;
  return { frame, roadDistance };
}

export function checksumSettlementAmbientPlacements(placements = []) {
  const stable = placements.map((placement) => [
    placement.id,
    placement.seatId,
    placement.familyId,
    placement.x.toFixed(3),
    placement.y.toFixed(3),
    placement.z.toFixed(3),
    placement.yawRadians.toFixed(4),
    placement.scale.toFixed(4),
    placement.slopeDegrees.toFixed(3),
    placement.roadDistanceMeters.toFixed(3),
    placement.distributionRole,
    placement.routeFacing ? 'route' : 'free',
    placement.snow.toFixed(4),
    placement.valyria.toFixed(4),
  ].join(':')).join('|');
  return fnv1a(stable).toString(16).padStart(8, '0');
}

export function generateSettlementAmbientPropPlacements({
  sampleHeightMeters,
  seaLevelMeters,
  seed,
  seats,
  roadEdges,
  worldWidthMeters = Infinity,
  worldDepthMeters = Infinity,
  isMobileClass = false,
}) {
  const policy = SETTLEMENT_AMBIENT_PROP_POLICY;
  if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters is required');
  if (!Array.isArray(seats) || !Array.isArray(roadEdges)) throw new TypeError('seats and roadEdges arrays are required');

  const rng = mulberry32((Number(seed) || 0) ^ 0x4150524e);
  const placements = [];
  const rejectionCounts = { attemptsExhausted: 0, invalidSurface: 0 };
  const targetPerSeat = isMobileClass ? policy.mobilePropsPerSeat : policy.desktopPropsPerSeat;

  let routeApproachSeatCount = 0;
  for (const seat of seats) {
    if (!Number.isFinite(seat?.x) || !Number.isFinite(seat?.z)) continue;
    const roadApproach = nearestRoadApproachAngle(seat, roadEdges);
    if (roadApproach) routeApproachSeatCount += 1;
    let placedForSeat = 0;
    for (let slot = 0; slot < targetPerSeat; slot += 1) {
      let accepted = null;
      const slotDistribution = candidateAngleForSlot(rng, slot, roadApproach);
      for (let attempt = 0; attempt < policy.maximumAttemptsPerProp; attempt += 1) {
        const sampledDistribution = attempt === 0
          ? slotDistribution
          : candidateAngleForSlot(rng, slot, roadApproach);
        const angle = sampledDistribution.angle;
        const radius = Math.sqrt(rng() * (policy.outerRadiusMeters ** 2 - policy.innerRadiusMeters ** 2) + policy.innerRadiusMeters ** 2);
        const candidate = {
          x: seat.x + Math.cos(angle) * radius,
          z: seat.z + Math.sin(angle) * radius,
          anchorDistanceMeters: radius,
          angle,
          distributionRole: sampledDistribution.role,
          routeFacing: sampledDistribution.routeFacing,
          roadApproachAngle: roadApproach?.angle ?? null,
        };
        const surface = acceptedCandidate(candidate, {
          sampleHeightMeters,
          seaLevelMeters,
          seats,
          roadEdges,
          placed: placements,
          worldWidthMeters,
          worldDepthMeters,
        });
        if (!surface) { rejectionCounts.invalidSurface += 1; continue; }
        accepted = { ...candidate, ...surface };
        break;
      }
      if (!accepted) { rejectionCounts.attemptsExhausted += 1; continue; }

      const profile = profileAtWorldXZ(accepted.x, accepted.z);
      const familyId = familyForPlacement(rng(), profile, accepted.frame.slopeDegrees, accepted.distributionRole);
      const family = SETTLEMENT_AMBIENT_PROP_FAMILIES[familyId];
      const variation = rng();
      const scale = (0.88 + rng() * 0.24) * (familyId === 'bench' ? 1.04 : 1);
      const facesSeat = Math.atan2(seat.x - accepted.x, seat.z - accepted.z);
      const yawRadians = familyId === 'bench' ? facesSeat + (rng() - 0.5) * 0.34 : rng() * Math.PI * 2;
      placements.push(Object.freeze({
        id: `${seat.id}-ambient-${slot}`,
        seatId: seat.id,
        familyId,
        x: accepted.x,
        y: accepted.frame.height,
        z: accepted.z,
        yawRadians,
        scale,
        targetHorizontalMeters: family.targetHorizontalMeters * scale,
        slopeDegrees: accepted.frame.slopeDegrees,
        roadDistanceMeters: accepted.roadDistance,
        seatDistanceMeters: accepted.anchorDistanceMeters,
        distributionRole: accepted.distributionRole,
        routeFacing: accepted.routeFacing,
        roadApproachAngle: accepted.roadApproachAngle,
        snow: profile.snow,
        permanentIce: profile.permanentIce,
        tundra: profile.tundra,
        valyria: profile.valyria,
        variation,
        tintHex: placementTint(familyId, profile, variation).getHex(),
      }));
      placedForSeat += 1;
    }
    if (placedForSeat === 0) rejectionCounts.attemptsExhausted += 1;
  }

  const familyCounts = Object.fromEntries(FAMILY_IDS.map((familyId) => [familyId, 0]));
  const climateCounts = { snow: 0, valyria: 0, temperate: 0 };
  const roleCounts = { logistics: 0, social: 0 };
  for (const placement of placements) {
    familyCounts[placement.familyId] += 1;
    roleCounts[placement.distributionRole] = (roleCounts[placement.distributionRole] || 0) + 1;
    if (placement.snow >= 0.25) climateCounts.snow += 1;
    else if (placement.valyria >= 0.25) climateCounts.valyria += 1;
    else climateCounts.temperate += 1;
  }

  const stats = Object.freeze({
    seatCount: seats.length,
    targetCount: seats.length * targetPerSeat,
    placedCount: placements.length,
    familyCounts: Object.freeze({ ...familyCounts }),
    climateCounts: Object.freeze({ ...climateCounts }),
    roleCounts: Object.freeze({ ...roleCounts }),
    routeApproachSeatCount,
    rejectionCounts: Object.freeze({ ...rejectionCounts }),
    placementChecksum: checksumSettlementAmbientPlacements(placements),
  });
  return Object.freeze({ placements: Object.freeze(placements), stats });
}

function mergeTranslatedBox(width, height, depth, x, y, z) {
  const geometry = new THREE.BoxGeometry(width, height, depth, 1, 1, 1);
  geometry.translate(x, y, z);
  return geometry;
}

export function createAmbientFallbackGeometry(familyId) {
  if (familyId === 'barrel') {
    const body = new THREE.CylinderGeometry(0.42, 0.45, 1.0, 12, 3, false);
    body.translate(0, 0.5, 0);
    const topBand = new THREE.TorusGeometry(0.43, 0.035, 4, 12);
    topBand.rotateX(Math.PI / 2);
    topBand.translate(0, 0.83, 0);
    const bottomBand = topBand.clone();
    bottomBand.translate(0, -0.65, 0);
    const merged = mergeGeometries([body, topBand, bottomBand], false);
    body.dispose(); topBand.dispose(); bottomBand.dispose();
    merged.computeVertexNormals();
    return merged;
  }
  if (familyId === 'bench') {
    const seat = mergeTranslatedBox(2.4, 0.24, 0.68, 0, 0.83, 0);
    const legA = mergeTranslatedBox(0.34, 0.72, 0.5, -0.72, 0.36, 0);
    const legB = mergeTranslatedBox(0.34, 0.72, 0.5, 0.72, 0.36, 0);
    const merged = mergeGeometries([seat, legA, legB], false);
    seat.dispose(); legA.dispose(); legB.dispose();
    merged.computeVertexNormals();
    return merged;
  }
  const box = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
  box.translate(0, 0.5, 0);
  return box;
}

function fallbackFabricHash(x, y, seed) {
  let value = Math.imul((x + 1) ^ seed, 0x45d9f3b) ^ Math.imul((y + 7) ^ (seed >>> 1), 0x27d4eb2d);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 15;
  return (value >>> 0) / 4294967295;
}

export function createAmbientFallbackFabricTextures(familyId) {
  const policy = SETTLEMENT_AMBIENT_PROP_POLICY;
  const size = policy.fallbackFabricTextureSize;
  const colorData = new Uint8Array(size * size * 4);
  const roughnessData = new Uint8Array(size * size * 4);
  const seed = fnv1a(`ambient-fabric:${familyId}`);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const noise = fallbackFabricHash(x, y, seed);
      const coarse = fallbackFabricHash(Math.floor(x / 7), Math.floor(y / 7), seed ^ 0xa511e9b3);
      const woodGrain = 0.5 + 0.5 * Math.sin((x * 0.43 + y * 0.075) + coarse * 3.2);
      const stoneMottle = clamp01(coarse * 0.72 + noise * 0.28);
      const fabric = familyId === 'bench' ? stoneMottle : clamp01(woodGrain * 0.58 + noise * 0.42);
      const luminance = Math.round(176 + fabric * 72);
      colorData[index] = luminance;
      colorData[index + 1] = luminance;
      colorData[index + 2] = luminance;
      colorData[index + 3] = 255;
      const roughness = Math.round(180 + (familyId === 'bench' ? stoneMottle : 1 - woodGrain) * 70);
      roughnessData[index] = roughness;
      roughnessData[index + 1] = roughness;
      roughnessData[index + 2] = roughness;
      roughnessData[index + 3] = 255;
    }
  }
  const map = new THREE.DataTexture(colorData, size, size, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.DataTexture(roughnessData, size, size, THREE.RGBAFormat);
  for (const texture of [map, roughnessMap]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(policy.fallbackFabricRepeat, policy.fallbackFabricRepeat);
    texture.needsUpdate = true;
    texture.userData.settlementAmbientFallbackFabric = true;
  }
  return Object.freeze({ map, roughnessMap });
}

function weatheringShaderKey(kind, snow = 0, ash = 0) {
  return `settlement-ambient-fabric-v1:${kind}:s${Math.round(snow * 4)}:a${Math.round(ash * 4)}`;
}

export function applyAmbientPropWorldSpaceWeathering(material, { kind = 'wood', snow = 0, ash = 0 } = {}) {
  if (!material || !material.isMaterial) return material;
  const snowAmount = clamp01(snow);
  const ashAmount = clamp01(ash);
  const roughnessBase = kind === 'stone' ? 0.88 : kind === 'metal' ? 0.63 : 0.80;
  const normalGain = kind === 'stone' ? 0.105 : kind === 'metal' ? 0.035 : 0.075;
  const previous = material.onBeforeCompile?.bind(material);
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  material.userData ||= {};
  material.userData.settlementAmbientWeathering = Object.freeze({
    worldSpace: true,
    multiScaleAlbedo: true,
    microNormal: true,
    roughnessVariation: true,
    authoredMapsPreserved: Boolean(material.map || material.normalMap || material.roughnessMap),
    snowAmount,
    ashAmount,
    kind,
  });
  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAmbientPropWorldPosition;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec4 ambientPropWorldPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
ambientPropWorldPosition = instanceMatrix * ambientPropWorldPosition;
#endif
vAmbientPropWorldPosition = (modelMatrix * ambientPropWorldPosition).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vAmbientPropWorldPosition;
float ambientPropHash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 43.17);
  return fract(p.x * p.y);
}
float ambientPropNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = ambientPropHash(i);
  float b = ambientPropHash(i + vec2(1.0, 0.0));
  float c = ambientPropHash(i + vec2(0.0, 1.0));
  float d = ambientPropHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec2 ambientPropXZ = vAmbientPropWorldPosition.xz;
float ambientMacro = ambientPropNoise(ambientPropXZ * 0.013 + vec2(7.3, -4.8));
float ambientMeso = ambientPropNoise(ambientPropXZ * 0.067 + vec2(-19.1, 11.7));
float ambientFine = ambientPropNoise(ambientPropXZ * 0.47 + vec2(31.9, -27.4));
float ambientWeather = (ambientMacro - 0.5) * 0.18 + (ambientMeso - 0.5) * 0.11 + (ambientFine - 0.5) * 0.045;
diffuseColor.rgb *= 1.0 + ambientWeather;
float ambientSnowPatch = smoothstep(0.48, 0.79, ambientMeso * 0.72 + ambientFine * 0.28) * ${snowAmount.toFixed(4)};
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.82, 0.83), ambientSnowPatch * ${kind === 'stone' ? '0.48' : '0.34'});
float ambientAshPatch = smoothstep(0.42, 0.76, 1.0 - ambientMacro * 0.62 - ambientMeso * 0.38) * ${ashAmount.toFixed(4)};
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.105, 0.095, 0.090), ambientAshPatch * ${kind === 'stone' ? '0.34' : '0.46'});`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
float ambientNx = ambientPropNoise(ambientPropXZ * 0.93 + vec2(0.17, 0.0)) - ambientPropNoise(ambientPropXZ * 0.93 - vec2(0.17, 0.0));
float ambientNz = ambientPropNoise(ambientPropXZ * 0.93 + vec2(0.0, 0.17)) - ambientPropNoise(ambientPropXZ * 0.93 - vec2(0.0, 0.17));
normal = normalize(normal + mat3(viewMatrix) * vec3(ambientNx, 0.0, ambientNz) * ${normalGain.toFixed(4)});`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(max(roughnessFactor, ${roughnessBase.toFixed(3)}) + (ambientMeso - 0.5) * 0.14 + (ambientFine - 0.5) * 0.07 + ambientSnowPatch * 0.08 + ambientAshPatch * 0.10, 0.48, 1.0);`);
  };
  material.customProgramCacheKey = () => `${previousCacheKey?.() || ''}|${weatheringShaderKey(kind, snowAmount, ashAmount)}`;
  material.needsUpdate = true;
  return material;
}

function createFallbackMaterial(familyId) {
  const family = SETTLEMENT_AMBIENT_PROP_FAMILIES[familyId];
  const fabric = createAmbientFallbackFabricTextures(familyId);
  const material = new THREE.MeshStandardMaterial({
    color: family.fallbackColor,
    map: fabric.map,
    roughnessMap: fabric.roughnessMap,
    roughness: family.roughnessFloor,
    metalness: 0,
    flatShading: familyId !== 'crate',
  });
  material.userData.settlementAmbientFallbackFabric = true;
  applyAmbientPropWorldSpaceWeathering(material, { kind: family.weatheringKind });
  return material;
}

function familyIdFallbackScale(familyId, scale) {
  if (familyId === 'barrel') return { x: scale, y: scale, z: scale };
  if (familyId === 'bench') return { x: scale * 1.02, y: scale, z: scale };
  return { x: scale, y: scale, z: scale };
}

function composeFallbackMatrix(placement) {
  tempObject.position.set(placement.x, placement.y, placement.z);
  tempObject.rotation.set(0, placement.yawRadians, 0);
  const base = familyIdFallbackScale(placement.familyId, placement.scale);
  tempObject.scale.set(base.x, base.y, base.z);
  tempObject.updateMatrix();
  return tempMatrix.copy(tempObject.matrix);
}

function createFallbackFamilyMesh(familyId, placements) {
  if (!placements.length) return null;
  const mesh = new THREE.InstancedMesh(createAmbientFallbackGeometry(familyId), createFallbackMaterial(familyId), placements.length);
  mesh.name = `settlement-ambient-fallback-${familyId}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  placements.forEach((placement, index) => {
    mesh.setMatrixAt(index, composeFallbackMatrix(placement));
    mesh.setColorAt(index, new THREE.Color(placement.tintHex));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere?.();
  mesh.userData.placementIds = placements.map((placement) => placement.id);
  mesh.userData.familyId = familyId;
  mesh.userData.settlementAmbientFallback = true;
  return mesh;
}

export function createSettlementAmbientProps(options) {
  const placementResult = generateSettlementAmbientPropPlacements(options);
  const group = new THREE.Group();
  group.name = SETTLEMENT_AMBIENT_PROP_POLICY.groupName;
  const fallbackMeshes = [];
  for (const familyId of FAMILY_IDS) {
    const placements = placementResult.placements.filter((placement) => placement.familyId === familyId);
    const mesh = createFallbackFamilyMesh(familyId, placements);
    if (mesh) fallbackMeshes.push(mesh);
  }
  group.add(...fallbackMeshes);
  group.userData.settlementAmbientPlacements = placementResult.placements;
  group.userData.settlementAmbientSources = [];
  group.userData.settlementAmbient = Object.freeze({
    policyId: SETTLEMENT_AMBIENT_PROP_POLICY.id,
    placementAuthority: SETTLEMENT_AMBIENT_PROP_POLICY.placementAuthority,
    renderOnly: true,
    gameplayInactive: true,
    canonicalGeographyUnchanged: true,
    placementChecksum: placementResult.stats.placementChecksum,
    placementCount: placementResult.stats.placedCount,
    targetCount: placementResult.stats.targetCount,
    familyCounts: placementResult.stats.familyCounts,
    climateCounts: placementResult.stats.climateCounts,
    roleCounts: placementResult.stats.roleCounts,
    routeApproachSeatCount: placementResult.stats.routeApproachSeatCount,
    fallbackDrawCalls: fallbackMeshes.length,
    assetState: 'procedural-fallback',
    hydratedPlacementCount: 0,
  });
  return Object.freeze({ group, placements: placementResult.placements, stats: placementResult.stats });
}

function collectRenderableMeshes(model) {
  const meshes = [];
  model?.updateMatrixWorld?.(true);
  model?.traverse?.((node) => {
    if (node?.isMesh && node.geometry?.getAttribute?.('position') && node.material) meshes.push(node);
  });
  return meshes;
}

export function measureAmbientPropAsset(model) {
  model?.updateMatrixWorld?.(true);
  const bounds = new THREE.Box3().setFromObject(model);
  if (bounds.isEmpty()) return null;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const horizontal = Math.max(size.x, size.z);
  const minimum = SETTLEMENT_AMBIENT_PROP_POLICY.sourceExtentEpsilonMeters;
  const aspectRatio = Math.max(size.x, size.y, size.z) / Math.max(minimum, Math.min(size.x, size.y, size.z));
  return Object.freeze({ bounds, size, center, horizontal, aspectRatio });
}

export function validateAmbientPropAsset(model) {
  if (!model || model.userData?.isPlaceholder) return { valid: false, reason: 'placeholder' };
  const meshes = collectRenderableMeshes(model);
  if (!meshes.length) return { valid: false, reason: 'no-renderable-mesh' };
  if (meshes.length > SETTLEMENT_AMBIENT_PROP_POLICY.maximumHydratedPrimitiveCount) return { valid: false, reason: 'too-many-primitives' };
  const measurement = measureAmbientPropAsset(model);
  if (!measurement) return { valid: false, reason: 'empty-bounds' };
  const numbers = [measurement.size.x, measurement.size.y, measurement.size.z, measurement.horizontal, measurement.aspectRatio];
  if (!numbers.every(Number.isFinite) || measurement.horizontal <= SETTLEMENT_AMBIENT_PROP_POLICY.sourceExtentEpsilonMeters) return { valid: false, reason: 'invalid-bounds' };
  if (measurement.aspectRatio > SETTLEMENT_AMBIENT_PROP_POLICY.maximumSourceAspectRatio) return { valid: false, reason: 'implausible-aspect' };
  return { valid: true, meshes, measurement };
}

async function preflightAmbientAsset(url, signal) {
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store', signal });
    if (!response.ok) return { load: false, reason: `http-${response.status}` };
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength < SETTLEMENT_AMBIENT_PROP_POLICY.hostedPreflightMinBytes) return { load: false, reason: 'lfs-pointer', contentLength };
    if (Number.isFinite(contentLength) && contentLength > SETTLEMENT_AMBIENT_PROP_POLICY.maximumHydratedSourceBytes) return { load: false, reason: 'source-too-large', contentLength };
    return { load: true, contentLength: Number.isFinite(contentLength) ? contentLength : null };
  } catch (error) {
    return { load: false, reason: signal?.aborted ? 'aborted' : 'preflight-error', error };
  }
}

function meshWeatheringKind(familyId, mesh) {
  if (familyId === 'bench') return 'stone';
  const label = `${mesh?.name || ''} ${mesh?.material?.name || ''}`.toLowerCase();
  if (/metal|iron|steel|band|hoop/.test(label)) return 'metal';
  return 'wood';
}

function cloneModelMaterials(root, familyId, placement) {
  const clone = root.clone(true);
  clone.traverse((node) => {
    if (!node?.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const clonedMaterials = materials.map((sourceMaterial) => {
      const material = sourceMaterial?.clone?.() || new THREE.MeshStandardMaterial({ color: SETTLEMENT_AMBIENT_PROP_FAMILIES[familyId].fallbackColor });
      if ('color' in material && material.color?.isColor) {
        const tint = new THREE.Color(placement.tintHex);
        material.color.lerp(tint, familyId === 'bench' ? 0.16 : 0.11);
      }
      const kind = meshWeatheringKind(familyId, { name: node.name, material });
      if ('roughness' in material) material.roughness = Math.max(finite(material.roughness, 0.75), kind === 'stone' ? 0.82 : kind === 'metal' ? 0.54 : 0.72);
      if ('metalness' in material && kind !== 'metal') material.metalness = Math.min(finite(material.metalness), 0.08);
      applyAmbientPropWorldSpaceWeathering(material, { kind, snow: placement.snow, ash: placement.valyria });
      return material;
    });
    node.material = Array.isArray(node.material) ? clonedMaterials : clonedMaterials[0];
  });
  return clone;
}

function normalizeHydratedClone(source, measurement, familyId, placement) {
  const wrapper = new THREE.Group();
  wrapper.name = `settlement-ambient-hydrated-${placement.id}`;
  const clone = cloneModelMaterials(source, familyId, placement);
  const family = SETTLEMENT_AMBIENT_PROP_FAMILIES[familyId];
  const scale = family.targetHorizontalMeters * placement.scale / Math.max(measurement.horizontal, 1e-6);
  clone.position.set(-measurement.center.x, -measurement.bounds.min.y, -measurement.center.z);
  wrapper.add(clone);
  wrapper.scale.setScalar(scale);
  wrapper.position.set(placement.x, placement.y, placement.z);
  wrapper.rotation.y = placement.yawRadians;
  wrapper.userData.settlementAmbientHydrated = true;
  wrapper.userData.placementId = placement.id;
  wrapper.userData.familyId = familyId;
  wrapper.userData.assetUrl = family.assetUrl;
  wrapper.userData.authoredMapsPreserved = true;
  wrapper.userData.targetHorizontalMeters = placement.targetHorizontalMeters;
  return wrapper;
}

function hideFallbackPlacement(group, familyId, placementId) {
  const mesh = group.children.find((child) => child?.userData?.settlementAmbientFallback && child.userData.familyId === familyId);
  if (!mesh) return false;
  const index = mesh.userData.placementIds?.indexOf(placementId) ?? -1;
  if (index < 0) return false;
  mesh.getMatrixAt(index, tempMatrix);
  tempMatrix.decompose(tempObject.position, tempObject.quaternion, tempObject.scale);
  tempObject.scale.setScalar(0);
  tempMatrix.compose(tempObject.position, tempObject.quaternion, tempObject.scale);
  mesh.setMatrixAt(index, tempMatrix);
  mesh.instanceMatrix.needsUpdate = true;
  return true;
}

function placementPolicyForAmbientProp() {
  return {
    maxSlopeDegrees: SETTLEMENT_AMBIENT_PROP_POLICY.maximumSlopeDegrees,
    maxWaterDepth: 0.02,
    minRoadDistance: SETTLEMENT_AMBIENT_PROP_POLICY.minimumRoadDistanceMeters,
    minSettlementDistance: SETTLEMENT_AMBIENT_PROP_POLICY.innerRadiusMeters - 2,
    maxSettlementDistance: SETTLEMENT_AMBIENT_PROP_POLICY.outerRadiusMeters + 2,
  };
}

async function hydrateAmbientFamily(group, familyId, { signal, surfaceQuery }) {
  const family = SETTLEMENT_AMBIENT_PROP_FAMILIES[familyId];
  const placements = (group.userData.settlementAmbientPlacements || []).filter((placement) => placement.familyId === familyId);
  if (!placements.length) return Object.freeze({ familyId, status: 'unused', placementCount: 0 });
  const preflight = await preflightAmbientAsset(family.assetUrl, signal);
  if (!preflight.load) return Object.freeze({ familyId, status: 'procedural-fallback', reason: preflight.reason, placementCount: placements.length, hostedContentLength: preflight.contentLength ?? null });

  const source = await new AssetLoader().loadModel(family.assetUrl, { fallbackColor: family.fallbackColor, fallbackSize: family.targetHorizontalMeters });
  const validation = validateAmbientPropAsset(source);
  if (!validation.valid) {
    AssetLoader.disposeObject3D(source);
    return Object.freeze({ familyId, status: 'procedural-fallback', reason: validation.reason, placementCount: placements.length, hostedContentLength: preflight.contentLength ?? null });
  }

  group.userData.settlementAmbientSources.push(source);
  let hydratedPlacementCount = 0;
  const hydratedGroup = group.children.find((child) => child?.name === SETTLEMENT_AMBIENT_PROP_POLICY.hydratedGroupName);
  for (const placement of placements) {
    if (signal?.aborted) break;
    const wrapper = normalizeHydratedClone(source, validation.measurement, familyId, placement);
    const resolved = resolveWorldSurfacePlacement(wrapper, {
      surfaceQuery,
      placementPolicy: placementPolicyForAmbientProp(),
      requireSurfaceContext: true,
      snapToGround: true,
      footprintGrounding: 'never',
    });
    if (!resolved.ok) { disposeObjectMaterials(wrapper); continue; }
    wrapper.userData.worldPlacementSurface = resolved.surface;
    wrapper.userData.worldPlacementPolicy = resolved.policy;
    hydratedGroup.add(wrapper);
    hideFallbackPlacement(group, familyId, placement.id);
    hydratedPlacementCount += 1;
  }

  return Object.freeze({
    familyId,
    status: hydratedPlacementCount > 0 ? 'active' : 'procedural-fallback',
    assetUrl: family.assetUrl,
    placementCount: placements.length,
    hydratedPlacementCount,
    primitiveCount: validation.meshes.length,
    hostedContentLength: preflight.contentLength ?? null,
    sourceMeasurement: Object.freeze({
      x: validation.measurement.size.x,
      y: validation.measurement.size.y,
      z: validation.measurement.size.z,
      horizontal: validation.measurement.horizontal,
    }),
  });
}

function disposeObjectMaterials(root) {
  root?.traverse?.((node) => {
    if (!node?.isMesh) return;
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) material.dispose?.();
  });
}

export function upgradeSettlementAmbientPropAssets(group, {
  signal,
  isMobileClass = false,
  sampleHeightMeters,
  seaLevelMeters,
  seats,
  roadEdges,
} = {}) {
  if (!group) return Promise.resolve(Object.freeze({ status: 'missing-group' }));
  if (isMobileClass) return Promise.resolve(Object.freeze({ status: 'procedural-fallback', reason: 'mobile-budget', hydratedPlacementCount: 0 }));
  if (inFlightUpgrades.has(group)) return inFlightUpgrades.get(group);
  const surfaceQuery = createAmbientPropSurfaceQuery({ sampleHeightMeters, seaLevelMeters, seats, roadEdges });

  group.userData.settlementAmbient = Object.freeze({ ...group.userData.settlementAmbient, assetState: 'loading' });
  const hydratedGroup = new THREE.Group();
  hydratedGroup.name = SETTLEMENT_AMBIENT_PROP_POLICY.hydratedGroupName;
  group.add(hydratedGroup);

  const task = (async () => {
    const families = [];
    for (const familyId of FAMILY_IDS) {
      if (signal?.aborted) { families.push(Object.freeze({ familyId, status: 'aborted' })); continue; }
      try {
        families.push(await hydrateAmbientFamily(group, familyId, { signal, surfaceQuery }));
      } catch (error) {
        families.push(Object.freeze({ familyId, status: 'procedural-fallback', reason: 'hydrate-error', error: String(error?.message || error) }));
      }
    }
    const active = families.filter((entry) => entry.status === 'active');
    const hydratedPlacementCount = active.reduce((sum, entry) => sum + entry.hydratedPlacementCount, 0);
    const status = hydratedPlacementCount > 0 ? 'active' : 'procedural-fallback';
    group.userData.settlementAmbient = Object.freeze({
      ...group.userData.settlementAmbient,
      assetState: status,
      hydratedPlacementCount,
      hydratedFamilyCount: active.length,
      hydratedFamilies: Object.freeze(families),
    });
    return Object.freeze({ status, hydratedPlacementCount, activeFamilyCount: active.length, families: Object.freeze(families) });
  })().finally(() => inFlightUpgrades.delete(group));
  inFlightUpgrades.set(group, task);
  return task;
}

export function auditSettlementAmbientProps(group) {
  const metadata = group?.userData?.settlementAmbient;
  const placements = group?.userData?.settlementAmbientPlacements || [];
  const errors = [];
  if (!metadata) errors.push('missing-metadata');
  if (metadata?.policyId !== SETTLEMENT_AMBIENT_PROP_POLICY.id) errors.push('policy-id-drift');
  if (metadata?.placementChecksum !== checksumSettlementAmbientPlacements(placements)) errors.push('placement-checksum-drift');
  if (placements.some((placement) => ![placement.x, placement.y, placement.z, placement.slopeDegrees, placement.roadDistanceMeters].every(Number.isFinite))) errors.push('non-finite-placement');
  if (placements.some((placement) => placement.slopeDegrees > SETTLEMENT_AMBIENT_PROP_POLICY.maximumSlopeDegrees + 1e-6)) errors.push('slope-policy-breach');
  if (placements.some((placement) => placement.roadDistanceMeters < SETTLEMENT_AMBIENT_PROP_POLICY.minimumRoadDistanceMeters - 1e-6)) errors.push('road-clearance-breach');
  if (placements.some((placement) => placement.seatDistanceMeters < SETTLEMENT_AMBIENT_PROP_POLICY.innerRadiusMeters - 1e-6 || placement.seatDistanceMeters > SETTLEMENT_AMBIENT_PROP_POLICY.outerRadiusMeters + 1e-6)) errors.push('seat-apron-breach');
  const familyCounts = new Map();
  for (const placement of placements) familyCounts.set(placement.familyId, (familyCounts.get(placement.familyId) || 0) + 1);
  if (familyCounts.size < 2 && placements.length >= 4) errors.push('family-diversity-too-low');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), placementCount: placements.length, familyCounts: Object.freeze(Object.fromEntries(familyCounts)), metadata });
}

export function disposeSettlementAmbientProps(group) {
  if (!group) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const roots = [group, ...(group.userData?.settlementAmbientSources || [])];
  for (const root of roots) {
    root?.traverse?.((node) => {
      if (node?.geometry && !geometries.has(node.geometry)) { geometries.add(node.geometry); node.geometry.dispose?.(); }
      for (const material of Array.isArray(node?.material) ? node.material : node?.material ? [node.material] : []) {
        if (!material || materials.has(material)) continue;
        materials.add(material);
        for (const key of Object.keys(material)) {
          const value = material[key];
          if (value?.isTexture && !textures.has(value)) { textures.add(value); value.dispose?.(); }
        }
        material.dispose?.();
      }
    });
  }
  group.clear();
  group.userData.settlementAmbientSources = [];
}
