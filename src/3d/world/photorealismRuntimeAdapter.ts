/**
 * Buzul Muhafızı — canonical observation -> photorealism runtime packet.
 *
 * Read-only adapter: canonical terrain/water/collider and shared material/placement
 * authorities remain the source of truth. No geometry, asset hydration or DOM access.
 */
import {
  buildPhotorealismFrame,
  frameToMaterialRecipe,
  placementQueryFromFrame,
  type EnvironmentBiome,
  type EnvironmentSample,
  type PhotorealismFrame,
} from './photorealismDirector.ts';

export type CanonicalWorldObservation = Readonly<{
  seed: number;
  worldX: number;
  worldZ: number;
  heightMeters: number;
  waterLevelMeters: number;
  slopeDegrees: number;
  curvature: number;
  moisture: number;
  temperature: number;
  rockWeight: number;
  snowWeight: number;
  waterDistanceMeters: number;
  roadDistanceMeters: number;
  settlementDistanceMeters: number;
  forestDensity: number;
  windward: number;
  lee: number;
  biomeHint?: EnvironmentBiome;
}>;

export type PhotorealismRuntimePacket = Readonly<{
  schemaVersion: 1;
  sample: EnvironmentSample;
  frame: PhotorealismFrame;
  materialRecipe: ReturnType<typeof frameToMaterialRecipe>;
  placementQuery: ReturnType<typeof placementQueryFromFrame>;
  performance: PhotorealismFrame['performance'];
  provenance: Readonly<{
    sourceAuthority: 'canonical-world-terrain';
    materialAuthority: 'MaterialAssignmentCore.js';
    placementAuthority: 'WorldAssetPlacementPipeline.js';
    runtimeAdapter: 'photorealismRuntimeAdapter-v1';
  }>;
}>;

const clamp = (value: number, min: number, max: number, fallback = min): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const finite = (value: number, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function normalizeCanonicalWorldObservation(input: Partial<CanonicalWorldObservation>): CanonicalWorldObservation {
  return Object.freeze({
    seed: Math.trunc(finite(input.seed ?? 0)),
    worldX: finite(input.worldX ?? 0),
    worldZ: finite(input.worldZ ?? 0),
    heightMeters: finite(input.heightMeters ?? 0),
    waterLevelMeters: finite(input.waterLevelMeters ?? 0),
    slopeDegrees: clamp(input.slopeDegrees ?? 0, 0, 89),
    curvature: clamp(input.curvature ?? 0, -1, 1),
    moisture: clamp(input.moisture ?? 0, 0, 1),
    temperature: finite(input.temperature ?? 0),
    rockWeight: clamp(input.rockWeight ?? 0, 0, 1),
    snowWeight: clamp(input.snowWeight ?? 0, 0, 1),
    waterDistanceMeters: Math.max(0, finite(input.waterDistanceMeters ?? 9999, 9999)),
    roadDistanceMeters: Math.max(0, finite(input.roadDistanceMeters ?? 9999, 9999)),
    settlementDistanceMeters: Math.max(0, finite(input.settlementDistanceMeters ?? 9999, 9999)),
    forestDensity: clamp(input.forestDensity ?? 0, 0, 1),
    windward: clamp(input.windward ?? 0, 0, 1),
    lee: clamp(input.lee ?? 0, 0, 1),
    ...(input.biomeHint ? { biomeHint: input.biomeHint } : {}),
  });
}

function toEnvironmentSample(sample: CanonicalWorldObservation): EnvironmentSample {
  return {
    worldX: sample.worldX,
    worldZ: sample.worldZ,
    heightMeters: sample.heightMeters,
    waterLevelMeters: sample.waterLevelMeters,
    slopeDegrees: sample.slopeDegrees,
    curvature: sample.curvature,
    moisture: sample.moisture,
    temperature: sample.temperature,
    rockWeight: sample.rockWeight,
    snowWeight: sample.snowWeight,
    waterDistanceMeters: sample.waterDistanceMeters,
    roadDistanceMeters: sample.roadDistanceMeters,
    settlementDistanceMeters: sample.settlementDistanceMeters,
    forestDensity: sample.forestDensity,
    windward: sample.windward,
    lee: sample.lee,
    ...(sample.biomeHint ? { biomeHint: sample.biomeHint } : {}),
  };
}

export function buildPhotorealismRuntimePacket(input: Partial<CanonicalWorldObservation>): PhotorealismRuntimePacket {
  const sample = normalizeCanonicalWorldObservation(input);
  const environmentSample = toEnvironmentSample(sample);
  const frame = buildPhotorealismFrame(sample.seed, environmentSample);
  const materialRecipe = frameToMaterialRecipe(frame);
  const placementQuery = placementQueryFromFrame(frame);
  return Object.freeze({
    schemaVersion: 1,
    sample: environmentSample,
    frame,
    materialRecipe,
    placementQuery,
    performance: frame.performance,
    provenance: Object.freeze({
      sourceAuthority: 'canonical-world-terrain',
      materialAuthority: 'MaterialAssignmentCore.js',
      placementAuthority: 'WorldAssetPlacementPipeline.js',
      runtimeAdapter: 'photorealismRuntimeAdapter-v1',
    }),
  });
}

export function isGroundedEnvironmentEligible(packet: PhotorealismRuntimePacket): boolean {
  return packet.provenance.sourceAuthority === 'canonical-world-terrain'
    && packet.provenance.materialAuthority === 'MaterialAssignmentCore.js'
    && packet.provenance.placementAuthority === 'WorldAssetPlacementPipeline.js'
    && packet.placementQuery.allowGrass
    && packet.frame.water.depthClass !== 'deep';
}

export function photorealismAcceptanceFlags(packet: PhotorealismRuntimePacket): Readonly<Record<'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5', boolean>> {
  return Object.freeze({
    P0: packet.frame.antiTiling.macroMeters >= 120 && packet.frame.water.depthClass !== 'deep',
    P1: packet.frame.pbr.normalStrength >= 0.25,
    P2: packet.materialRecipe.surfaces.length >= 2,
    P3: packet.placementQuery.provenance.placementAuthority === 'WorldAssetPlacementPipeline.js',
    P4: packet.frame.water.shorelineFade >= 0,
    P5: packet.frame.atmosphere.skyLuminance >= 0.42,
  });
}
