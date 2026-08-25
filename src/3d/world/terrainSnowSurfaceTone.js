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
  id: 'terrain-snow-surface-tone-2026-08-25-v16-wind-crust-powder-contrast',
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
  packedCoolShift: 0.20,
  packedBrightnessShift: -0.045,
  accumulatedWarmShift: 0.050,
  accumulatedBrightnessShift: 0.052,
  ridgeCrustCoolGain: 0.055,
  ridgeCrustBrightnessLoss: 0.030,
  leePowderWarmGain: 0.018,
  leePowderBrightnessGain: 0.024,
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
      glacialDepthSupport: 0,
      shelteredGlacialRetention: 0,
      shelteredGlacialBridge: 0,
      glacialPackedFloor: 0,
      glacialPaletteFloor: 0,
      transitionColdSupport: 0,
      accumulationGlacialCooling: 0,
      accumulationDepthCooling: 0,
      transitionAccumulationCooling: 0,
      accumulationClimateScale: 1,
      accumulatedGlacialPaletteRetention: 1,
      ridgeScourWeight: 0,
      windSlabWeight: 0,
      leeDriftWeight: 0,
      ridgeCrustTone: 0,
      leePowderTone: 0,
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
  // Deep retained snow should not lose the glacial-family relationship that was established at the
  // thin-snow threshold. Blend a bounded depth term into the same support instead of inventing a
  // second snow amount: this only changes the colour interpretation of already-authoritative snow.
  const glacialDepthSupport = glacialContinuity
    * lerp(P.glacialDepthFloor, 1, accumulationVisibleSnow * P.glacialDepthGain);
  // Strengthen the mixed cryosphere just enough to keep ICE EDGE lowlands visually connected to
  // glacial shoreline/lowland ice. The bell-shaped support returns to zero at pure tundra and pure
  // permanent ice, so it cannot become a second climate or snow-coverage authority.
  const transitionColdSupport = 4 * permanentIceWeight * (1 - permanentIceWeight)
    * glacialVisibility * P.packedTransitionColdGain;
  const shelterSignal = Math.max(clamp01(leeDeposit), clamp01(concavityHold));
  // Far-north mountain snow should belong to the same visual cryosphere family as the glacial
  // lowlands below it. Deep shelter is allowed to soften that bridge, but never erase it entirely;
  // otherwise a lee bowl can become a warm cream island surrounded by blue-grey permanent ice.
  const deepShelter = accumulationVisibleSnow * shelterSignal;
  const shelteredGlacialRetention = lerp(1, P.shelteredGlacialRetentionFloor, deepShelter);
  const glacialFamilySupport = boundedUnion(
    glacialContinuity * shelteredGlacialRetention,
    glacialDepthSupport * P.packedGlacialDepthGain,
  );
  // Retain a small independent packed/cold component inside sheltered permanent ice. It is bounded
  // by both the glacial family and accumulated-snow visibility, so tundra and snow-free terrain get
  // no extra tint while deep far-north drifts remain visually connected to lowland/coastal ice.
  const shelteredGlacialBridge = glacialFamilySupport
    * accumulationVisibleSnow
    * shelterSignal
    * P.packedShelteredGlacialGain;

  // These three signals expose the already-authoritative wind/terrain telemetry at a broader tonal
  // scale. They do not create or remove snow: ridge scour only hardens/cools existing snow, wind slab
  // separates exposed shoulders from neutral snow, and lee drift brightens only retained shelter.
  const exposedSignal = clamp01(clamp01(windwardScour) * 0.62 + clamp01(ridgeExposure) * 0.72);
  const ridgeScourWeight = visibleSnow * climate * exposedSignal * (1 - shelterSignal * 0.58);
  const windSlabWeight = visibleSnow * climate
    * clamp01(clamp01(windwardScour) * 0.46 + clamp01(ridgeExposure) * 0.34 + permanentIceWeight * 0.12)
    * (0.70 + (1 - clamp01(gentleSlope)) * 0.30)
    * (1 - shelterSignal * 0.36);
  const leeDriftWeight = accumulationVisibleSnow * climate * shelterSignal
    * (0.58 + clamp01(gentleSlope) * 0.42)
    * (1 - clamp01(ridgeExposure) * 0.46);

  const packedSignal = clamp01(
    clamp01(windwardScour) * P.packedWindwardGain
      + clamp01(ridgeExposure) * P.packedRidgeGain
      + ridgeScourWeight * P.ridgeScourPackedGain
      + windSlabWeight * P.windSlabPackedGain
      + permanentIceWeight * P.packedPermanentIceFloor
      + glacialContinuity * P.packedGlacialContinuityGain
      + glacialFamilySupport * P.packedGlacialFamilyGain
      + glacialDepthSupport * P.packedGlacialDepthGain
      + shelteredGlacialBridge
      + transitionColdSupport,
  );
  const gentleShelterSupport = clamp01(gentleSlope) * shelterSignal * P.accumulatedGentleSlopeGain;
  const accumulatedSignalRaw = clamp01(
    clamp01(leeDeposit) * P.accumulatedLeeGain
      + clamp01(concavityHold) * P.accumulatedConcavityGain
      + gentleShelterSupport
      + leeDriftWeight * P.leeDriftAccumulationGain,
  );
  const accumulatedSignal = clamp01(
    accumulatedSignalRaw * (1 - ridgeScourWeight * P.ridgeScourAccumulationSuppression),
  );
  // Permanent-ice shelter remains visibly soft, but its warm accumulated tint should lose strength
  // in proportion to the actual glacial-family support beneath it. Deep retained snow gets a second
  // bounded cooling term so a thick lee drift does not become warmer as it visually approaches the
  // glacial lowland below. Both terms are colour-only and leave snowAmount untouched.
  const accumulationGlacialCooling = clamp01(
    glacialFamilySupport * deepShelter * P.shelteredGlacialAccumulationCooling,
  );
  const accumulationDepthCooling = clamp01(
    glacialDepthSupport * accumulationVisibleSnow * shelterSignal * P.glacialDepthAccumulationCooling,
  );
  // The mixed tundra/permanent-ice belt should not become a temporary warm accumulated-snow notch
  // between colder endpoints. Apply a small transition-only cooling term that peaks at 50/50 ice,
  // requires real retained shelter and vanishes at pure tundra and pure permanent ice.
  const transitionAccumulationCooling = clamp01(
    4 * permanentIceWeight * (1 - permanentIceWeight)
      * accumulationVisibleSnow * shelterSignal * P.transitionAccumulationCoolingGain,
  );
  const accumulationClimateScale = lerp(1, P.accumulatedPermanentIceScale, permanentIceWeight)
    * (1 - accumulationGlacialCooling)
    * (1 - accumulationDepthCooling)
    * (1 - transitionAccumulationCooling);
  // The warm accumulated palette should lose a little more influence only when retained snow has
  // both real depth and real glacial-family support. This leaves pure tundra and thin veneers intact,
  // but prevents deep permanent-ice bowls from becoming isolated cream patches in blue-grey terrain.
  const accumulatedGlacialPaletteRetention = lerp(
    1,
    P.accumulatedGlacialPaletteRetentionFloor,
    clamp01(glacialFamilySupport * accumulationVisibleSnow),
  );

  // A sheltered accumulation signal suppresses the ordinary packed interpretation and vice versa.
  // Permanent-ice shelter still keeps independent cold-family floors so a deep lee bowl can remain
  // soft without visually disconnecting from the glacial lowland below it. The broader palette floor
  // also acts on neutral retained snow, strengthening continuously with snow depth while shelter only
  // softens it to an authored retention floor instead of erasing the mountain-to-lowland colour link.
  const packedDominance = packedSignal * (1 - accumulatedSignal * 0.70);
  const accumulatedDominance = accumulatedSignal * (1 - packedSignal * 0.68);
  const glacialPackedFloor = glacialFamilySupport
    * visibleSnow
    * lerp(0.35, 1, deepShelter)
    * P.shelteredPackedFloorGain;
  const glacialPaletteFloor = glacialFamilySupport
    * visibleSnow
    * (P.packedGlacialPaletteFloorGain + accumulationVisibleSnow * P.packedGlacialPaletteDepthGain)
    * lerp(1, P.packedGlacialPaletteShelterRetention, deepShelter);
  const packedWeight = Math.min(
    P.maximumPackedWeight,
    Math.max(packedDominance * visibleSnow * climate, glacialPackedFloor, glacialPaletteFloor),
  );
  // Thin veneers can look cold/packed, but should not read as deep creamy drifts. Accumulated tone
  // therefore needs a little more retained snow than the generic visible-snow threshold. Deep snow
  // remains visible in permanent ice, but its warm/soft tint is moderated so it harmonises with the
  // surrounding glacial/coastal ice rather than forming isolated cream-coloured patches.
  const accumulatedWeight = Math.min(
    P.maximumAccumulatedWeight,
    accumulatedDominance * accumulationVisibleSnow * climate * accumulationClimateScale
      * accumulatedGlacialPaletteRetention,
  );
  const neutralWeight = clamp01(visibleSnow * (1 - Math.max(packedWeight, accumulatedWeight)));

  // Distinguish wind-polished crust from sheltered powder using only the existing authoritative
  // redistribution telemetry. This adds no procedural geography: the colder/darker crust follows
  // genuinely exposed ridges, while the small warm/bright response follows actual lee/concave snow.
  // The two terms are mutually suppressed so full-world snowfields gain readable internal structure
  // without turning into high-frequency noise or changing snow coverage.
  const ridgeCrustTone = clamp01(
    ridgeScourWeight * (0.58 + windSlabWeight * 0.42) * (1 - leeDriftWeight * 0.62),
  );
  const leePowderTone = clamp01(
    leeDriftWeight * (1 - ridgeScourWeight * 0.72) * (0.72 + clamp01(gentleSlope) * 0.28),
  );

  return Object.freeze({
    visibleSnow,
    accumulationVisibleSnow,
    climate,
    tundraToneWeight,
    glacialVisibility,
    glacialContinuity,
    glacialFamilySupport,
    glacialDepthSupport,
    shelteredGlacialRetention,
    shelteredGlacialBridge,
    glacialPackedFloor,
    glacialPaletteFloor,
    transitionColdSupport,
    accumulationGlacialCooling,
    accumulationDepthCooling,
    transitionAccumulationCooling,
    accumulationClimateScale,
    accumulatedGlacialPaletteRetention,
    shelterSignal,
    gentleShelterSupport,
    ridgeScourWeight,
    windSlabWeight,
    leeDriftWeight,
    ridgeCrustTone,
    leePowderTone,
    packedWeight,
    accumulatedWeight,
    neutralWeight,
    coolShift: packedWeight * P.packedCoolShift
      - accumulatedWeight * P.accumulatedWarmShift
      + ridgeCrustTone * P.ridgeCrustCoolGain
      - leePowderTone * P.leePowderWarmGain,
    brightnessShift: packedWeight * P.packedBrightnessShift
      + accumulatedWeight * P.accumulatedBrightnessShift
      - ridgeCrustTone * P.ridgeCrustBrightnessLoss
      + leePowderTone * P.leePowderBrightnessGain,
  });
}
