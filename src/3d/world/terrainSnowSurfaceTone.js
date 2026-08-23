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
const lerp = (a, b, t) => a + (b - a) * t;
const boundedUnion = (a, b) => 1 - (1 - clamp01(a)) * (1 - clamp01(b));

export const TERRAIN_SNOW_SURFACE_TONE_POLICY = Object.freeze({
  id: 'terrain-snow-surface-tone-2026-08-23-v6-thin-snow-glacial-continuity',
  renderOnly: true,
  heightAuthorityUnchanged: true,
  snowCoverageAuthorityUnchanged: true,
  cryosphereToneUnion: true,
  glacialFamilyBridge: true,
  glacialVisibilityExponent: 0.65,
  packedWindwardGain: 0.72,
  packedRidgeGain: 0.34,
  packedPermanentIceFloor: 0.10,
  packedGlacialContinuityGain: 0.08,
  packedGlacialFamilyGain: 0.12,
  packedTransitionColdGain: 0.05,
  accumulatedLeeGain: 0.72,
  accumulatedConcavityGain: 0.42,
  accumulatedGentleSlopeGain: 0.16,
  accumulatedPermanentIceScale: 0.62,
  tundraToneScale: 0.78,
  minimumVisibleSnow: 0.08,
  minimumAccumulatedSnow: 0.22,
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
 *
 * Permanent-ice terrain deliberately biases retained snow toward the packed/cold family and tones
 * down the warm accumulated interpretation. The tundra and permanent-ice tone influences are
 * combined as a bounded union rather than selected with max(), preventing a subtle colour-derivative
 * kink where the two authored climate fields overlap on the map-aligned north transition.
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
  const normalizedSnow = clamp01(snowAmount);
  const permanentIceWeight = clamp01(permanentIce);
  const tundraWeight = clamp01(tundra);
  const tundraToneWeight = tundraWeight * P.tundraToneScale;
  const visibleSnow = clamp01((normalizedSnow - P.minimumVisibleSnow) / (1 - P.minimumVisibleSnow));
  const accumulationVisibleSnow = clamp01(
    (normalizedSnow - P.minimumAccumulatedSnow) / (1 - P.minimumAccumulatedSnow),
  );
  const climate = boundedUnion(permanentIceWeight, tundraToneWeight);

  if (visibleSnow <= 0 || climate <= 0) {
    return Object.freeze({
      visibleSnow,
      accumulationVisibleSnow,
      climate,
      tundraToneWeight,
      glacialVisibility: 0,
      glacialContinuity: 0,
      glacialFamilySupport: 0,
      transitionColdSupport: 0,
      accumulationClimateScale: 1,
      packedWeight: 0,
      accumulatedWeight: 0,
      neutralWeight: visibleSnow,
      coolShift: 0,
      brightnessShift: 0,
    });
  }

  // Keep thin-but-visible permanent-ice snow inside the same cold colour family as the lowland ice
  // below it without changing how much snow exists. A sub-linear visibility curve prevents the
  // glacial bridge from being effectively multiplied by visibleSnow twice near the snow threshold.
  const glacialVisibility = Math.pow(visibleSnow, P.glacialVisibilityExponent);
  const glacialContinuity = permanentIceWeight * glacialVisibility;
  // Smoothly reinforce the cold family inside the permanent-ice transition, but let the support
  // return to zero at both pure tundra and fully glaciated endpoints. This avoids a visible colour
  // notch without changing snow coverage or creating a new climate authority.
  const transitionColdSupport = 4 * permanentIceWeight * (1 - permanentIceWeight)
    * glacialVisibility * P.packedTransitionColdGain;
  const shelterSignal = Math.max(clamp01(leeDeposit), clamp01(concavityHold));
  // Far-north mountain snow should belong to the same visual cryosphere family as the glacial
  // lowlands below it. Keep that bridge strongest on exposed/neutral snow and taper it inside deep
  // sheltered drifts so lee bowls retain a visibly softer accumulated-snow character.
  const deepShelter = accumulationVisibleSnow * shelterSignal;
  const glacialFamilySupport = glacialContinuity * (1 - deepShelter * 0.55);
  const packedSignal = clamp01(
    clamp01(windwardScour) * P.packedWindwardGain
      + clamp01(ridgeExposure) * P.packedRidgeGain
      + permanentIceWeight * P.packedPermanentIceFloor
      + glacialContinuity * P.packedGlacialContinuityGain
      + glacialFamilySupport * P.packedGlacialFamilyGain
      + transitionColdSupport,
  );
  const gentleShelterSupport = clamp01(gentleSlope) * shelterSignal * P.accumulatedGentleSlopeGain;
  const accumulatedSignal = clamp01(
    clamp01(leeDeposit) * P.accumulatedLeeGain
      + clamp01(concavityHold) * P.accumulatedConcavityGain
      + gentleShelterSupport,
  );
  const accumulationClimateScale = lerp(1, P.accumulatedPermanentIceScale, permanentIceWeight);

  // A sheltered accumulation signal suppresses the packed interpretation and vice versa. This
  // avoids muddy double-tinting on transition vertices where both upstream signals are non-zero.
  const packedDominance = packedSignal * (1 - accumulatedSignal * 0.72);
  const accumulatedDominance = accumulatedSignal * (1 - packedSignal * 0.72);
  const packedWeight = Math.min(P.maximumPackedWeight, packedDominance * visibleSnow * climate);
  // Thin veneers can look cold/packed, but should not read as deep creamy drifts. Accumulated tone
  // therefore needs a little more retained snow than the generic visible-snow threshold. Deep snow
  // remains visible in permanent ice, but its warm/soft tint is moderated so it harmonises with the
  // surrounding glacial/coastal ice rather than forming isolated cream-coloured patches.
  const accumulatedWeight = Math.min(
    P.maximumAccumulatedWeight,
    accumulatedDominance * accumulationVisibleSnow * climate * accumulationClimateScale,
  );
  const neutralWeight = clamp01(visibleSnow * (1 - Math.max(packedWeight, accumulatedWeight)));

  return Object.freeze({
    visibleSnow,
    accumulationVisibleSnow,
    climate,
    tundraToneWeight,
    glacialVisibility,
    glacialContinuity,
    glacialFamilySupport,
    transitionColdSupport,
    accumulationClimateScale,
    shelterSignal,
    gentleShelterSupport,
    packedWeight,
    accumulatedWeight,
    neutralWeight,
    coolShift: packedWeight * P.packedCoolShift - accumulatedWeight * P.accumulatedWarmShift,
    brightnessShift: packedWeight * P.packedBrightnessShift
      + accumulatedWeight * P.accumulatedBrightnessShift,
  });
}
