import * as THREE from 'three';

/**
 * Small, bounded placement-context adapter for already-generated world materials.
 *
 * It consumes only surface facts supplied by the canonical placement query. No latitude rules,
 * fabricated biome masks or alternate terrain authority live here. Texture objects and UV transforms
 * remain untouched; color/roughness response is adjusted once after the final placement is known.
 */
export const WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY = Object.freeze({
  id: 'world-placement-material-context-2026-09-02-v1',
  renderOnly: true,
  canonicalSurfaceContextOnly: true,
  footprintSurfaceAggregation: true,
  sourceTexturesPreserved: true,
  sourceUvTransformsPreserved: true,
  geometryUnchanged: true,
  placementUnchanged: true,
  maximumColorMix: 0.12,
  maximumRoughnessDelta: 0.09,
  maximumMetalnessReduction: 0.06,
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
});

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

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
  const biome = biomeWeights(surface.biome);
  const wet = clamp01((moisture - 0.48) / 0.42 + biome.marsh * 0.45 + (waterDepth > 0 ? 0.22 : 0));
  const dry = clamp01((0.48 - moisture) / 0.42 + biome.dry * 0.62);
  const cold = clamp01(biome.cold * 0.70 + biome.snow * 0.55);
  const snow = clamp01(biome.snow);
  const exposure = clamp01(slope * 0.62 + biome.alpine * 0.48);
  const coast = clamp01(biome.coast + (waterDepth > 0 && waterDepth < 0.8 ? 0.34 : 0));
  return Object.freeze({ moisture, slope, wet, dry, cold, snow, exposure, coast, ...biome });
}

function aggregatePlacementContext(surface, footprint) {
  const samples = [surface, ...(footprint?.samples ?? []), ...(footprint?.islandSamples ?? [])].filter(Boolean);
  const contexts = samples.map(surfaceContext);
  if (contexts.length <= 1) return contexts[0] ?? surfaceContext(surface);
  const fields = ['moisture', 'slope', 'wet', 'dry', 'cold', 'snow', 'exposure', 'coast', 'forest', 'marsh', 'alpine'];
  const aggregate = {};
  for (const field of fields) {
    const values = contexts.map((context) => context[field]).filter(Number.isFinite);
    if (!values.length) aggregate[field] = 0;
    else {
      values.sort((a, b) => a - b);
      const median = values[Math.floor(values.length * 0.5)];
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      // Median resists one anomalous footprint probe while the mean keeps broad transitions smooth.
      aggregate[field] = clamp01(median * 0.62 + mean * 0.38);
    }
  }
  // Preserve a real wet/cold edge if several corners enter it; one isolated sample cannot recolour an
  // entire keep, but a substantial footprint transition should be visible in material weathering.
  aggregate.wet = Math.max(aggregate.wet, contexts.filter((context) => context.wet > 0.62).length / contexts.length * 0.72);
  aggregate.snow = Math.max(aggregate.snow, contexts.filter((context) => context.snow > 0.5).length / contexts.length * 0.80);
  aggregate.coast = Math.max(aggregate.coast, contexts.filter((context) => context.coast > 0.45).length / contexts.length * 0.64);
  return Object.freeze({ ...aggregate, sampleCount: contexts.length });
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
    applyTint(COLOR_CONTEXTS.damp, context.wet * 0.075);
    applyTint(COLOR_CONTEXTS.dry, context.dry * 0.065);
    applyTint(COLOR_CONTEXTS.forest, context.forest * context.moisture * 0.045);
    applyTint(COLOR_CONTEXTS.marsh, context.marsh * 0.060);
    applyTint(COLOR_CONTEXTS.cold, context.cold * 0.052);
    applyTint(COLOR_CONTEXTS.snow, context.snow * 0.070);
    applyTint(COLOR_CONTEXTS.alpine, context.exposure * 0.040);
    applyTint(COLOR_CONTEXTS.coast, context.coast * 0.040);
    if ((profile === 'stone' || profile === 'soil') && context.exposure > 0.45) {
      applyTint(COLOR_CONTEXTS.mineral, context.exposure * 0.035);
    }
  }

  let roughnessDelta = 0;
  roughnessDelta += context.dry * 0.050;
  roughnessDelta += context.snow * 0.035;
  roughnessDelta += context.exposure * 0.018;
  roughnessDelta -= context.wet * (profile === 'metal' ? 0.060 : 0.052);
  roughnessDelta -= context.coast * 0.020;
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
      context.wet * 0.025 + context.coast * 0.018,
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
    footprintGroundingMode: footprint?.groundingMode ?? null,
    sourceTexturesPreserved: true,
    sourceUvTransformsPreserved: true,
  });
  root.userData ||= {};
  root.userData.worldPlacementMaterialContext = summary;
  return summary;
}
