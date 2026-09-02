import * as THREE from 'three';

/**
 * Small, bounded placement-context adapter for already-generated world materials.
 *
 * It consumes only surface facts supplied by the canonical placement query and the canonical
 * footprint samples that already approved grounding. No latitude rules, fabricated biome masks or
 * alternate terrain authority live here. Texture objects and UV transforms remain untouched;
 * colour/roughness response is adjusted once after final placement and then consumed by the shared
 * world-space material fabric.
 */
export const WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY = Object.freeze({
  id: 'world-placement-material-context-2026-09-02-v2-footprint-weathering',
  renderOnly: true,
  canonicalSurfaceContextOnly: true,
  footprintSurfaceAggregation: true,
  canonicalFootprintSamplesOnly: true,
  sourceTexturesPreserved: true,
  sourceUvTransformsPreserved: true,
  geometryUnchanged: true,
  placementUnchanged: true,
  maximumColorMix: 0.12,
  maximumRoughnessDelta: 0.09,
  maximumMetalnessReduction: 0.06,
  footprintReliefNormalizationMeters: 9,
  roadDustNearMeters: 9,
  settlementWearNearMeters: 24,
  shallowWaterWetnessMeters: 1.25,
  foundationDampResponse: true,
  exposedFootprintWeathering: true,
  roadDustResponse: true,
  settlementWearResponse: true,
});

const COLOR_CONTEXTS = Object.freeze({
  damp: new THREE.Color(0x6f7669),
  dry: new THREE.Color(0xb19a70),
  cold: new THREE.Color(0xaab5b6),
  snow: new THREE.Color(0xc8d0cf),
  forest: new THREE.Color(0x728064),
  marsh: new THREE.Color(0x66766b),
  alpine: new THREE.Color(0x929795),
  coast: new THREE.Color(0x88918b),
  mineral: new THREE.Color(0x918575),
  roadDust: new THREE.Color(0x9b896a),
  foundationDamp: new THREE.Color(0x626a61),
  settlementWear: new THREE.Color(0x8b806e),
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
  return {
    forest: /forest|wood|grove|taiga/.test(id) ? 1 : 0,
    marsh: /marsh|swamp|bog|wetland|fen/.test(id) ? 1 : 0,
    snow: /snow|ice|glacier|permanent-ice/.test(id) ? 1 : 0,
    cold: /tundra|cold|subalpine/.test(id) ? 1 : 0,
    alpine: /alpine|bare|mountain|ridge|cliff/.test(id) ? 1 : 0,
    coast: /coast|shore|beach|intertidal/.test(id) ? 1 : 0,
    dry: /desert|arid|heath|steppe|dry/.test(id) ? 1 : 0,
  };
}

function surfaceContext(surface = {}) {
  const moisture = Number.isFinite(surface.moisture) ? clamp01(surface.moisture) : 0.50;
  const slope = Number.isFinite(surface.slopeDegrees) ? clamp01(surface.slopeDegrees / 60) : 0;
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
  const settlementWear = nearWeight(settlementDistance, WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.settlementWearNearMeters)
    * (0.52 + dry * 0.18 + exposure * 0.12);
  return Object.freeze({
    moisture, slope, wet, dry, cold, snow, exposure, coast,
    roadDust: clamp01(roadDust), settlementWear: clamp01(settlementWear), shallowWater,
    ...biome,
  });
}

function aggregatePlacementContext(surface, footprint) {
  const samples = [surface, ...(footprint?.samples ?? []), ...(footprint?.islandSamples ?? [])].filter(Boolean);
  const contexts = samples.map(surfaceContext);
  const fields = [
    'moisture', 'slope', 'wet', 'dry', 'cold', 'snow', 'exposure', 'coast',
    'forest', 'marsh', 'alpine', 'roadDust', 'settlementWear', 'shallowWater',
  ];
  const aggregate = {};
  for (const field of fields) {
    const values = contexts.map((context) => context[field]).filter(Number.isFinite).sort((a, b) => a - b);
    if (!values.length) {
      aggregate[field] = 0;
      continue;
    }
    const median = values[Math.floor(values.length * 0.5)];
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    // Median resists one anomalous footprint probe while the mean keeps broad transitions smooth.
    aggregate[field] = clamp01(median * 0.62 + mean * 0.38);
  }

  const count = Math.max(1, contexts.length);
  // Preserve real wet/cold/proximity edges only when several footprint probes enter them; one
  // isolated corner cannot recolour an entire keep or tree asset.
  aggregate.wet = Math.max(aggregate.wet, contexts.filter((context) => context.wet > 0.62).length / count * 0.72);
  aggregate.snow = Math.max(aggregate.snow, contexts.filter((context) => context.snow > 0.5).length / count * 0.80);
  aggregate.coast = Math.max(aggregate.coast, contexts.filter((context) => context.coast > 0.45).length / count * 0.64);
  aggregate.roadDust = Math.max(aggregate.roadDust, contexts.filter((context) => context.roadDust > 0.52).length / count * 0.60);
  aggregate.settlementWear = Math.max(aggregate.settlementWear, contexts.filter((context) => context.settlementWear > 0.48).length / count * 0.56);

  const footprintRelief = clamp01(
    Math.max(0, finite(footprint?.heightRange, 0))
    / WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.footprintReliefNormalizationMeters,
  );
  const footprintStress = clamp01(footprintRelief * 0.72 + aggregate.exposure * 0.28);
  const foundationDamp = clamp01(
    aggregate.wet * 0.48
    + contexts.filter((context) => context.wet > 0.60).length / count * 0.20
    + aggregate.shallowWater * 0.18
    + (footprint?.groundingMode === 'embedded-low-side' ? 0.08 : 0.03));
  return Object.freeze({
    ...aggregate,
    footprintRelief,
    footprintStress,
    foundationDamp,
    sampleCount: contexts.length,
  });
}

function materialProfile(material) {
  const explicit = material?.userData?.worldMaterialSurfaceFabric?.profileId;
  if (explicit) return explicit;
  const signature = `${material?.name || ''}|${material?.userData?.paletteId || ''}`.toLowerCase();
  if (/metal|iron|steel|bronze|copper/.test(signature)) return 'metal';
  if (/wood|timber|bark|plank/.test(signature)) return 'wood';
  if (/stone|rock|brick|masonry/.test(signature)) return 'stone';
  if (/soil|earth|dirt|mud|sand/.test(signature)) return 'soil';
  if (/leaf|foliage|grass|plant/.test(signature)) return 'vegetation';
  if (/snow|ice|frost/.test(signature)) return 'snow';
  return 'generic';
}

function colorInfluenceForProfile(profile) {
  if (profile === 'metal') return 0.55;
  if (profile === 'snow') return 0.48;
  if (profile === 'cloth') return 0.58;
  if (profile === 'vegetation') return 0.74;
  return 1;
}

function applyContextToMaterial(material, context) {
  if (!material?.isMaterial) return false;
  const profile = materialProfile(material);
  const colorInfluence = colorInfluenceForProfile(profile);
  const maxMix = WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.maximumColorMix * colorInfluence;
  const baseColor = material.color?.clone?.() ?? null;
  let totalMix = 0;

  if (material.color) {
    const applyTint = (target, weight) => {
      const mixAmount = Math.min(maxMix - totalMix, Math.max(0, weight));
      if (!(mixAmount > 0)) return;
      material.color.lerp(target, mixAmount);
      totalMix += mixAmount;
    };
    applyTint(COLOR_CONTEXTS.damp, context.wet * 0.060);
    applyTint(COLOR_CONTEXTS.foundationDamp, context.foundationDamp * (profile === 'stone' || profile === 'wood' ? 0.040 : 0.018));
    applyTint(COLOR_CONTEXTS.dry, context.dry * 0.055);
    applyTint(COLOR_CONTEXTS.roadDust, context.roadDust * (profile === 'stone' || profile === 'wood' || profile === 'soil' ? 0.038 : 0.018));
    applyTint(COLOR_CONTEXTS.settlementWear, context.settlementWear * (profile === 'stone' || profile === 'wood' || profile === 'plaster' ? 0.028 : 0.012));
    applyTint(COLOR_CONTEXTS.forest, context.forest * context.moisture * 0.040);
    applyTint(COLOR_CONTEXTS.marsh, context.marsh * 0.052);
    applyTint(COLOR_CONTEXTS.cold, context.cold * 0.046);
    applyTint(COLOR_CONTEXTS.snow, context.snow * 0.064);
    applyTint(COLOR_CONTEXTS.alpine, context.exposure * 0.034);
    applyTint(COLOR_CONTEXTS.coast, context.coast * 0.034);
    if ((profile === 'stone' || profile === 'soil') && context.exposure > 0.45) {
      applyTint(COLOR_CONTEXTS.mineral, context.exposure * 0.030);
    }
  }

  let roughnessDelta = 0;
  roughnessDelta += context.dry * 0.043;
  roughnessDelta += context.snow * 0.032;
  roughnessDelta += context.exposure * 0.016;
  roughnessDelta += context.footprintStress * (profile === 'stone' ? 0.018 : 0.009);
  roughnessDelta += context.roadDust * 0.012;
  roughnessDelta -= context.wet * (profile === 'metal' ? 0.055 : 0.047);
  roughnessDelta -= context.foundationDamp * (profile === 'stone' || profile === 'wood' ? 0.024 : 0.010);
  roughnessDelta -= context.coast * 0.018;
  roughnessDelta = THREE.MathUtils.clamp(
    roughnessDelta,
    -WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.maximumRoughnessDelta,
    WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.maximumRoughnessDelta,
  );
  if (Number.isFinite(material.roughness)) {
    material.roughness = THREE.MathUtils.clamp(material.roughness + roughnessDelta, 0.22, 1);
  }

  let metalnessReduction = 0;
  if (Number.isFinite(material.metalness) && material.metalness > 0) {
    metalnessReduction = Math.min(
      WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.maximumMetalnessReduction,
      context.wet * 0.023 + context.coast * 0.016 + context.foundationDamp * 0.010,
    );
    material.metalness = Math.max(0, material.metalness - metalnessReduction);
  }

  material.userData ||= {};
  material.userData.worldPlacementMaterialContext = Object.freeze({
    policyId: WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.id,
    profile,
    moisture: context.moisture,
    slope: context.slope,
    wet: context.wet,
    dry: context.dry,
    cold: context.cold,
    snow: context.snow,
    exposure: context.exposure,
    coast: context.coast,
    roadDust: context.roadDust,
    settlementWear: context.settlementWear,
    foundationDamp: context.foundationDamp,
    footprintStress: context.footprintStress,
    footprintRelief: context.footprintRelief,
    sampleCount: context.sampleCount ?? 1,
    colorMix: totalMix,
    roughnessDelta,
    metalnessReduction,
    sourceColorHex: baseColor ? baseColor.getHex() : null,
  });
  material.needsUpdate = true;
  return true;
}

export function applyWorldPlacementMaterialContext(root, surface, footprint = null) {
  if (!root?.traverse || !surface) {
    return Object.freeze({
      policyId: WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.id,
      appliedMaterialCount: 0,
      surfaceContextAvailable: false,
    });
  }

  const context = aggregatePlacementContext(surface, footprint);
  let appliedMaterialCount = 0;
  const profileCounts = {};
  root.traverse((node) => {
    if (!node?.isMesh && !node?.isInstancedMesh) return;
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of materials) {
      if (!applyContextToMaterial(material, context)) continue;
      const profile = material.userData.worldPlacementMaterialContext.profile;
      profileCounts[profile] = (profileCounts[profile] ?? 0) + 1;
      appliedMaterialCount += 1;
    }
  });

  const summary = Object.freeze({
    policyId: WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.id,
    appliedMaterialCount,
    profileCounts: Object.freeze({ ...profileCounts }),
    surfaceContextAvailable: true,
    footprintSurfaceAggregation: true,
    contextSampleCount: context.sampleCount ?? 1,
    moisture: context.moisture,
    slope: context.slope,
    wet: context.wet,
    dry: context.dry,
    cold: context.cold,
    snow: context.snow,
    exposure: context.exposure,
    coast: context.coast,
    roadDust: context.roadDust,
    settlementWear: context.settlementWear,
    foundationDamp: context.foundationDamp,
    footprintStress: context.footprintStress,
    footprintRelief: context.footprintRelief,
    footprintGroundingMode: footprint?.groundingMode ?? null,
    sourceTexturesPreserved: true,
    sourceUvTransformsPreserved: true,
  });
  root.userData ||= {};
  root.userData.worldPlacementMaterialContext = summary;
  return summary;
}
