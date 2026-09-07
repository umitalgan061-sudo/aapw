/**
 * Render-side snow surface contract for the canonical northern terrain.
 * This module is pure: it does not alter height, hydrology, colliders or placement authority.
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const finiteOr = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / Math.max(edge1 - edge0, 1e-6));
  return t * t * (3 - 2 * t);
};

export const TERRAIN_SNOW_SURFACE_CONTRACT = Object.freeze({
  version: 1,
  authority: 'canonical-terrain-owner-map',
  mutatesCanonicalHeight: false,
  mutatesHydrology: false,
  mutatesCollider: false,
  materialChannels: Object.freeze(['albedo', 'roughness', 'normalGain', 'wetness']),
  seamPolicy: 'world-space-deterministic',
});

export function sampleFoldAwareSnowSurface(input = {}) {
  const slope = clamp01(finiteOr(input.slopeDegrees) / 70);
  const northness = clamp01((finiteOr(input.aspectNorthness) + 1) * 0.5);
  const fold = clamp01(finiteOr(input.foldExposure));
  const shelter = clamp01(finiteOr(input.shelterPocket));
  const climate = clamp01(finiteOr(input.climateSnowiness, 0.5));
  const perturbation = finiteOr(input.perturbation);
  const elevation = clamp01((finiteOr(input.elevationMeters) - 180) / 1300);
  const rock = clamp01(finiteOr(input.rockExposure));
  const distance = Math.max(0, finiteOr(input.cameraDistanceMeters, 0));

  const snowline = smoothstep(0.35, 0.7, elevation) * climate;
  const leePack = shelter * (0.35 + northness * 0.4) * (0.55 + fold * 0.45);
  const windScour = slope * (0.25 + (1 - northness) * 0.5) * (0.35 + fold * 0.65);
  const crust = clamp01(0.35 + windScour * 0.55 + Math.abs(perturbation) * 0.08);
  const exposure = clamp01(snowline + leePack - windScour - rock * 0.4);
  const drift = clamp01(exposure * (0.65 + shelter * 0.35));
  const fade = 1 - smoothstep(900, 5200, distance);

  return Object.freeze({
    exposure,
    drift,
    windScour,
    crust,
    snowline,
    shelterPocket: shelter,
    ridgeExposure: fold,
    nearFade: fade,
    wetEdge: clamp01((1 - elevation) * (1 - rock) * 0.5),
  });
}

export function resolveSnowSurfaceMaterial(input = {}) {
  const sample = sampleFoldAwareSnowSurface(input);
  const base = clamp01(finiteOr(input.baseSnow, 0.6));
  const snow = clamp01(base * (0.6 + sample.exposure * 0.55));
  return Object.freeze({
    albedoGain: 0.78 + snow * 0.12,
    roughness: 0.68 + sample.crust * 0.2 - sample.wetEdge * 0.12,
    normalGain: 0.25 + (0.2 + sample.windScour * 0.35) * sample.nearFade,
    wetness: sample.wetEdge * 0.35,
    sample,
  });
}

export function createSnowSurfaceManifest(input = {}) {
  const material = resolveSnowSurfaceMaterial(input);
  return Object.freeze({
    contract: TERRAIN_SNOW_SURFACE_CONTRACT.version,
    authority: TERRAIN_SNOW_SURFACE_CONTRACT.authority,
    canonicalMutation: false,
    inputs: Object.freeze({
      slopeDegrees: finiteOr(input.slopeDegrees),
      aspectNorthness: finiteOr(input.aspectNorthness),
      elevationMeters: finiteOr(input.elevationMeters),
      cameraDistanceMeters: Math.max(0, finiteOr(input.cameraDistanceMeters)),
    }),
    material,
  });
}
