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
  id: 'terrain-snow-surface-tone-2026-08-28-v34-form-driven-ice-edge-cold-bridge',
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
  coreIceFirnBridge: true,
  coreIceFirnCompactionWindow: true,
  coreIceCrustDriftSeparation: true,
  glacialPowderAttenuation: 0.62,
  coreIcePowderAttenuation: 0.10,
  basePackedRetentionMin: 0.62,
  basePackedRetentionGlacialGain: 0.08,
  glacialVisibilityExponent: 0.65,
  glacialDepthFloor: 0.54,
  glacialDepthGain: 0.46,
  packedWindwardGain: 0.92,
  packedRidgeGain: 0.56,
  packedPermanentIceFloor: 0.04,
  packedGlacialContinuityGain: 0.04,
  packedGlacialFamilyGain: 0.15,
  packedGlacialDepthGain: 0.06,
  packedShelteredGlacialGain: 0.07,
  packedTransitionColdGain: 0.08,
  mixedIceFirnPackedFloorGain: 0.18,
  mixedIceFirnPowderAttenuation: 0.18,
  coreIceFirnPackedFloorGain: 0.12,
  coreIceFirnCompactionBoost: 0.14,
  coreIceFreshDriftStart: 0.82,
  coreIceFreshDriftFull: 0.94,
  coreIceRidgeCrustPackedGain: 0.18,
  coreIceLeePowderAccumulationGain: 0.12,
  ridgeScourPackedGain: 0.48,
  windSlabPackedGain: 0.36,
  ridgeScourAccumulationSuppression: 0.58,
  shelteredPackedFloorGain: 0.10,
  packedGlacialPaletteFloorGain: 0.23,
  packedGlacialPaletteDepthGain: 0.06,
  packedGlacialPaletteShelterRetention: 0.60,
  accumulatedLeeGain: 0.90,
  accumulatedConcavityGain: 0.62,
  accumulatedGentleSlopeGain: 0.24,
  leeDriftAccumulationGain: 0.42,
  accumulatedPermanentIceScale: 0.58,
  accumulatedGlacialPaletteRetentionFloor: 0.76,
  shelteredGlacialRetentionFloor: 0.66,
  shelteredGlacialAccumulationCooling: 0.10,
  glacialDepthAccumulationCooling: 0.06,
  transitionAccumulationCoolingGain: 0.08,
  tundraToneScale: 0.78,
  minimumVisibleSnow: 0.08,
  minimumAccumulatedSnow: 0.22,
  maximumPackedWeight: 0.88,
  maximumAccumulatedWeight: 0.92,
  ridgeCrustPaletteGain: 0.34,
  ridgeCrustPowderSuppression: 0.24,
  leePowderPaletteGain: 0.34,
  leePowderPackedSuppression: 0.26,
  packedCoolShift: 0.24,
  packedBrightnessShift: -0.065,
  accumulatedWarmShift: 0.065,
  accumulatedBrightnessShift: 0.070,
  ridgeCrustCoolGain: 0.075,
  ridgeCrustBrightnessLoss: 0.045,
  leePowderWarmGain: 0.025,
  leePowderBrightnessGain: 0.035,
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
      glacialPaletteFloor: 0, mixedIceWeight: 0, mixedIceFirnFloor: 0, coreIceFirnFloor: 0,
      coreIceFirnCompaction: 0, coreIceRidgeCrust: 0, coreIceLeePowder: 0,
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
  const mixedIceFirnFloor = mixedIceWeight * glacialVisibility
    * lerp(0.62, 1, accumulationVisibleSnow)
    * lerp(0.78, 1, shelterSignal)
    * P.mixedIceFirnPackedFloorGain;
  const coreIceFirnCompaction = 1 - clamp01(
    (deepShelter - P.coreIceFreshDriftStart) / (P.coreIceFreshDriftFull - P.coreIceFreshDriftStart),
  );
  const coreIceFirnFloor = permanentIceWeight * glacialVisibility
    * lerp(0.60, 1, accumulationVisibleSnow)
    * lerp(0.82, 1, shelterSignal)
    * P.coreIceFirnPackedFloorGain
    * lerp(1, 1 + P.coreIceFirnCompactionBoost, coreIceFirnCompaction);
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
  const coreIceRidgeCrust = permanentIceWeight * glacialVisibility * ridgeCrustTone * P.coreIceRidgeCrustPackedGain;
  const coreIceLeePowder = permanentIceWeight * accumulationVisibleSnow * leePowderTone * P.coreIceLeePowderAccumulationGain;

  const protectedBasePacked = packedWeight * (
    P.basePackedRetentionMin + glacialFamilySupport * P.basePackedRetentionGlacialGain
  );
  const glacialMaterialPackedFloor = Math.max(
    glacialPackedFloor,
    glacialPaletteFloor,
    mixedIceFirnFloor,
    coreIceFirnFloor,
    protectedBasePacked,
  );
  const powderPaletteGain = P.leePowderPaletteGain
    * (1 - glacialFamilySupport * P.glacialPowderAttenuation)
    * (1 - mixedIceWeight * P.mixedIceFirnPowderAttenuation)
    * (1 - permanentIceWeight * P.coreIcePowderAttenuation);
  const materialPackedWeight = Math.min(
    P.maximumPackedWeight,
    Math.max(
      glacialMaterialPackedFloor,
      clamp01(packedWeight + ridgeCrustTone * P.ridgeCrustPaletteGain + coreIceRidgeCrust - leePowderTone * P.leePowderPackedSuppression),
    ),
  );
  const materialAccumulatedWeight = Math.min(
    P.maximumAccumulatedWeight,
    clamp01(accumulatedWeight + leePowderTone * powderPaletteGain + coreIceLeePowder - ridgeCrustTone * P.ridgeCrustPowderSuppression),
  );
  const neutralWeight = clamp01(visibleSnow * (1 - Math.max(materialPackedWeight, materialAccumulatedWeight)));

  return Object.freeze({
    visibleSnow, accumulationVisibleSnow, climate, tundraToneWeight, glacialVisibility, glacialContinuity,
    glacialFamilySupport, glacialDepthSupport, shelteredGlacialRetention, shelteredGlacialBridge,
    glacialPackedFloor, glacialPaletteFloor, mixedIceWeight, mixedIceFirnFloor, coreIceFirnFloor,
    coreIceFirnCompaction, coreIceRidgeCrust, coreIceLeePowder, transitionColdSupport, accumulationGlacialCooling,
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
