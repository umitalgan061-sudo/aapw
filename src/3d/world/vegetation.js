import * as THREE from 'three';
import { mulberry32 } from './terrain.js';
import { northClimateWeightsAtWorldZ } from './terrainBiomeShading.js';
import { northReferenceCryosphereAtWorldXZ } from './northReferenceCryosphere.js';
import { disposeWindGrassRun180 } from './windGrass.js';
import {
  TERRAIN_HABITAT_POLICY,
  sampleCanonicalTerrainHabitat,
  vegetationSuitabilityForHabitat,
} from './terrainHabitat.js';
import {
  VEGETATION_ECOLOGY_DISTRIBUTION_POLICY,
  evaluateVegetationEcologyCandidate,
  ecologicalInstanceVariation,
} from './vegetationEcologyDistribution.js';

const SPECIES = [
  {
    id: 'pine',
    family: 'conifer',
    weight: 0.6,
    trunk: { radiusTop: 0.22, radiusBottom: 0.38, height: 3.4, radialSegments: 6, color: 0x5b4028 },
    foliage: { kind: 'cone', radius: 2.15, height: 5.6, radialSegments: 7, overlapMeters: 0.3, color: 0x2f5c26 },
  },
  {
    id: 'round',
    family: 'deciduous',
    weight: 0.4,
    trunk: { radiusTop: 0.2, radiusBottom: 0.34, height: 2.8, radialSegments: 6, color: 0x5b4028 },
    foliage: { kind: 'sphere', radius: 2.4, widthSegments: 7, heightSegments: 6, overlapMeters: 0.7, color: 0x4a7a2e },
  },
  {
    id: 'snow-pine',
    family: 'conifer',
    weight: 0,
    trunk: { radiusTop: 0.20, radiusBottom: 0.36, height: 3.2, radialSegments: 6, color: 0x4f443b },
    foliage: { kind: 'cone', radius: 2.25, height: 5.9, radialSegments: 7, overlapMeters: 0.34, color: 0xcad9d6 },
  },
];

const TEMPERATE_SPECIES_COUNT = 2;
const SNOW_PINE_SPECIES_INDEX = 2;

export const VEGETATION_NORTH_CLIMATE_POLICY = Object.freeze({
  id: 'vegetation-map-aligned-north-climate-2026-08-22-v2',
  climateAuthority: 'northReferenceCryosphereAtWorldXZ',
  permanentIceSnowOnlyThreshold: 0.55,
  tundraClimateThreshold: 0.20,
  tundraBaseSnowChance: 0.22,
  tundraSnowGain: 0.55,
  iceSnowGain: 0.55,
  greenBroadleafAllowedInTundra: false,
  verifiedAssetCandidates: Object.freeze([
    'assets/models/vegetation/winter_tree.glb',
    'assets/models/vegetation/dead_trees_with_snow_iEuwXWner0.glb',
  ]),
  liveRepresentation: 'instanced-procedural-snow-pine',
});

export const VEGETATION_SPATIAL_PATTERN_POLICY = Object.freeze({
  id: 'vegetation-domain-warped-ecology-scatter-2026-09-03-v2',
  climateAuthority: VEGETATION_NORTH_CLIMATE_POLICY.climateAuthority,
  terrainHabitatPolicyId: TERRAIN_HABITAT_POLICY.id,
  ecologyDistributionPolicyId: VEGETATION_ECOLOGY_DISTRIBUTION_POLICY.id,
  canonicalTerrainMorphologyWeighted: true,
  statefulCircularGrovesRemoved: true,
  worldSpaceCohortRanking: true,
  candidatePoolSize: 6,
  settlementCandidatePoolSize: 5,
  minimumHabitatDensity: 0.10,
  habitatAcceptanceFloor: 0.24,
  habitatAcceptanceGain: 0.76,
  ecologyThreshold: 0.52,
  settlementEcologyThreshold: 0.58,
  exposedStatureReduction: 0.26,
  shelterStatureGain: 0.20,
  anisotropicCrownScale: true,
  deterministicCanopyTint: true,
  ecologicalInstanceVariation: true,
  terrainReadOnly: true,
});

const TARGET_DENSITY_PER_KM2 = 30;
const MAX_ATTEMPTS_PER_TREE = 10;
const SEAT_EXCLUSION_RADIUS_METERS = 90;
const ROAD_EXCLUSION_RADIUS_METERS = 10;
const SHORE_MARGIN_METERS = 1.5;
const MAX_GROUND_SLOPE_DEGREES = 45;
const SLOPE_SAMPLE_OFFSET_METERS = 3;
const SCALE_MIN = 0.72;
const SCALE_MAX = 1.38;
const CLUSTER_RING_INNER_MARGIN_METERS = 10;
const CLUSTER_RING_OUTER_RADIUS_METERS = 260;
const CLUSTER_DENSITY_PER_KM2 = 220;
const VEGETATION_SURFACE_FABRIC_KEY = 'vegetation-world-surface-fabric-v3-ecological-organic';

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function applyVegetationSurfaceFabric(material, { surface, snow = false }) {
  material.userData.vegetationSurfaceFabric = Object.freeze({
    key: VEGETATION_SURFACE_FABRIC_KEY,
    surface,
    worldSpace: true,
    multiScaleAlbedo: true,
    directionalOrganicFiber: true,
    microNormal: true,
    roughnessVariation: true,
    snowShelterVariation: snow,
  });

  const previousOnBeforeCompile = material.onBeforeCompile?.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile?.(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVegetationWorldPosition;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec4 vegetationWorldPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
vegetationWorldPosition = instanceMatrix * vegetationWorldPosition;
#endif
vVegetationWorldPosition = (modelMatrix * vegetationWorldPosition).xyz;`);

    const surfaceGain = surface === 'trunk' ? 0.21 : snow ? 0.145 : 0.18;
    const roughBase = surface === 'trunk' ? 0.92 : snow ? 0.81 : 0.85;
    const colorTreatment = snow
      ? `float vegetationShelter = smoothstep(0.40, 0.74, vegetationMeso * 0.54 + vegetationFine * 0.25 + vegetationVertical * 0.21);
float vegetationWindScour = smoothstep(0.58, 0.84, vegetationDirectional * 0.64 + vegetationFine * 0.36);
diffuseColor.rgb *= mix(vec3(0.76, 0.80, 0.80), vec3(1.055, 1.065, 1.045), vegetationShelter);
diffuseColor.rgb *= 1.0 - vegetationWindScour * 0.052;`
      : surface === 'trunk'
        ? `float vegetationBarkFissure = 1.0 - abs(vegetationDirectional * 2.0 - 1.0);
float vegetationBarkDark = smoothstep(0.67, 0.91, vegetationBarkFissure * 0.61 + vegetationFine * 0.39);
float vegetationBarkMoss = smoothstep(0.61, 0.86, vegetationMacro) * smoothstep(0.55, 0.82, 1.0 - vegetationDirectional);
diffuseColor.rgb *= 1.0 + (vegetationMacro - 0.5) * ${surfaceGain.toFixed(3)} + (vegetationMeso - 0.5) * 0.085 + (vegetationFine - 0.5) * 0.032;
diffuseColor.rgb *= 1.0 - vegetationBarkDark * 0.11;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.78, 0.91, 0.72), vegetationBarkMoss * 0.055);`
        : `float vegetationNeedleMass = smoothstep(0.33, 0.76, vegetationMeso * 0.53 + vegetationVertical * 0.26 + vegetationFine * 0.21);
float vegetationCanopyShadow = smoothstep(0.58, 0.86, 1.0 - vegetationDirectional) * vegetationNeedleMass;
float vegetationLeafMottle = vegetationNoise(vegetationWorldXZ / 4.7 + vec2(vegetationMacro * 2.1, -vegetationMeso * 1.7));
diffuseColor.rgb *= 1.0 + (vegetationMacro - 0.5) * ${surfaceGain.toFixed(3)} + (vegetationMeso - 0.5) * 0.105 + (vegetationFine - 0.5) * 0.046 + (vegetationLeafMottle - 0.5) * 0.035;
diffuseColor.rgb *= 1.0 - vegetationCanopyShadow * 0.078;`;

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vVegetationWorldPosition;
float vegetationHash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.11369));
  p += dot(p, p + 31.32);
  return fract((p.x + p.y) * p.x);
}
float vegetationNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = vegetationHash(i); float b = vegetationHash(i + vec2(1.0, 0.0));
  float c = vegetationHash(i + vec2(0.0, 1.0)); float d = vegetationHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec2 vegetationWorldXZ = vVegetationWorldPosition.xz;
float vegetationWarpX = vegetationNoise(vegetationWorldXZ / 91.0 + vec2(7.3, -11.2));
float vegetationWarpZ = vegetationNoise(vegetationWorldXZ / 113.0 + vec2(-13.7, 5.4));
vec2 vegetationWarp = vec2(vegetationWarpX - 0.5, vegetationWarpZ - 0.5) * 18.0;
float vegetationMacro = vegetationNoise((vegetationWorldXZ + vegetationWarp) / 61.0);
float vegetationMeso = vegetationNoise((vegetationWorldXZ - vegetationWarp * 0.37) / 13.5 + vec2(13.7, -8.3));
float vegetationFine = vegetationNoise(vegetationWorldXZ / 2.25 + vec2(-31.2, 17.9));
float vegetationVertical = vegetationNoise(vec2(vVegetationWorldPosition.y * 0.19 + vegetationWorldXZ.x * 0.018, vegetationWorldXZ.y * 0.043));
float vegetationDirectional = vegetationNoise(vec2(vVegetationWorldPosition.y * ${surface === 'trunk' ? '0.72' : '0.27'} + vegetationWorldXZ.x * 0.031, vegetationWorldXZ.y * ${surface === 'trunk' ? '0.14' : '0.08'}));
${colorTreatment}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
vec2 vegetationMicroP = vegetationWorldXZ * ${surface === 'trunk' ? '0.71' : '0.43'} + vec2(vVegetationWorldPosition.y * ${surface === 'trunk' ? '0.33' : '0.08'}, 0.0);
float vegetationNx = vegetationNoise(vegetationMicroP + vec2(0.13, 0.0)) - vegetationNoise(vegetationMicroP - vec2(0.13, 0.0));
float vegetationNz = vegetationNoise(vegetationMicroP + vec2(0.0, 0.13)) - vegetationNoise(vegetationMicroP - vec2(0.0, 0.13));
normal = normalize(normal + mat3(viewMatrix) * vec3(vegetationNx, 0.0, vegetationNz) * ${surface === 'trunk' ? '0.105' : '0.065'});`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float vegetationFiberRough = vegetationDirectional - 0.5;
roughnessFactor = clamp(${roughBase.toFixed(2)} + (vegetationMacro - 0.5) * 0.08 + (vegetationMeso - 0.5) * 0.15 + (vegetationFine - 0.5) * 0.08 + vegetationFiberRough * ${surface === 'trunk' ? '0.07' : '0.04'}, 0.60, 1.0);`);
  };
  material.customProgramCacheKey = () => `${VEGETATION_SURFACE_FABRIC_KEY}:${surface}:${snow ? 'snow' : 'temperate'}`;
}

export function distancePointToSegment2D(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const lengthSquared = abx * abx + abz * abz;
  if (lengthSquared === 0) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * abx + (pz - az) * abz) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

export function vegetationHabitatAtPosition(x, z, { sampleHeightMeters, seaLevelMeters } = {}) {
  const climate = northReferenceCryosphereAtWorldXZ(x, z);
  const terrain = sampleCanonicalTerrainHabitat(sampleHeightMeters, x, z, { seaLevelMeters });
  const ecology = vegetationSuitabilityForHabitat(terrain, climate);
  return Object.freeze({ terrain, climate, ecology });
}

export function isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats = [], roadEdges = [] }) {
  for (const seat of seats) if (Math.hypot(x - seat.x, z - seat.z) < SEAT_EXCLUSION_RADIUS_METERS) return false;
  for (const edge of roadEdges) {
    const points = edge.points ?? [];
    for (let i = 1; i < points.length; i++) {
      if (distancePointToSegment2D(x, z, points[i - 1].x, points[i - 1].z, points[i].x, points[i].z) < ROAD_EXCLUSION_RADIUS_METERS) return false;
    }
  }
  const groundY = sampleHeightMeters(x, z);
  if (!Number.isFinite(groundY) || groundY <= seaLevelMeters + SHORE_MARGIN_METERS) return false;
  const dxHeight = sampleHeightMeters(x + SLOPE_SAMPLE_OFFSET_METERS, z) - groundY;
  const dzHeight = sampleHeightMeters(x, z + SLOPE_SAMPLE_OFFSET_METERS) - groundY;
  const gradeXDegrees = Math.atan2(Math.abs(dxHeight), SLOPE_SAMPLE_OFFSET_METERS) * 180 / Math.PI;
  const gradeZDegrees = Math.atan2(Math.abs(dzHeight), SLOPE_SAMPLE_OFFSET_METERS) * 180 / Math.PI;
  return Math.max(gradeXDegrees, gradeZDegrees) <= MAX_GROUND_SLOPE_DEGREES;
}

export function pickSpeciesIndex(roll) {
  const totalWeight = SPECIES.slice(0, TEMPERATE_SPECIES_COUNT).reduce((sum, species) => sum + species.weight, 0);
  let cumulative = 0;
  for (let i = 0; i < TEMPERATE_SPECIES_COUNT; i++) {
    cumulative += SPECIES[i].weight / totalWeight;
    if (roll < cumulative) return i;
  }
  return TEMPERATE_SPECIES_COUNT - 1;
}

function pickSpeciesIndexForClimate(roll, climate) {
  const policy = VEGETATION_NORTH_CLIMATE_POLICY;
  if (climate.permanentIce >= policy.permanentIceSnowOnlyThreshold) return SNOW_PINE_SPECIES_INDEX;
  if (Math.max(climate.permanentIce, climate.tundra) >= policy.tundraClimateThreshold) {
    const snowChance = Math.min(1, policy.tundraBaseSnowChance + climate.tundra * policy.tundraSnowGain + climate.permanentIce * policy.iceSnowGain);
    return roll < snowChance ? SNOW_PINE_SPECIES_INDEX : 0;
  }
  return pickSpeciesIndex(roll);
}

function pickSpeciesIndexForHabitat(roll, climate, ecology) {
  const climateIndex = pickSpeciesIndexForClimate(roll, climate);
  if (climateIndex === SNOW_PINE_SPECIES_INDEX || Math.max(climate.permanentIce, climate.tundra) >= VEGETATION_NORTH_CLIMATE_POLICY.tundraClimateThreshold) return climateIndex;
  const pineWeight = Math.max(0.05, ecology.pine * 0.62 + 0.38 * SPECIES[0].weight);
  const broadleafWeight = Math.max(0.03, ecology.broadleaf * 0.72 + 0.28 * SPECIES[1].weight);
  return roll < pineWeight / (pineWeight + broadleafWeight) ? 0 : 1;
}

export function pickSpeciesIndexForWorldZ(roll, worldZ) {
  return pickSpeciesIndexForClimate(roll, northClimateWeightsAtWorldZ(worldZ));
}

export function pickSpeciesIndexForWorldXZ(roll, worldX, worldZ) {
  return pickSpeciesIndexForClimate(roll, northReferenceCryosphereAtWorldXZ(worldX, worldZ));
}

export function vegetationSpeciesId(index) {
  return SPECIES[index]?.id ?? null;
}

export function sampleAnnulusPoint(rng, centerX, centerZ, innerRadius, outerRadius) {
  const angle = rng() * Math.PI * 2;
  const radius = Math.sqrt(rng() * (outerRadius * outerRadius - innerRadius * innerRadius) + innerRadius * innerRadius);
  return { x: centerX + Math.cos(angle) * radius, z: centerZ + Math.sin(angle) * radius };
}

export function vegetationGrovePatternForClimate(climate = {}) {
  const tundra = Number.isFinite(climate.tundra) ? climate.tundra : 0;
  const permanentIce = Number.isFinite(climate.permanentIce) ? climate.permanentIce : 0;
  const coldness = clamp01(Math.max(tundra, permanentIce));
  return {
    coldness,
    groveRadiusMeters: 170 + (125 - 170) * coldness,
    backgroundChance: 0.26 + (0.18 - 0.26) * coldness,
  };
}

function buildSpeciesAssets(species) {
  const { trunk, foliage } = species;
  const trunkGeometry = new THREE.CylinderGeometry(trunk.radiusTop, trunk.radiusBottom, trunk.height, trunk.radialSegments);
  trunkGeometry.translate(0, trunk.height / 2, 0);
  let foliageGeometry;
  if (foliage.kind === 'cone') {
    foliageGeometry = new THREE.ConeGeometry(foliage.radius, foliage.height, foliage.radialSegments);
    foliageGeometry.translate(0, trunk.height + foliage.height / 2 - foliage.overlapMeters, 0);
  } else if (foliage.kind === 'sphere') {
    foliageGeometry = new THREE.SphereGeometry(foliage.radius, foliage.widthSegments, foliage.heightSegments);
    foliageGeometry.translate(0, trunk.height + foliage.radius - foliage.overlapMeters, 0);
  } else {
    throw new Error(`world/vegetation.js: unknown foliage kind "${foliage.kind}" for species "${species.id}"`);
  }
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: trunk.color, roughness: 0.92, metalness: 0 });
  const foliageMaterial = new THREE.MeshStandardMaterial({ color: foliage.color, roughness: species.id === 'snow-pine' ? 0.81 : 0.85, metalness: 0 });
  applyVegetationSurfaceFabric(trunkMaterial, { surface: 'trunk' });
  applyVegetationSurfaceFabric(foliageMaterial, { surface: 'foliage', snow: species.id === 'snow-pine' });
  return { trunkGeometry, foliageGeometry, trunkMaterial, foliageMaterial };
}

function ecologyInputForCandidate(x, z, habitat, seed) {
  const terrain = habitat.terrain;
  const climate = habitat.climate;
  return {
    x,
    z,
    seed,
    elevationMeters: terrain.y,
    slopeDegrees: terrain.slopeDegrees,
    aspectRadians: terrain.downhillAngleRadians,
    moisture: clamp01(terrain.moistureRetention * 0.58 + terrain.shelter * 0.18 + terrain.valley * 0.12 + habitat.ecology.density * 0.12),
    snow: clamp01(Math.max(climate.permanentIce, climate.tundra * 0.42)),
    biome: terrain.exposedBedrock > 0.62 ? 'ridge-rock'
      : terrain.gullyFloor > 0.56 ? 'riparian-wetland'
        : terrain.windExposure > 0.66 ? 'upland-heath'
          : terrain.shelter > 0.58 ? 'forest-lowland'
            : 'meadow-lowland',
    shelter: terrain.shelter,
    concavity: clamp01(terrain.valley * 0.58 + terrain.gullyFloor * 0.42),
    erosion: clamp01(terrain.exposedBedrock * 0.42 + terrain.rockfallSource * 0.31 + terrain.windExposure * 0.27),
    deposition: clamp01(terrain.depositional * 0.45 + terrain.fanApron * 0.24 + terrain.depositionalBench * 0.31),
    waterDepth: 0,
  };
}

function evaluateTreeCandidate(x, z, options, seed, threshold) {
  if (!isPlaceablePosition(x, z, options)) return null;
  const habitat = vegetationHabitatAtPosition(x, z, options);
  if (habitat.ecology.density < VEGETATION_SPATIAL_PATTERN_POLICY.minimumHabitatDensity) return null;
  const ecologyInput = ecologyInputForCandidate(x, z, habitat, seed);
  const distribution = evaluateVegetationEcologyCandidate(ecologyInput, { family: 'mixed', seed, threshold });
  const habitatCapacity = clamp01(
    VEGETATION_SPATIAL_PATTERN_POLICY.habitatAcceptanceFloor
      + habitat.ecology.density * VEGETATION_SPATIAL_PATTERN_POLICY.habitatAcceptanceGain,
  );
  const score = distribution.capacity * 0.56 + habitatCapacity * 0.28 + (1 - distribution.rank) * 0.16;
  return Object.freeze({ x, z, habitat, ecologyInput, distribution, score });
}

function bestCandidateFromPool(rng, sampler, options, seedBase, poolSize, threshold) {
  let best = null;
  for (let index = 0; index < poolSize; index++) {
    const candidate = sampler();
    if (!candidate) continue;
    const evaluated = evaluateTreeCandidate(candidate.x, candidate.z, options, seedBase + index * 1013, threshold);
    if (!evaluated) continue;
    if (!best || evaluated.score > best.score) best = evaluated;
  }
  return best;
}

function placeTreeInstance(entry, candidate, sampleHeightMeters, rng, up, matrix, position, quaternion, scaleVector, instanceColor, seed) {
  const { x, z, habitat, ecologyInput } = candidate;
  const groundY = sampleHeightMeters(x, z);
  const variation = ecologicalInstanceVariation(ecologyInput, { family: entry.species.family, seed });
  const ecology = habitat.ecology;
  const baseScale = SCALE_MIN + rng() * (SCALE_MAX - SCALE_MIN);
  const stature = 0.76 + ecology.stature * 0.34;
  const windPrune = habitat.terrain.exposure * VEGETATION_SPATIAL_PATTERN_POLICY.exposedStatureReduction;
  const shelterGain = habitat.terrain.shelter * VEGETATION_SPATIAL_PATTERN_POLICY.shelterStatureGain;
  const scale = baseScale * stature * (1 - windPrune + shelterGain) * variation.scale;
  const yaw = variation.yaw;
  const crownCompression = clamp01(variation.crownCompression);
  const crownAcross = 0.91 + rng() * 0.15 - habitat.terrain.exposure * 0.06 - crownCompression * 0.07;
  const crownDepth = 0.91 + rng() * 0.15 - habitat.terrain.exposure * 0.035 + crownCompression * 0.035;
  const vertical = 0.94 + rng() * 0.12 + habitat.terrain.shelter * 0.045 - crownCompression * 0.04;
  position.set(x, groundY, z);
  quaternion.setFromAxisAngle(up, yaw);
  scaleVector.set(scale * crownAcross, scale * vertical, scale * crownDepth);
  matrix.compose(position, quaternion, scaleVector);
  entry.trunkMesh.setMatrixAt(entry.placedCount, matrix);
  entry.foliageMesh.setMatrixAt(entry.placedCount, matrix);

  const baseLight = (0.91 + rng() * 0.12) * variation.valueScale;
  const moisture = habitat.terrain.depositional * 0.06 - habitat.terrain.exposure * 0.05 - variation.moistureDarken * 0.42;
  const frost = variation.frostDesaturate;
  if (entry.species.id === 'snow-pine') {
    instanceColor.setRGB(
      Math.min(1, baseLight * (0.93 - moisture * 0.14)),
      Math.min(1, baseLight * (0.985 + moisture * 0.16)),
      Math.min(1, baseLight * (1.005 + frost * 0.08)),
    );
  } else if (entry.species.id === 'pine') {
    instanceColor.setRGB(
      Math.max(0.70, baseLight * (0.89 - moisture * 0.26 + variation.exposureBleach * 0.16)),
      Math.min(1.07, baseLight * (0.95 + moisture * 0.78 - frost * 0.09)),
      Math.max(0.70, baseLight * (0.87 + moisture * 0.36 + frost * 0.04)),
    );
  } else {
    instanceColor.setRGB(
      Math.max(0.73, baseLight * (0.94 + moisture * 0.24 + variation.exposureBleach * 0.12)),
      Math.min(1.07, baseLight * (0.985 + moisture * 0.74 - frost * 0.08)),
      Math.max(0.70, baseLight * (0.85 + moisture * 0.31 + frost * 0.04)),
    );
  }
  entry.foliageMesh.setColorAt?.(entry.placedCount, instanceColor);
  entry.placedCount++;
  return variation;
}

export function createVegetation({ sampleHeightMeters, seaLevelMeters, seed, seats = [], roadEdges = [], radiusMeters, densityPerKm2 = TARGET_DENSITY_PER_KM2 }) {
  const group = new THREE.Group();
  const areaKm2 = Math.PI * radiusMeters * radiusMeters / 1_000_000;
  const baseTargetCount = Math.max(0, Math.round(areaKm2 * densityPerKm2));
  const clusterInnerRadius = SEAT_EXCLUSION_RADIUS_METERS + CLUSTER_RING_INNER_MARGIN_METERS;
  const clusterSeats = seats.filter((seat) => Math.hypot(seat.x, seat.z) + CLUSTER_RING_OUTER_RADIUS_METERS <= radiusMeters);
  const ringAreaKm2 = Math.PI * (CLUSTER_RING_OUTER_RADIUS_METERS ** 2 - clusterInnerRadius ** 2) / 1_000_000;
  const clusterTargetPerSeat = Math.max(0, Math.round(ringAreaKm2 * CLUSTER_DENSITY_PER_KM2));
  const clusterTargetTotal = clusterSeats.length * clusterTargetPerSeat;
  const targetCount = baseTargetCount + clusterTargetTotal;
  if (targetCount === 0) return { group, targetCount: 0, placedCount: 0, clusterSeatCount: 0, winterTreeCount: 0 };

  const rng = mulberry32(seed ^ 0x56454745);
  const clusterRng = mulberry32(seed ^ 0x434c5354);
  const up = new THREE.Vector3(0, 1, 0);
  const perSpecies = SPECIES.map((species) => {
    const assets = buildSpeciesAssets(species);
    const trunkMesh = new THREE.InstancedMesh(assets.trunkGeometry, assets.trunkMaterial, targetCount);
    const foliageMesh = new THREE.InstancedMesh(assets.foliageGeometry, assets.foliageMaterial, targetCount);
    trunkMesh.name = `vegetation-${species.id}-trunks`;
    foliageMesh.name = `vegetation-${species.id}-foliage`;
    trunkMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    foliageMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    return { species, trunkMesh, foliageMesh, placedCount: 0 };
  });

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scaleVector = new THREE.Vector3();
  const instanceColor = new THREE.Color();
  const placementOptions = { sampleHeightMeters, seaLevelMeters, seats, roadEdges };
  let placedCount = 0;
  let habitatRejectedCount = 0;
  let habitatAcceptedCount = 0;
  let ecologyAcceptedCount = 0;
  let ecologyFallbackCount = 0;
  let ridgeTreeCount = 0;
  let shelteredTreeCount = 0;
  let depositionalTreeCount = 0;
  let edgeCohortCount = 0;
  let windPrunedCohortCount = 0;
  let matureCohortCount = 0;

  const recordCandidate = (candidate, random, indexSeed) => {
    if (!candidate) { habitatRejectedCount++; return false; }
    habitatAcceptedCount++;
    if (candidate.distribution.accepted) ecologyAcceptedCount++;
    else ecologyFallbackCount++;
    const speciesIndex = pickSpeciesIndexForHabitat(random(), candidate.habitat.climate, candidate.habitat.ecology);
    const entry = perSpecies[speciesIndex];
    const variation = placeTreeInstance(entry, candidate, sampleHeightMeters, random, up, matrix, position, quaternion, scaleVector, instanceColor, indexSeed);
    if (candidate.habitat.terrain.ridge > 0.45) ridgeTreeCount++;
    if (candidate.habitat.terrain.shelter > 0.55) shelteredTreeCount++;
    if (candidate.habitat.terrain.depositional > 0.55) depositionalTreeCount++;
    if (variation.cohortClass === 'edge') edgeCohortCount++;
    if (variation.cohortClass === 'wind-pruned') windPrunedCohortCount++;
    if (variation.cohortClass === 'mature') matureCohortCount++;
    placedCount++;
    return true;
  };

  for (let treeIndex = 0; treeIndex < baseTargetCount; treeIndex++) {
    let placed = false;
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_TREE && !placed; attempt++) {
      const seedBase = (seed ^ 0x45434f4c) + treeIndex * 4099 + attempt * 131;
      const candidate = bestCandidateFromPool(
        rng,
        () => sampleAnnulusPoint(rng, 0, 0, 0, radiusMeters),
        placementOptions,
        seedBase,
        VEGETATION_SPATIAL_PATTERN_POLICY.candidatePoolSize,
        VEGETATION_SPATIAL_PATTERN_POLICY.ecologyThreshold,
      );
      if (!candidate) { habitatRejectedCount++; continue; }
      placed = recordCandidate(candidate, rng, seedBase + 17011);
    }
  }

  for (const seat of clusterSeats) {
    for (let treeIndex = 0; treeIndex < clusterTargetPerSeat; treeIndex++) {
      let placed = false;
      for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_TREE && !placed; attempt++) {
        const seedBase = (seed ^ 0x53454154) + treeIndex * 3571 + attempt * 181 + Math.round(seat.x * 7 + seat.z * 11);
        const candidate = bestCandidateFromPool(
          clusterRng,
          () => sampleAnnulusPoint(clusterRng, seat.x, seat.z, clusterInnerRadius, CLUSTER_RING_OUTER_RADIUS_METERS),
          placementOptions,
          seedBase,
          VEGETATION_SPATIAL_PATTERN_POLICY.settlementCandidatePoolSize,
          VEGETATION_SPATIAL_PATTERN_POLICY.settlementEcologyThreshold,
        );
        if (!candidate) { habitatRejectedCount++; continue; }
        placed = recordCandidate(candidate, clusterRng, seedBase + 19001);
      }
    }
  }

  for (const entry of perSpecies) {
    entry.trunkMesh.count = entry.placedCount;
    entry.foliageMesh.count = entry.placedCount;
    entry.trunkMesh.instanceMatrix.needsUpdate = true;
    entry.foliageMesh.instanceMatrix.needsUpdate = true;
    if (entry.foliageMesh.instanceColor) entry.foliageMesh.instanceColor.needsUpdate = true;
    group.add(entry.trunkMesh, entry.foliageMesh);
  }

  const winterTreeCount = perSpecies[SNOW_PINE_SPECIES_INDEX].placedCount;
  group.userData.northClimateVegetation = Object.freeze({
    policyId: VEGETATION_NORTH_CLIMATE_POLICY.id,
    climateAuthority: VEGETATION_NORTH_CLIMATE_POLICY.climateAuthority,
    mapAligned: true,
    winterTreeCount,
    temperateTreeCount: placedCount - winterTreeCount,
    liveRepresentation: VEGETATION_NORTH_CLIMATE_POLICY.liveRepresentation,
  });
  group.userData.vegetationSpatialPattern = Object.freeze({
    policyId: VEGETATION_SPATIAL_PATTERN_POLICY.id,
    ecologyDistributionPolicyId: VEGETATION_ECOLOGY_DISTRIBUTION_POLICY.id,
    deterministic: true,
    statefulCircularGrovesRemoved: true,
    worldSpaceCohortRanking: true,
    climateAuthority: VEGETATION_SPATIAL_PATTERN_POLICY.climateAuthority,
    terrainHabitatPolicyId: TERRAIN_HABITAT_POLICY.id,
    canonicalTerrainMorphologyWeighted: true,
    baseDensityPerKm2: densityPerKm2,
    candidatePoolSize: VEGETATION_SPATIAL_PATTERN_POLICY.candidatePoolSize,
    habitatAcceptedCount,
    habitatRejectedCount,
    ecologyAcceptedCount,
    ecologyFallbackCount,
    ridgeTreeCount,
    shelteredTreeCount,
    depositionalTreeCount,
    edgeCohortCount,
    windPrunedCohortCount,
    matureCohortCount,
  });
  group.userData.vegetationSurfaceFabric = Object.freeze({
    key: VEGETATION_SURFACE_FABRIC_KEY,
    worldSpace: true,
    multiScale: true,
    directionalOrganicFiber: true,
    domainWarped: true,
  });
  return { group, targetCount, placedCount, clusterSeatCount: clusterSeats.length, winterTreeCount };
}

export function disposeVegetation(group) {
  for (const mesh of group.children) {
    mesh.geometry?.dispose?.();
    mesh.material?.dispose?.();
  }
}

const MOBILE_VEGETATION_LOD_RUN136 = Object.freeze({
  trunkRadialSegments: 4,
  coneRadialSegments: 5,
  sphereWidthSegments: 5,
  sphereHeightSegments: 4,
});

function geometryTriangleCountRun136(geometry) {
  if (geometry.index) return geometry.index.count / 3;
  const positions = geometry.getAttribute('position');
  return positions ? positions.count / 3 : 0;
}

function buildMobileVegetationGeometryRun136(species) {
  const { trunk, foliage } = species;
  const trunkGeometry = new THREE.CylinderGeometry(trunk.radiusTop, trunk.radiusBottom, trunk.height, MOBILE_VEGETATION_LOD_RUN136.trunkRadialSegments);
  trunkGeometry.translate(0, trunk.height / 2, 0);
  let foliageGeometry;
  if (foliage.kind === 'cone') {
    foliageGeometry = new THREE.ConeGeometry(foliage.radius, foliage.height, MOBILE_VEGETATION_LOD_RUN136.coneRadialSegments);
    foliageGeometry.translate(0, trunk.height + foliage.height / 2 - foliage.overlapMeters, 0);
  } else if (foliage.kind === 'sphere') {
    foliageGeometry = new THREE.SphereGeometry(foliage.radius, MOBILE_VEGETATION_LOD_RUN136.sphereWidthSegments, MOBILE_VEGETATION_LOD_RUN136.sphereHeightSegments);
    foliageGeometry.translate(0, trunk.height + foliage.radius - foliage.overlapMeters, 0);
  } else {
    throw new Error(`world/vegetation.js: unknown mobile LOD foliage kind "${foliage.kind}" for species "${species.id}"`);
  }
  return { trunkGeometry, foliageGeometry };
}

const _createVegetationBeforeMobileLodRun136 = createVegetation;
createVegetation = function createVegetationWithMobileLodRun136(options) {
  const result = _createVegetationBeforeMobileLodRun136(options);
  const isMobileCoarsePointer = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  if (!isMobileCoarsePointer || result.group.children.length === 0) return result;

  let desktopTriangles = 0;
  let mobileTriangles = 0;
  for (let speciesIndex = 0; speciesIndex < SPECIES.length; speciesIndex++) {
    const trunkMesh = result.group.children[speciesIndex * 2];
    const foliageMesh = result.group.children[speciesIndex * 2 + 1];
    desktopTriangles += geometryTriangleCountRun136(trunkMesh.geometry) * trunkMesh.count;
    desktopTriangles += geometryTriangleCountRun136(foliageMesh.geometry) * foliageMesh.count;
    const oldTrunkGeometry = trunkMesh.geometry;
    const oldFoliageGeometry = foliageMesh.geometry;
    const mobileGeometry = buildMobileVegetationGeometryRun136(SPECIES[speciesIndex]);
    trunkMesh.geometry = mobileGeometry.trunkGeometry;
    foliageMesh.geometry = mobileGeometry.foliageGeometry;
    oldTrunkGeometry.dispose();
    oldFoliageGeometry.dispose();
    mobileTriangles += geometryTriangleCountRun136(trunkMesh.geometry) * trunkMesh.count;
    mobileTriangles += geometryTriangleCountRun136(foliageMesh.geometry) * foliageMesh.count;
  }

  result.group.userData.mobileVegetationLodRun136 = Object.freeze({
    active: true,
    desktopTriangles,
    mobileTriangles,
    reductionRatio: desktopTriangles > 0 ? 1 - mobileTriangles / desktopTriangles : 0,
    placedCount: result.placedCount,
  });
  return result;
};

export function getMobileVegetationLodStatsRun136(group) {
  return group?.userData?.mobileVegetationLodRun136 ?? null;
}

const _disposeVegetationBeforeWindGrassRun180 = disposeVegetation;
disposeVegetation = function disposeVegetationWithWindGrassRun180(group) {
  const grass = group?.userData?.run180GrassGroup;
  if (grass) {
    grass.parent?.remove(grass);
    disposeWindGrassRun180(grass);
    delete group.userData.run180GrassGroup;
  }
  return _disposeVegetationBeforeWindGrassRun180(group);
};
