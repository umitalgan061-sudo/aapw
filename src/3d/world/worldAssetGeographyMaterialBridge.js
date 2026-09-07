/**
 * Geography/material bridge for world assets.
 *
 * The existing material pipeline remains the authority for authored maps, UVs, normal maps and base
 * material setup. This adapter only creates a render variant whose scalar/color response follows the
 * already-derived geography and transition fields. No image texture is replaced and no UV transform is
 * rewritten. The result can therefore make the same authored stone, wood, plaster or foliage model read
 * differently on a damp riverbank, salt-exposed coast, dusty road edge, frost pocket or dry heath.
 *
 * @module world/worldAssetGeographyMaterialBridge
 */

import {
  sampleWorldAssetGeographyProfile,
  validateAssetGeographyProfile,
} from './worldAssetGeographyProfile.js';
import {
  sampleWorldAssetTransitionField,
} from './worldAssetTransitionField.js';
import {
  WORLD_ASSET_REGIONAL_ANCHOR_POLICY,
  WORLD_ASSET_REGIONAL_ANCHORS,
  regionalAnchorInfluences,
} from './worldAssetRegionalAnchors.js';

export const WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY = Object.freeze({
  id: 'world-asset-geography-material-bridge-2026-09-07-v1',
  renderOnly: true,
  deterministic: true,
  sourceMapsPreserved: true,
  sourceUvsPreserved: true,
  geometryPreserved: true,
  canonicalTerrainReadOnly: true,
  canonicalHydrologyReadOnly: true,
  maximumColorMix: 0.10,
  maximumRoughnessDelta: 0.10,
  maximumMetalnessDelta: 0.055,
  maximumNormalScaleDelta: 0.18,
  maximumOpacityDelta: 0.03,
  maximumRegionalPaletteShift: 0.08,
});

const FAMILY_MATERIALS = Object.freeze({
  stone: Object.freeze({
    names: ['stone', 'rock', 'masonry', 'wall', 'cliff', 'outcrop'],
    dampColor: [0.58, 0.62, 0.59],
    dryColor: [0.69, 0.60, 0.47],
    saltColor: [0.78, 0.77, 0.69],
    frostColor: [0.72, 0.77, 0.78],
    mossColor: [0.38, 0.48, 0.35],
    roughnessRange: [0.58, 0.92],
    metalness: [0, 0.02],
  }),
  wood: Object.freeze({
    names: ['wood', 'timber', 'trunk', 'beam', 'plank', 'log'],
    dampColor: [0.35, 0.32, 0.27],
    dryColor: [0.61, 0.46, 0.29],
    saltColor: [0.64, 0.62, 0.53],
    frostColor: [0.61, 0.67, 0.67],
    mossColor: [0.34, 0.44, 0.30],
    roughnessRange: [0.48, 0.88],
    metalness: [0, 0.02],
  }),
  plaster: Object.freeze({
    names: ['plaster', 'stucco', 'render', 'adobe', 'clay'],
    dampColor: [0.60, 0.61, 0.55],
    dryColor: [0.76, 0.66, 0.50],
    saltColor: [0.83, 0.81, 0.70],
    frostColor: [0.76, 0.79, 0.78],
    mossColor: [0.46, 0.51, 0.40],
    roughnessRange: [0.54, 0.91],
    metalness: [0, 0],
  }),
  metal: Object.freeze({
    names: ['metal', 'iron', 'steel', 'bronze', 'armour', 'roof-metal'],
    dampColor: [0.50, 0.53, 0.52],
    dryColor: [0.61, 0.57, 0.49],
    saltColor: [0.72, 0.70, 0.63],
    frostColor: [0.69, 0.74, 0.75],
    mossColor: [0.42, 0.48, 0.39],
    roughnessRange: [0.28, 0.82],
    metalness: [0.20, 0.95],
  }),
  foliage: Object.freeze({
    names: ['leaf', 'foliage', 'grass', 'needle', 'canopy', 'bush', 'shrub'],
    dampColor: [0.34, 0.42, 0.30],
    dryColor: [0.58, 0.51, 0.29],
    saltColor: [0.57, 0.58, 0.50],
    frostColor: [0.67, 0.72, 0.70],
    mossColor: [0.33, 0.46, 0.27],
    roughnessRange: [0.64, 0.96],
    metalness: [0, 0],
  }),
  roof: Object.freeze({
    names: ['roof', 'thatch', 'shingle', 'slate', 'tile'],
    dampColor: [0.48, 0.47, 0.40],
    dryColor: [0.65, 0.52, 0.32],
    saltColor: [0.67, 0.64, 0.56],
    frostColor: [0.66, 0.71, 0.71],
    mossColor: [0.38, 0.46, 0.33],
    roughnessRange: [0.52, 0.92],
    metalness: [0, 0.08],
  }),
  generic: Object.freeze({
    names: [],
    dampColor: [0.55, 0.57, 0.54],
    dryColor: [0.66, 0.58, 0.45],
    saltColor: [0.72, 0.70, 0.63],
    frostColor: [0.70, 0.75, 0.75],
    mossColor: [0.40, 0.49, 0.36],
    roughnessRange: [0.36, 0.90],
    metalness: [0, 0.2],
  }),
});

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value, 0)));
const clampSigned = (value) => Math.max(-1, Math.min(1, finite(value, 0)));
const lerp = (a, b, t) => a + (b - a) * t;

function smooth(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function materialFamilyFromName(name = '') {
  const id = String(name).trim().toLowerCase();
  for (const [family, descriptor] of Object.entries(FAMILY_MATERIALS)) {
    if (descriptor.names.some((token) => id.includes(token))) return family;
  }
  return 'generic';
}

function normalizedRegionalPalette(surface = {}) {
  const x = surface.normalizedX;
  const y = surface.normalizedY ?? surface.normalizedZ;
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) {
    return Object.freeze({ enabled: false, weight: 0, grassHueBias: 0, rockCoolBias: 0, snowValueBias: 0, woodWeatheringBias: 0 });
  }
  const influences = regionalAnchorInfluences(clamp01(x), clamp01(y));
  let total = 0;
  const palette = { grassHueBias: 0, rockCoolBias: 0, snowValueBias: 0, woodWeatheringBias: 0 };
  for (const [id, weight] of Object.entries(influences)) {
    if (!(weight > 0)) continue;
    const source = WORLD_ASSET_REGIONAL_ANCHORS[id]?.palette;
    if (!source) continue;
    total += weight;
    for (const key of Object.keys(palette)) palette[key] += finite(source[key], 0) * weight;
  }
  if (!(total > 0)) return Object.freeze({ enabled: false, weight: 0, ...palette });
  for (const key of Object.keys(palette)) palette[key] /= total;
  return Object.freeze({ enabled: true, weight: Math.min(1, total), ...palette });
}

function normalizeProfile(surface, metadata = {}) {
  const profile = sampleWorldAssetGeographyProfile(surface, metadata);
  const validation = validateAssetGeographyProfile(profile);
  return { profile, validation };
}

function scalarResponse(surface, family) {
  const transition = sampleWorldAssetTransitionField(surface);
  const moisture = clamp01(surface.moisture ?? 0.5);
  const slope = clamp01(finite(surface.slopeDegrees, 0) / 60);
  const snow = clamp01(surface.snow);
  const exposure = clamp01(surface.exposure ?? (slope * 0.65 + (1 - finite(surface.shelter, 0.5)) * 0.35));
  const coast = transition.coast.total;
  const river = Math.max(transition.river.total, transition.lake.total);
  const road = transition.road.total;
  const settlement = transition.settlement.total;
  const wet = clamp01(transition.wetland * 0.46 + moisture * 0.34 + river * 0.20);
  const dry = clamp01(transition.dryness * 0.56 + (1 - moisture) * 0.34 + (1 - coast) * 0.10);
  const frost = clamp01(transition.frost * 0.58 + snow * 0.34 + (1 - finite(surface.shelter, 0.5)) * 0.08);
  const weathering = clamp01(transition.material.weathering * 0.56 + exposure * 0.22 + finite(surface.erosion, 0.5) * 0.22);
  const familyMultiplier = {
    stone: 1.02,
    wood: 1.00,
    plaster: 0.94,
    metal: 0.92,
    foliage: 0.88,
    roof: 0.96,
    generic: 0.90,
  }[family] ?? 0.90;
  return Object.freeze({
    transition,
    moisture,
    dry,
    wet,
    frost,
    exposure,
    weathering,
    coast,
    river,
    road,
    settlement,
    snow,
    familyMultiplier,
  });
}

function responseWeights(state) {
  const damp = clamp01(state.wet * 0.80 + state.river * 0.18 + state.coast * 0.02);
  const dry = clamp01(state.dry * 0.86 + (1 - state.wet) * 0.14);
  const salt = clamp01(state.coast * 0.82 + state.transition.material.salt * 0.18);
  const frost = clamp01(state.frost * 0.84 + state.snow * 0.16);
  const dust = clamp01(state.road * 0.72 + state.dry * 0.18 + state.settlement * 0.10);
  const moss = clamp01(state.wet * 0.58 + state.transition.wetland * 0.20 + (1 - state.exposure) * 0.22);
  return Object.freeze({ damp, dry, salt, frost, dust, moss });
}

function colorTarget(descriptor, weights) {
  const result = descriptor.dampColor.map((value, index) => {
    let color = value;
    color = lerp(color, descriptor.dryColor[index], weights.dry * 0.42);
    color = lerp(color, descriptor.saltColor[index], weights.salt * 0.24);
    color = lerp(color, descriptor.frostColor[index], weights.frost * 0.20);
    color = lerp(color, descriptor.mossColor[index], weights.moss * 0.18);
    return clamp01(color);
  });
  return result;
}

function roughnessTarget(descriptor, weights, state) {
  const [minimum, maximum] = descriptor.roughnessRange;
  const materialWear = clamp01(
    weights.damp * 0.20
      + weights.salt * 0.12
      + state.weathering * 0.38
      + weights.dust * 0.18
      + weights.frost * 0.12,
  );
  return clamp01(lerp(minimum, maximum, materialWear));
}

function metalnessTarget(descriptor, state, weights) {
  const [minimum, maximum] = descriptor.metalness;
  const oxidation = clamp01(weights.damp * 0.28 + weights.salt * 0.24 + state.weathering * 0.18);
  return clamp01(lerp(maximum, minimum, oxidation));
}

function normalTarget(state, weights) {
  return clamp01(
    0.78
      + state.weathering * 0.12
      + weights.frost * 0.06
      + weights.salt * 0.04,
  );
}

function regionalFamilyBias(family, regional) {
  if (!regional?.enabled) return 0;
  const grass = finite(regional.grassHueBias, 0);
  const rock = finite(regional.rockCoolBias, 0);
  const wood = finite(regional.woodWeatheringBias, 0);
  const snow = finite(regional.snowValueBias, 0);
  if (family === 'foliage') return grass;
  if (family === 'stone') return rock;
  if (family === 'wood') return wood;
  if (family === 'roof') return wood * 0.6;
  if (family === 'generic') return snow * 0.2;
  return 0;
}

export function sampleWorldAssetGeographyMaterialResponse({
  surface = {},
  metadata = {},
  materialName = '',
} = {}) {
  const family = materialFamilyFromName(materialName || metadata.materialFamily || metadata.materialName || '');
  const { profile, validation } = normalizeProfile(surface, metadata);
  const state = scalarResponse(surface, family);
  const weights = responseWeights(state);
  const regional = normalizedRegionalPalette(surface);
  const descriptor = FAMILY_MATERIALS[family] ?? FAMILY_MATERIALS.generic;
  const color = colorTarget(descriptor, weights);
  const familyBias = regionalFamilyBias(family, regional);
  const roughness = roughnessTarget(descriptor, weights, state);
  const metalness = metalnessTarget(descriptor, state, weights);
  const normalScale = normalTarget(state, weights);
  const tintStrength = Math.min(
    WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY.maximumColorMix,
    (weights.damp * 0.032 + weights.dry * 0.022 + weights.salt * 0.026 + weights.frost * 0.020 + weights.moss * 0.014)
      * state.familyMultiplier,
  );
  return Object.freeze({
    policyId: WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY.id,
    family,
    profile,
    validation,
    transition: state.transition,
    weights,
    regional,
    base: Object.freeze({
      roughness,
      metalness,
      normalScale,
    }),
    response: Object.freeze({
      color: Object.freeze(color),
      colorMix: tintStrength,
      roughnessDelta: clampSigned((roughness - descriptor.roughnessRange[0]) * 0.12),
      metalnessDelta: clampSigned(metalness - descriptor.metalness[1]),
      normalScaleDelta: clampSigned(normalScale - 0.78),
      regionalFamilyBias: clampSigned(familyBias) * WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY.maximumRegionalPaletteShift,
      opacityDelta: clampSigned((weights.damp * 0.012 - weights.frost * 0.006) * state.familyMultiplier),
    }),
  });
}

function applyColor(material, response) {
  if (!material?.color?.setRGB) return false;
  const target = response.response.color;
  const mix = clamp01(response.response.colorMix);
  const regionalBias = response.response.regionalFamilyBias;
  const r = clamp01(target[0] + regionalBias);
  const g = clamp01(target[1] + regionalBias * 0.45);
  const b = clamp01(target[2] - regionalBias * 0.22);
  material.color.lerp({ r, g, b }, mix);
  return true;
}

function applyRoughness(material, response) {
  if (!Number.isFinite(Number(material?.roughness))) return false;
  material.roughness = clamp01(
    finite(material.roughness) + Math.max(-WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY.maximumRoughnessDelta,
      Math.min(WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY.maximumRoughnessDelta, response.response.roughnessDelta)),
  );
  return true;
}

function applyMetalness(material, response) {
  if (!Number.isFinite(Number(material?.metalness))) return false;
  material.metalness = clamp01(
    finite(material.metalness) + Math.max(-WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY.maximumMetalnessDelta,
      Math.min(WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY.maximumMetalnessDelta, response.response.metalnessDelta)),
  );
  return true;
}

function applyNormalScale(material, response) {
  if (!material?.normalScale?.set) return false;
  const delta = Math.max(-WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY.maximumNormalScaleDelta,
    Math.min(WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY.maximumNormalScaleDelta, response.response.normalScaleDelta));
  const x = finite(material.normalScale.x, 1);
  const y = finite(material.normalScale.y, 1);
  material.normalScale.set(x + delta, y + delta);
  return true;
}

function applyOpacity(material, response) {
  if (!Number.isFinite(Number(material?.opacity))) return false;
  const delta = Math.max(-WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY.maximumOpacityDelta,
    Math.min(WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY.maximumOpacityDelta, response.response.opacityDelta));
  material.opacity = clamp01(material.opacity + delta);
  return true;
}

export function createWorldAssetGeographyMaterialVariant(material, {
  surface = {},
  metadata = {},
  materialName = material?.name ?? metadata.materialName ?? '',
  cloneMaterial = true,
} = {}) {
  if (!material) return { ok: false, error: 'missing-material' };
  const response = sampleWorldAssetGeographyMaterialResponse({ surface, metadata, materialName });
  const target = cloneMaterial && typeof material.clone === 'function' ? material.clone() : material;
  if (!target) return { ok: false, error: 'material-clone-failed', response };
  const applied = {
    color: applyColor(target, response),
    roughness: applyRoughness(target, response),
    metalness: applyMetalness(target, response),
    normalScale: applyNormalScale(target, response),
    opacity: applyOpacity(target, response),
  };
  if ('needsUpdate' in target) target.needsUpdate = true;
  return {
    ok: true,
    material: target,
    response,
    applied: Object.freeze(applied),
    preserved: Object.freeze({
      map: target.map === material.map,
      normalMap: target.normalMap === material.normalMap,
      roughnessMap: target.roughnessMap === material.roughnessMap,
      metalnessMap: target.metalnessMap === material.metalnessMap,
      aoMap: target.aoMap === material.aoMap,
      emissiveMap: target.emissiveMap === material.emissiveMap,
      sourceUvsUntouched: true,
    }),
  };
}

export function materialFamilyForWorldAsset(materialOrName) {
  const name = typeof materialOrName === 'string' ? materialOrName : materialOrName?.name;
  return materialFamilyFromName(name);
}

export function worldAssetGeographyMaterialBridgePolicy() {
  return WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY;
}
