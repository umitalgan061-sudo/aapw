import * as THREE from 'three';
import {
  sampleWorldEcologySurfaceField,
  ecologySurfaceMaterialContext,
  summarizeEcologySurfaceField,
} from '../world/worldEcologySurfaceField.js';
import {
  inferWorldAssetSurfaceProfile,
  deriveWorldAssetSurfaceResponse,
  WORLD_ASSET_SURFACE_PROFILES_REVISION,
} from './worldAssetSurfaceProfiles.js';

/**
 * Bounded placement-context adapter for generated/authored world materials.
 *
 * Canonical placement remains authoritative. The adapter only derives render response from the exact
 * surface and footprint samples that already passed the world placement gate. It adds deterministic
 * multi-scale ecology/material context without changing geometry, grounding, hydrology or source UVs.
 */
export const WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY = Object.freeze({
  // Compatibility id intentionally stays stable for exact-head guards.
  id: 'world-placement-material-context-2026-09-02-v2-footprint-weathering',
  revision: 'v4-multiscale-ecology-family-material-response',
  renderOnly: true,
  canonicalSurfaceContextOnly: true,
  footprintSurfaceAggregation: true,
  canonicalFootprintSamplesOnly: true,
  sourceTexturesPreserved: true,
  sourceUvTransformsPreserved: true,
  geometryUnchanged: true,
  placementUnchanged: true,
  canonicalTerrainUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalColliderUnchanged: true,
  newGeographyIntroduced: false,
  maximumColorMix: 0.14,
  maximumRoughnessDelta: 0.12,
  maximumMetalnessReduction: 0.075,
  footprintReliefNormalizationMeters: 9,
  roadDustNearMeters: 9,
  settlementWearNearMeters: 24,
  shallowWaterWetnessMeters: 1.25,
  ecologySurfaceField: true,
  familySpecificSurfaceProfiles: true,
  worldSpaceMaterialScales: true,
  foundationDampResponse: true,
  exposedFootprintWeathering: true,
  roadDustResponse: true,
  settlementWearResponse: true,
});

const COLOR_CONTEXTS = Object.freeze({
  damp: new THREE.Color(0x667064),
  dry: new THREE.Color(0xa68d64),
  cold: new THREE.Color(0x9fadae),
  snow: new THREE.Color(0xc5cecf),
  forest: new THREE.Color(0x65775a),
  marsh: new THREE.Color(0x5d7164),
  alpine: new THREE.Color(0x8b9191),
  coast: new THREE.Color(0x7f8d89),
  mineral: new THREE.Color(0x8e8272),
  oxidised: new THREE.Color(0x875b43),
  lichen: new THREE.Color(0x7b8469),
  moss: new THREE.Color(0x596b4d),
  salt: new THREE.Color(0xb6b5a6),
  roadDust: new THREE.Color(0x998463),
  foundationDamp: new THREE.Color(0x5b665d),
  settlementWear: new THREE.Color(0x817564),
});

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const finite = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const smooth01 = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const nearWeight = (distance, maximum) => {
  const value = finite(distance);
  if (value === null) return 0;
  return 1 - smooth01(value / Math.max(0.001, maximum));
};

function normalizedBiome(value) {
  return String(value || '').trim().toLowerCase();
}

function biomeWeights(biome) {
  const id = normalizedBiome(biome);
  return Object.freeze({
    forest: /forest|wood|grove|taiga/.test(id) ? 1 : 0,
    marsh: /marsh|swamp|bog|wetland|fen/.test(id) ? 1 : 0,
    snow: /snow|ice|glacier|permanent-ice/.test(id) ? 1 : 0,
    cold: /tundra|cold|subalpine/.test(id) ? 1 : 0,
    alpine: /alpine|bare|mountain|ridge|cliff/.test(id) ? 1 : 0,
    coast: /coast|shore|beach|intertidal/.test(id) ? 1 : 0,
    dry: /desert|arid|heath|steppe|dry/.test(id) ? 1 : 0,
  });
}

function surfaceContext(surface = {}) {
  const moisture = Number.isFinite(surface.moisture) ? clamp01(surface.moisture) : 0.50;
  const slopeDegrees = Number.isFinite(surface.slopeDegrees) ? Math.max(0, surface.slopeDegrees) : 0;
  const slope = clamp01(slopeDegrees / 60);
  const waterDepth = Number.isFinite(surface.waterDepth) ? Math.max(0, surface.waterDepth) : 0;
  const roadDistance = finite(surface.roadDistance);
  const settlementDistance = finite(surface.settlementDistance);
  const biome = biomeWeights(surface.biome);
  const shallowWater = waterDepth > 0
    ? 1 - smooth01(waterDepth / WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.shallowWaterWetnessMeters)
    : 0;
  const wet = clamp01((moisture - 0.48) / 0.42 + biome.marsh * 0.45 + shallowWater * 0.26);
  const dry = clamp01((0.48 - moisture) / 0.42 + biome.dry * 0.62);
  const cold = clamp01(biome.cold * 0.70 + biome.snow * 0.55);
  const snow = clamp01(biome.snow);
  const exposure = clamp01(slope * 0.62 + biome.alpine * 0.48);
  const coast = clamp01(biome.coast + shallowWater * 0.34);
  const roadDust = nearWeight(roadDistance, WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.roadDustNearMeters)
    * (1 - wet * 0.78) * (0.55 + dry * 0.45);
  const settlementWear = nearWeight(
    settlementDistance,
    WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.settlementWearNearMeters,
  ) * (0.52 + dry * 0.18 + exposure * 0.12);

  const ecologyField = sampleWorldEcologySurfaceField({
    x: finite(surface.x, 0),
    z: finite(surface.z, 0),
    elevationMeters: finite(surface.height ?? surface.elevation ?? surface.heightMeters, 0),
    slopeDegrees,
    aspectRadians: finite(surface.aspectRadians, 0),
    moisture,
    biome: surface.biome,
    waterDepth,
    riverDistance: surface.riverDistance,
    lakeDistance: surface.lakeDistance,
    coastDistance: surface.coastDistance,
    roadDistance,
    settlementDistance,
    snow,
    concavity: finite(surface.concavity ?? surface.moistureRetention, 0.5),
    shelter: finite(surface.shelter ?? surface.topographicShelter, 0.5),
    erosion: finite(surface.erosion ?? surface.rockfallSource, 0.5),
    deposition: finite(surface.deposition ?? surface.depositionalBench, 0.5),
    seed: finite(surface.seed, 0),
  });
  const ecology = ecologySurfaceMaterialContext(ecologyField);

  return Object.freeze({
    x: finite(surface.x, 0),
    z: finite(surface.z, 0),
    moisture,
    slope,
    slopeDegrees,
    wet,
    dry,
    cold,
    snow,
    exposure,
    coast,
    roadDust: clamp01(roadDust),
    settlementWear: clamp01(settlementWear),
    shallowWater,
    ecologyField,
    ecology,
    ...biome,
  });
}

function robustAggregate(values, fallback = 0) {
  const finiteValues = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finiteValues.length) return fallback;
  const median = finiteValues[Math.floor(finiteValues.length * 0.5)];
  const mean = finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
  const lower = finiteValues[Math.floor(finiteValues.length * 0.25)];
  const upper = finiteValues[Math.floor(finiteValues.length * 0.75)];
  return clamp01(median * 0.50 + mean * 0.28 + lower * 0.10 + upper * 0.12);
}

function aggregatePlacementContext(surface, footprint) {
  const samples = [
    surface,
    ...(footprint?.samples ?? []),
    ...(footprint?.islandSamples ?? []),
  ].filter(Boolean);
  const contexts = samples.map(surfaceContext);
  const fields = [
    'moisture', 'slope', 'wet', 'dry', 'cold', 'snow', 'exposure', 'coast',
    'forest', 'marsh', 'alpine', 'roadDust', 'settlementWear', 'shallowWater',
  ];
  const ecologyFields = [
    'moisture', 'exposure', 'shelter', 'aridity', 'deposition', 'erosion', 'lithic',
    'soilDepth', 'frost', 'wetMeadow', 'dryHeath', 'woodland', 'scrub', 'bareRock',
    'talus', 'riparian', 'coastal', 'alpine', 'albedoMacro', 'albedoMeso',
    'albedoFine', 'roughnessMacro', 'roughnessFine', 'normalMacro', 'normalFine',
    'weathering', 'lichen', 'moss', 'sedimentFabric',
  ];
  const aggregate = {};
  for (const field of fields) aggregate[field] = robustAggregate(contexts.map((context) => context[field]));
  const ecology = {};
  for (const field of ecologyFields) ecology[field] = robustAggregate(
    contexts.map((context) => context.ecology?.[field]),
    0.5,
  );

  const angles = contexts
    .map((context) => context.ecology?.sedimentAngle)
    .filter(Number.isFinite);
  if (angles.length) {
    const sin = angles.reduce((sum, value) => sum + Math.sin(value), 0);
    const cos = angles.reduce((sum, value) => sum + Math.cos(value), 0);
    ecology.sedimentAngle = Math.atan2(sin, cos);
  } else {
    ecology.sedimentAngle = 0;
  }

  const count = Math.max(1, contexts.length);
  aggregate.wet = Math.max(
    aggregate.wet,
    contexts.filter((context) => context.wet > 0.62).length / count * 0.72,
  );
  aggregate.snow = Math.max(
    aggregate.snow,
    contexts.filter((context) => context.snow > 0.5).length / count * 0.80,
  );
  aggregate.coast = Math.max(
    aggregate.coast,
    contexts.filter((context) => context.coast > 0.45).length / count * 0.64,
  );
  aggregate.roadDust = Math.max(
    aggregate.roadDust,
    contexts.filter((context) => context.roadDust > 0.52).length / count * 0.60,
  );
  aggregate.settlementWear = Math.max(
    aggregate.settlementWear,
    contexts.filter((context) => context.settlementWear > 0.48).length / count * 0.56,
  );

  const footprintRelief = clamp01(
    Math.max(0, finite(footprint?.heightRange, 0))
      / WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.footprintReliefNormalizationMeters,
  );
  const footprintStress = clamp01(
    footprintRelief * 0.58
      + aggregate.exposure * 0.18
      + ecology.erosion * 0.16
      + ecology.lithic * 0.08,
  );
  const foundationDamp = clamp01(
    aggregate.wet * 0.34
      + ecology.moisture * 0.22
      + contexts.filter((context) => context.wet > 0.60).length / count * 0.16
      + aggregate.shallowWater * 0.15
      + ecology.deposition * 0.06
      + (footprint?.groundingMode === 'embedded-low-side' ? 0.07 : 0.02),
  );

  return Object.freeze({
    ...aggregate,
    ecology: Object.freeze(ecology),
    footprintRelief,
    footprintStress,
    foundationDamp,
    sampleCount: contexts.length,
    centerEcologySummary: summarizeEcologySurfaceField(contexts[0]?.ecologyField),
  });
}

function colorInfluenceForFamily(family) {
  if (family === 'metal') return 0.48;
  if (family === 'cryosphere') return 0.42;
  if (family === 'foliage') return 0.80;
  if (family === 'masonry') return 0.76;
  if (family === 'roof') return 0.68;
  return 1;
}

function applyTint(material, target, weight, state) {
  if (!material?.color || !(weight > 0)) return;
  const remaining = Math.max(0, state.maximum - state.total);
  const mixAmount = Math.min(remaining, weight);
  if (!(mixAmount > 0)) return;
  material.color.lerp(target, mixAmount);
  state.total += mixAmount;
}

function materialProfileContext(material, context) {
  const profile = inferWorldAssetSurfaceProfile({ material });
  const ecologyShape = {
    response: {
      moisture: context.ecology.moisture,
      aridity: context.ecology.aridity,
      exposure: context.ecology.exposure,
      shelter: context.ecology.shelter,
      erosion: context.ecology.erosion,
      deposition: context.ecology.deposition,
      frost: context.ecology.frost,
    },
    domains: {
      coastal: context.ecology.coastal,
      woodland: context.ecology.woodland,
      wetMeadow: context.ecology.wetMeadow,
      dryHeath: context.ecology.dryHeath,
      bareRock: context.ecology.bareRock,
    },
    material: {
      albedoMacro: context.ecology.albedoMacro,
      albedoMeso: context.ecology.albedoMeso,
      albedoFine: context.ecology.albedoFine,
      roughnessMacro: context.ecology.roughnessMacro,
      roughnessFine: context.ecology.roughnessFine,
      normalMacro: context.ecology.normalMacro,
      normalFine: context.ecology.normalFine,
      weathering: context.ecology.weathering,
      lichen: context.ecology.lichen,
      moss: context.ecology.moss,
    },
  };
  const response = deriveWorldAssetSurfaceResponse(profile, ecologyShape);
  return Object.freeze({ profile, response });
}

function applyContextToMaterial(material, context) {
  if (!material?.isMaterial) return false;
  const { profile, response } = materialProfileContext(material, context);
  const influence = colorInfluenceForFamily(profile.family);
  const tintState = {
    total: 0,
    maximum: WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.maximumColorMix * influence,
  };
  const baseColor = material.color?.clone?.() ?? null;

  if (material.color) {
    const environment = response.environment;
    applyTint(material, COLOR_CONTEXTS.damp, environment.dampness * 0.046, tintState);
    applyTint(
      material,
      COLOR_CONTEXTS.foundationDamp,
      context.foundationDamp * (profile.family === 'rock' || profile.family === 'wood' || profile.family === 'masonry' ? 0.038 : 0.014),
      tintState,
    );
    applyTint(material, COLOR_CONTEXTS.dry, environment.dryness * 0.038, tintState);
    applyTint(material, COLOR_CONTEXTS.oxidised, environment.oxidation * 0.070, tintState);
    applyTint(material, COLOR_CONTEXTS.lichen, environment.lichen * 0.055, tintState);
    applyTint(material, COLOR_CONTEXTS.moss, environment.moss * 0.060, tintState);
    applyTint(material, COLOR_CONTEXTS.salt, environment.salt * 0.055, tintState);
    applyTint(material, COLOR_CONTEXTS.roadDust, context.roadDust * 0.026, tintState);
    applyTint(material, COLOR_CONTEXTS.settlementWear, context.settlementWear * 0.022, tintState);
    applyTint(material, COLOR_CONTEXTS.forest, context.ecology.woodland * 0.024, tintState);
    applyTint(material, COLOR_CONTEXTS.marsh, context.marsh * 0.030, tintState);
    applyTint(material, COLOR_CONTEXTS.cold, context.cold * 0.025, tintState);
    applyTint(material, COLOR_CONTEXTS.snow, context.snow * 0.038, tintState);
    applyTint(material, COLOR_CONTEXTS.alpine, context.ecology.alpine * 0.024, tintState);
    applyTint(material, COLOR_CONTEXTS.coast, context.ecology.coastal * 0.025, tintState);
    if (profile.family === 'rock' || profile.family === 'soil') {
      applyTint(material, COLOR_CONTEXTS.mineral, context.ecology.lithic * 0.028, tintState);
    }

    const scalar = response.albedoScalar;
    material.color.multiplyScalar(scalar);
  }

  let roughnessDelta = response.roughness - finite(material.roughness, response.roughness);
  roughnessDelta += context.footprintStress * (profile.family === 'rock' ? 0.016 : 0.006);
  roughnessDelta += context.roadDust * (profile.family === 'soil' ? 0.015 : 0.007);
  roughnessDelta -= context.foundationDamp * (profile.family === 'rock' || profile.family === 'wood' ? 0.020 : 0.008);
  roughnessDelta = THREE.MathUtils.clamp(
    roughnessDelta,
    -WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.maximumRoughnessDelta,
    WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.maximumRoughnessDelta,
  );
  if (Number.isFinite(material.roughness)) {
    material.roughness = THREE.MathUtils.clamp(material.roughness + roughnessDelta, 0.20, 1);
  }

  let metalnessReduction = 0;
  if (Number.isFinite(material.metalness) && material.metalness > 0) {
    metalnessReduction = Math.min(
      WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.maximumMetalnessReduction,
      response.environment.oxidation * 0.040
        + response.environment.salt * 0.022
        + context.foundationDamp * 0.010,
    );
    material.metalness = Math.max(0, material.metalness - metalnessReduction);
  }

  material.userData ||= {};
  material.userData.worldAssetSurfaceProfileId = profile.id;
  material.userData.worldAssetSurfaceResponse = Object.freeze({
    revision: WORLD_ASSET_SURFACE_PROFILES_REVISION,
    profileId: response.profileId,
    family: response.family,
    scales: response.scales,
    normalStrength: response.normalStrength,
    environment: response.environment,
    fabric: response.fabric,
  });
  material.userData.worldPlacementMaterialContext = Object.freeze({
    policyId: WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.id,
    revision: WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.revision,
    profile: profile.family,
    assetProfileId: profile.id,
    moisture: context.moisture,
    slope: context.slope,
    wet: context.wet,
    dry: context.dry,
    cold: context.cold,
    snow: context.snow,
    exposure: context.ecology.exposure,
    coast: context.ecology.coastal,
    shelter: context.ecology.shelter,
    aridity: context.ecology.aridity,
    deposition: context.ecology.deposition,
    erosion: context.ecology.erosion,
    lithic: context.ecology.lithic,
    soilDepth: context.ecology.soilDepth,
    frost: context.ecology.frost,
    wetMeadow: context.ecology.wetMeadow,
    dryHeath: context.ecology.dryHeath,
    woodland: context.ecology.woodland,
    scrub: context.ecology.scrub,
    bareRock: context.ecology.bareRock,
    talus: context.ecology.talus,
    riparian: context.ecology.riparian,
    weathering: context.ecology.weathering,
    lichen: context.ecology.lichen,
    moss: context.ecology.moss,
    albedoMacro: context.ecology.albedoMacro,
    albedoMeso: context.ecology.albedoMeso,
    albedoFine: context.ecology.albedoFine,
    roughnessMacro: context.ecology.roughnessMacro,
    roughnessFine: context.ecology.roughnessFine,
    normalMacro: context.ecology.normalMacro,
    normalFine: context.ecology.normalFine,
    sedimentFabric: context.ecology.sedimentFabric,
    sedimentAngle: context.ecology.sedimentAngle,
    roadDust: context.roadDust,
    settlementWear: context.settlementWear,
    foundationDamp: context.foundationDamp,
    footprintStress: context.footprintStress,
    footprintRelief: context.footprintRelief,
    sampleCount: context.sampleCount ?? 1,
    colorMix: tintState.total,
    albedoScalar: response.albedoScalar,
    roughnessDelta,
    metalnessReduction,
    sourceColorHex: baseColor ? baseColor.getHex() : null,
    surfaceScales: response.scales,
    fabric: response.fabric,
  });
  material.needsUpdate = true;
  return true;
}

export function applyWorldPlacementMaterialContext(root, surface, footprint = null) {
  if (!root?.traverse || !surface) {
    return Object.freeze({
      policyId: WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.id,
      revision: WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.revision,
      appliedMaterialCount: 0,
      surfaceContextAvailable: false,
    });
  }

  const context = aggregatePlacementContext(surface, footprint);
  let appliedMaterialCount = 0;
  const profileCounts = {};
  const assetProfileCounts = {};

  root.traverse((node) => {
    if (!node?.isMesh && !node?.isInstancedMesh) return;
    const materials = Array.isArray(node.material)
      ? node.material
      : node.material
        ? [node.material]
        : [];
    for (const material of materials) {
      if (!applyContextToMaterial(material, context)) continue;
      const profileId = material.userData.worldPlacementMaterialContext.profile;
      const assetProfileId = material.userData.worldPlacementMaterialContext.assetProfileId;
      profileCounts[profileId] = (profileCounts[profileId] ?? 0) + 1;
      assetProfileCounts[assetProfileId] = (assetProfileCounts[assetProfileId] ?? 0) + 1;
      appliedMaterialCount += 1;
    }
  });

  const summary = Object.freeze({
    policyId: WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.id,
    revision: WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.revision,
    surfaceProfileRevision: WORLD_ASSET_SURFACE_PROFILES_REVISION,
    appliedMaterialCount,
    profileCounts: Object.freeze({ ...profileCounts }),
    assetProfileCounts: Object.freeze({ ...assetProfileCounts }),
    surfaceContextAvailable: true,
    footprintSurfaceAggregation: true,
    contextSampleCount: context.sampleCount ?? 1,
    moisture: context.moisture,
    slope: context.slope,
    wet: context.wet,
    dry: context.dry,
    cold: context.cold,
    snow: context.snow,
    exposure: context.ecology.exposure,
    coast: context.ecology.coastal,
    roadDust: context.roadDust,
    settlementWear: context.settlementWear,
    foundationDamp: context.foundationDamp,
    footprintStress: context.footprintStress,
    footprintRelief: context.footprintRelief,
    ecology: context.ecology,
    centerEcologySummary: context.centerEcologySummary,
  });

  root.userData ||= {};
  root.userData.worldPlacementMaterialContext = summary;
  return summary;
}
