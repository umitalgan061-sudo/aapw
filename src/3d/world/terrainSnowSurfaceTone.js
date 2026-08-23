/**
 * Render-only snow surface tone classifier.
 *
 * Snow amount remains owned by terrainBiomeShading/terrainWindSnowExposure. This module only turns
 * the already-authoritative redistribution telemetry into bounded visual tone weights so windward
 * packed snow can read colder/harder while sheltered bowls and lee faces read softer/deeper.
 * It never changes terrain height, collider height or snow coverage.
 * @module world/terrainSnowSurfaceTone
 */

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

export const TERRAIN_SNOW_SURFACE_TONE_POLICY = Object.freeze({
  id: 'terrain-snow-surface-tone-2026-08-23-v1',
  renderOnly: true,
  heightAuthorityUnchanged: true,
  snowCoverageAuthorityUnchanged: true,
  packedWindwardGain: 0.72,
  packedRidgeGain: 0.34,
  packedPermanentIceFloor: 0.10,
  accumulatedLeeGain: 0.72,
  accumulatedConcavityGain: 0.42,
  accumulatedGentleSlopeGain: 0.12,
  tundraToneScale: 0.78,
  minimumVisibleSnow: 0.08,
  maximumPackedWeight: 0.72,
  maximumAccumulatedWeight: 0.78,
  packedCoolShift: 0.18,
  packedBrightnessShift: -0.035,
  accumulatedWarmShift: 0.055,
  accumulatedBrightnessShift: 0.045,
});

/**
 * Resolve visual-only snow tone weights from authoritative snow coverage telemetry.
 * Packed and accumulated weights intentionally compete so a vertex cannot simultaneously read as
 * a scoured hard ridge and a deep sheltered drift.
 */
export function resolveTerrainSnowSurfaceTone({
  snowAmount = 0,
  permanentIce = 0,
  tundra = 0,
  windwardScour = 0,
  leeDeposit = 0,
  ridgeExposure = 0,
  concavityHold = 0,
  gentleSlope = 0,
} = {}) {
  const P = TERRAIN_SNOW_SURFACE_TONE_POLICY;
  const visibleSnow = clamp01((clamp01(snowAmount) - P.minimumVisibleSnow) / (1 - P.minimumVisibleSnow));
  const climate = clamp01(Math.max(clamp01(permanentIce), clamp01(tundra) * P.tundraToneScale));

  if (visibleSnow <= 0 || climate <= 0) {
    return Object.freeze({
      visibleSnow,
      climate,
      packedWeight: 0,
      accumulatedWeight: 0,
      neutralWeight: visibleSnow,
      coolShift: 0,
      brightnessShift: 0,
    });
  }

  const packedSignal = clamp01(
    clamp01(windwardScour) * P.packedWindwardGain
      + clamp01(ridgeExposure) * P.packedRidgeGain
      + clamp01(permanentIce) * P.packedPermanentIceFloor,
  );
  const accumulatedSignal = clamp01(
    clamp01(leeDeposit) * P.accumulatedLeeGain
      + clamp01(concavityHold) * P.accumulatedConcavityGain
      + clamp01(gentleSlope) * P.accumulatedGentleSlopeGain,
  );

  // A sheltered accumulation signal suppresses the packed interpretation and vice versa. This
  // avoids muddy double-tinting on transition vertices where both upstream signals are non-zero.
  const packedDominance = packedSignal * (1 - accumulatedSignal * 0.72);
  const accumulatedDominance = accumulatedSignal * (1 - packedSignal * 0.72);
  const packedWeight = Math.min(P.maximumPackedWeight, packedDominance * visibleSnow * climate);
  const accumulatedWeight = Math.min(P.maximumAccumulatedWeight, accumulatedDominance * visibleSnow * climate);
  const neutralWeight = clamp01(visibleSnow * (1 - Math.max(packedWeight, accumulatedWeight)));

  return Object.freeze({
    visibleSnow,
    climate,
    packedWeight,
    accumulatedWeight,
    neutralWeight,
    coolShift: packedWeight * P.packedCoolShift - accumulatedWeight * P.accumulatedWarmShift,
    brightnessShift: packedWeight * P.packedBrightnessShift
      + accumulatedWeight * P.accumulatedBrightnessShift,
  });
}
