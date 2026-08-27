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
  id: 'terrain-snow-surface-tone-2026-08-27-v21-mixed-ice-firn-bridge',
  renderOnly: true,
  heightAuthorityUnchanged: true,
  snowCoverageAuthorityUnchanged: true,
  cryosphereToneUnion: true,
  glacialFamilyBridge: true,
  glacialDepthHarmony: true,
  shelteredPackedFloor: true,
  glacialPaletteFloor: true,
  transitionAccumulationHarmony: true,
  transitionLowlandHarmony: true,
  glacialAccumulatedPaletteRetention: true,
  ridgeScourReadability: true,
  leeDriftReadability: true,
  windSlabReadability: true,
  windCrustPowderContrast: true,
  materialFamilySeparation: true,
  materialFamilyCompetition: true,
  glacialMaterialFloorProtection: true,
  mixedIceFirnBridge: true,
  glacialPowderAttenuation: 0.75,
  basePackedRetentionMin: 0.78,
  basePackedRetentionGlacialGain: 0.16,
  glacialVisibilityExponent: 0.65,
  glacialDepthFloor: 0.54,
  glacialDepthGain: 0.46,
  packedWindwardGain: 0.78,
  packedRidgeGain: 0.40,
  packedPermanentIceFloor: 0.10,
  packedGlacialContinuityGain: 0.08,
  packedGlacialFamilyGain: 0.16,
  packedGlacialDepthGain: 0.08,
  packedShelteredGlacialGain: 0.10,
  packedTransitionColdGain: 0.075,
  mixedIceFirnPackedFloorGain: 0.18,
  mixedIceFirnPowderAttenuation: 0.20,
  ridgeScourPackedGain: 0.28,
  windSlabPackedGain: 0.20,
  ridgeScourAccumulationSuppression: 0.46,
  shelteredPackedFloorGain: 0.12,
  packedGlacialPaletteFloorGain: 0.25,
  packedGlacialPaletteDepthGain: 0.10,
  packedGlacialPaletteShelterRetention: 0.72,
  accumulatedLeeGain: 0.72,
  accumulatedConcavityGain: 0.42,
  accumulatedGentleSlopeGain: 0.16,
  leeDriftAccumulationGain: 0.26,
  accumulatedPermanentIceScale: 0.54,
  accumulatedGlacialPaletteRetentionFloor: 0.72,
  shelteredGlacialRetentionFloor: 0.58,
  shelteredGlacialAccumulationCooling: 0.18,
  glacialDepthAccumulationCooling: 0.10,
  transitionAccumulationCoolingGain: 0.12,
  tundraToneScale: 0.78,
  minimumVisibleSnow: 0.08,
  minimumAccumulatedSnow: 0.22,
  maximumPackedWeight: 0.82,
  maximumAccumulatedWeight: 0.82,
  ridgeCrustPaletteGain: 0.16,
  ridgeCrustPowderSuppression: 0.12,
  leePowderPaletteGain: 0.18,
  leePowderPackedSuppression: 0.14,
  packedCoolShift: 0.20,
  packedBrightnessShift: -0.045,
  accumulatedWarmShift: 0.050,
  accumulatedBrightnessShift: 0.052,
  ridgeCrustCoolGain: 0.055,
  ridgeCrustBrightnessLoss: 0.030,
  leePowderWarmGain: 0.018,
  leePowderBrightnessGain: 0.024,
});

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
  const accumulationVisibleSnow = clamp01((normalizedSnow - P.minimumAccumulatedSnow) / (1 - P.minimumAccumulatedSnow));
  const climate = boundedUnion(permanentIceWeight, tundraToneWeight);

  if (visibleSnow <= 0 || climate <= 0) {
    return Object.freeze({
      visibleSnow, accumulationVisibleSnow, climate, tundraToneWeight,
      glacialVisibility: 0, glacialContinuity: 0, glacialFamilySupport: 0, glacialDepthSupport: 0,
      shelteredGlacialRetention: 0, shelteredGlacialBridge: 0, glacialPackedFloor: 0,
      glacialPaletteFloor: 0, mixedIceWeight: 0, mixedIceFirnFloor: 0,
      transitionColdSupport: 0, accumulationGlacialCooling: 0,
      accumulationDepthCooling: 0, transitionAccumulationCooling: 0, accumulationClimateScale: 1,
      accumulatedGlacialPaletteRetention: 1, ridgeScourWeight: 0, windSlabWeight: 0,
      leeDriftWeight: 0, ridgeCrustTone: 0, leePowderTone: 0, packedWeight: 0,
      accumulatedWeight: 0, neutralWeight: visibleSnow, coolShift: 0, brightnessShift: 0,
    });
  }

  const glacialVisibility = Math.pow(visibleSnow, P.glacialVisibilityExponent);
  const glacialContinuity = permanentIceWeight * glacialVisibility;
  const glacialDepthSupport = glacialContinuity * lerp(P.glacialDepthFloor, 1, accumulationVisibleSnow * P.glacialDepthGain);
  // Bell-shaped transition support is exact-zero in pure tundra and full permanent ice. It therefore
  // cannot expand the canonical cryosphere; it only identifies the already-authored mixed ice belt.
  const mixedIceWeight = 4 * permanentIceWeight * (1 - permanentIceWeight);
  const transitionColdSupport = mixedIceWeight * glacialVisibility * P.packedTransitionColdGain;
  const shelterSignal = Math.max(clamp01(leeDeposit), clamp01(concavityHold));
  const deepShelter = accumulationVisibleSnow * shelterSignal;
  const shelteredGlacialRetention = lerp(1, P.shelteredGlacialRetentionFloor, deepShelter);
  const glacialFamilySupport = boundedUnion(
    glacialContinuity * shelteredGlacialRetention,
    glacialDepthSupport * P.packedGlacialDepthGain,
  );
  const shelteredGlacialBridge = glacialFamilySupport * accumulationVisibleSnow * shelterSignal * P.packedShelteredGlacialGain;

  const exposedSignal = clamp01(clamp01(windwardScour) * 0.62 + clamp01(ridgeExposure) * 0.72);
  const ridgeScourWeight = visibleSnow * climate * exposedSignal * (1 - shelterSignal * 0.58);
  const windSlabWeight = visibleSnow * climate
    * clamp01(clamp01(windwardScour) * 0.46 + clamp01(ridgeExposure) * 0.34 + permanentIceWeight * 0.12)
    * (0.70 + (1 - clamp01(gentleSlope)) * 0.30) * (1 - shelterSignal * 0.36);
  const leeDriftWeight = accumulationVisibleSnow * climate * shelterSignal
    * (0.58 + clamp01(gentleSlope) * 0.42) * (1 - clamp01(ridgeExposure) * 0.46);

  const packedSignal = clamp01(
    clamp01(windwardScour) * P.packedWindwardGain
      + clamp01(ridgeExposure) * P.packedRidgeGain
      + ridgeScourWeight * P.ridgeScourPackedGain
      + windSlabWeight * P.windSlabPackedGain
      + permanentIceWeight * P.packedPermanentIceFloor
      + glacialContinuity * P.packedGlacialContinuityGain
      + glacialFamilySupport * P.packedGlacialFamilyGain
      + glacialDepthSupport * P.packedGlacialDepthGain
      + shelteredGlacialBridge + transitionColdSupport,
  );
  const gentleShelterSupport = clamp01(gentleSlope) * shelterSignal * P.accumulatedGentleSlopeGain;
  const accumulatedSignalRaw = clamp01(
    clamp01(leeDeposit) * P.accumulatedLeeGain
      + clamp01(concavityHold) * P.accumulatedConcavityGain
      + gentleShelterSupport + leeDriftWeight * P.leeDriftAccumulationGain,
  );
  const accumulatedSignal = clamp01(accumulatedSignalRaw * (1 - ridgeScourWeight * P.ridgeScourAccumulationSuppression));
  const accumulationGlacialCooling = clamp01(glacialFamilySupport * deepShelter * P.shelteredGlacialAccumulationCooling);
  const accumulationDepthCooling = clamp01(glacialDepthSupport * accumulationVisibleSnow * shelterSignal * P.glacialDepthAccumulationCooling);
  const transitionAccumulationCooling = clamp01(
    mixedIceWeight * accumulationVisibleSnow * shelterSignal * P.transitionAccumulationCoolingGain,
  );
  const accumulationClimateScale = lerp(1, P.accumulatedPermanentIceScale, permanentIceWeight)
    * (1 - accumulationGlacialCooling) * (1 - accumulationDepthCooling) * (1 - transitionAccumulationCooling);
  const accumulatedGlacialPaletteRetention = lerp(
    1, P.accumulatedGlacialPaletteRetentionFloor, clamp01(glacialFamilySupport * accumulationVisibleSnow),
  );

  const packedDominance = packedSignal * (1 - accumulatedSignal * 0.70);
  const accumulatedDominance = accumulatedSignal * (1 - packedSignal * 0.68);
  const glacialPackedFloor = glacialFamilySupport * visibleSnow * lerp(0.35, 1, deepShelter) * P.shelteredPackedFloorGain;
  const glacialPaletteFloor = glacialFamilySupport * visibleSnow
    * (P.packedGlacialPaletteFloorGain + accumulationVisibleSnow * P.packedGlacialPaletteDepthGain)
    * lerp(1, P.packedGlacialPaletteShelterRetention, deepShelter);
  // Mixed ice is old/compacted firn even where fresh lee powder collects. Preserve a bounded cold
  // material floor beneath that powder so the ice-edge remains visually between tundra and the full
  // glacial core. Depth and shelter modulate the floor, while the bell weight keeps both endmembers
  // exactly unchanged.
  const mixedIceFirnFloor = mixedIceWeight * glacialVisibility
    * lerp(0.62, 1, accumulationVisibleSnow)
    * lerp(0.78, 1, shelterSignal)
    * P.mixedIceFirnPackedFloorGain;
  const packedWeight = Math.min(
    P.maximumPackedWeight,
    Math.max(packedDominance * visibleSnow * climate, glacialPackedFloor, glacialPaletteFloor),
  );
  const accumulatedWeight = Math.min(
    P.maximumAccumulatedWeight,
    accumulatedDominance * accumulationVisibleSnow * climate * accumulationClimateScale * accumulatedGlacialPaletteRetention,
  );

  const ridgeCrustTone = clamp01(ridgeScourWeight * (0.58 + windSlabWeight * 0.42) * (1 - leeDriftWeight * 0.62));
  const leePowderTone = clamp01(leeDriftWeight * (1 - ridgeScourWeight * 0.72) * (0.72 + clamp01(gentleSlope) * 0.28));

  // Powder remains strongest in pure tundra and progressively loses its warm/soft palette push as
  // the already-authoritative glacial family strengthens. In the mixed-ice belt, refrozen firn also
  // attenuates that warm powder push; this affects material family only and never snow coverage.
  const protectedBasePacked = packedWeight * (
    P.basePackedRetentionMin + glacialFamilySupport * P.basePackedRetentionGlacialGain
  );
  const glacialMaterialPackedFloor = Math.max(
    glacialPackedFloor,
    glacialPaletteFloor,
    mixedIceFirnFloor,
    protectedBasePacked,
  );
  const powderPaletteGain = P.leePowderPaletteGain
    * (1 - glacialFamilySupport * P.glacialPowderAttenuation)
    * (1 - mixedIceWeight * P.mixedIceFirnPowderAttenuation);
  const materialPackedWeight = Math.min(
    P.maximumPackedWeight,
    Math.max(
      glacialMaterialPackedFloor,
      clamp01(packedWeight + ridgeCrustTone * P.ridgeCrustPaletteGain - leePowderTone * P.leePowderPackedSuppression),
    ),
  );
  const materialAccumulatedWeight = Math.min(
    P.maximumAccumulatedWeight,
    clamp01(accumulatedWeight + leePowderTone * powderPaletteGain - ridgeCrustTone * P.ridgeCrustPowderSuppression),
  );
  const neutralWeight = clamp01(visibleSnow * (1 - Math.max(materialPackedWeight, materialAccumulatedWeight)));

  return Object.freeze({
    visibleSnow, accumulationVisibleSnow, climate, tundraToneWeight, glacialVisibility, glacialContinuity,
    glacialFamilySupport, glacialDepthSupport, shelteredGlacialRetention, shelteredGlacialBridge,
    glacialPackedFloor, glacialPaletteFloor, mixedIceWeight, mixedIceFirnFloor,
    transitionColdSupport, accumulationGlacialCooling,
    accumulationDepthCooling, transitionAccumulationCooling, accumulationClimateScale,
    accumulatedGlacialPaletteRetention, shelterSignal, gentleShelterSupport, ridgeScourWeight,
    windSlabWeight, leeDriftWeight, ridgeCrustTone, leePowderTone,
    packedWeight: materialPackedWeight,
    accumulatedWeight: materialAccumulatedWeight,
    neutralWeight,
    coolShift: materialPackedWeight * P.packedCoolShift
      - materialAccumulatedWeight * P.accumulatedWarmShift
      + ridgeCrustTone * P.ridgeCrustCoolGain - leePowderTone * P.leePowderWarmGain,
    brightnessShift: materialPackedWeight * P.packedBrightnessShift
      + materialAccumulatedWeight * P.accumulatedBrightnessShift
      - ridgeCrustTone * P.ridgeCrustBrightnessLoss + leePowderTone * P.leePowderBrightnessGain,
  });
}
