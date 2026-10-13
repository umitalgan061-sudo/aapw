export type StructuralKind = 'rectangular-water' | 'grid-seam' | 'shoreline-step' | 'water-moire' | 'black-sky';

export interface StructuralObservation {
  readonly worldX: number;
  readonly worldZ: number;
  readonly shorelineGradient: number;
  readonly waterNormalRepeat: number;
  readonly skyLuminance: number;
  readonly visibleGridSeam: boolean;
  readonly visibleRectangularWater: boolean;
}

export interface StructuralSuppressionPlan {
  readonly deterministicKey: string;
  readonly suppressWaterOverlay: boolean;
  readonly blendShorelineMeters: number;
  readonly rotateWaterNormals: boolean;
  readonly clampSkyLuminance: number;
  readonly failures: readonly StructuralKind[];
  readonly acceptanceReady: boolean;
}

const finite = (value: number, fallback: number): number => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, finite(value, min)));

export function buildStructuralSuppressionPlan(seed: number, observation: StructuralObservation): StructuralSuppressionPlan {
  const failures: StructuralKind[] = [];
  if (observation.visibleRectangularWater) failures.push('rectangular-water');
  if (observation.visibleGridSeam) failures.push('grid-seam');
  if (finite(observation.shorelineGradient, 0) < 0.18) failures.push('shoreline-step');
  if (finite(observation.waterNormalRepeat, 1) > 0.72) failures.push('water-moire');
  if (finite(observation.skyLuminance, 0) < 0.2) failures.push('black-sky');
  const shoreline = clamp(10 + (0.18 - finite(observation.shorelineGradient, 0)) * 80, 10, 28);
  return Object.freeze({
    deterministicKey: `buzul|structural-suppression-v1|${Math.trunc(seed)}|${Math.round(finite(observation.worldX, 0) * 4) / 4}|${Math.round(finite(observation.worldZ, 0) * 4) / 4}`,
    suppressWaterOverlay: failures.includes('rectangular-water') || failures.includes('grid-seam'),
    blendShorelineMeters: shoreline,
    rotateWaterNormals: failures.includes('water-moire'),
    clampSkyLuminance: Math.max(0.2, finite(observation.skyLuminance, 0)),
    failures: Object.freeze([...failures]),
    acceptanceReady: failures.length === 0,
  });
}
