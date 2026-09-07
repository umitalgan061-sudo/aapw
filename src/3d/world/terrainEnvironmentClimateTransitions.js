/**
 * Climate/biome transition contract for terrain-linked environment materials.
 *
 * The contract is render metadata only. It observes canonical samples and produces deterministic
 * weights for material/asset decisions without modifying terrain height, hydrology or colliders.
 */
const freeze = (value) => Object.freeze(value);
const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
const finiteOr = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const keyOf = (value) => String(value ?? '').trim().toLowerCase();
const smoothstep = (a, b, value) => {
  const span = Math.max(1e-6, b - a);
  const t = clamp01((finiteOr(value) - a) / span);
  return t * t * (3 - 2 * t);
};

export const TERRAIN_ENVIRONMENT_CLIMATE_TRANSITION_POLICY = freeze({
  id: 'terrain-environment-climate-transitions-2026-09-07-v1',
  deterministic: true,
  renderOnly: true,
  canonicalHeightUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalColliderUnchanged: true,
  temperature: freeze({ coldC: -8, coolC: 3, mildC: 13, warmC: 22, hotC: 31 }),
  moisture: freeze({ dry: 0.28, moderate: 0.55, wet: 0.76 }),
  elevation: freeze({ uplandMeters: 180, alpineMeters: 360, snowlineMeters: 430 }),
  wind: freeze({ sheltered: 0.28, exposed: 0.72 }),
  transitionBandMeters: 90,
});

export const CLIMATE_MATERIAL_CHANNELS = freeze({
  forest: freeze({ albedoWet: 0.82, albedoDry: 1.01, roughnessWet: -0.08, roughnessDry: 0.05, mossBias: 0.65 }),
  'forest-edge': freeze({ albedoWet: 0.84, albedoDry: 1.04, roughnessWet: -0.06, roughnessDry: 0.06, mossBias: 0.52 }),
  meadow: freeze({ albedoWet: 0.88, albedoDry: 1.05, roughnessWet: -0.04, roughnessDry: 0.04, mossBias: 0.38 }),
  heath: freeze({ albedoWet: 0.91, albedoDry: 1.08, roughnessWet: -0.02, roughnessDry: 0.07, mossBias: 0.22 }),
  tundra: freeze({ albedoWet: 0.94, albedoDry: 1.02, roughnessWet: -0.06, roughnessDry: 0.03, mossBias: 0.18 }),
  'alpine-bare': freeze({ albedoWet: 0.96, albedoDry: 1.00, roughnessWet: -0.05, roughnessDry: 0.06, mossBias: 0.10 }),
  wetland: freeze({ albedoWet: 0.78, albedoDry: 0.94, roughnessWet: -0.12, roughnessDry: 0.02, mossBias: 0.82 }),
  dryland: freeze({ albedoWet: 0.98, albedoDry: 1.12, roughnessWet: 0.03, roughnessDry: 0.10, mossBias: 0.05 }),
  rock: freeze({ albedoWet: 0.93, albedoDry: 1.05, roughnessWet: -0.06, roughnessDry: 0.04, mossBias: 0.09 }),
});

function thermalWeight(temperatureC) {
  const p = TERRAIN_ENVIRONMENT_CLIMATE_TRANSITION_POLICY.temperature;
  const t = finiteOr(temperatureC, 12);
  return freeze({
    cold: 1 - smoothstep(p.coldC, p.coolC, t),
    cool: smoothstep(p.coldC, p.coolC + 5, t) * (1 - smoothstep(p.mildC - 4, p.mildC + 2, t)),
    mild: smoothstep(p.coolC, p.mildC, t) * (1 - smoothstep(p.warmC - 3, p.warmC + 4, t)),
    warm: smoothstep(p.mildC, p.warmC, t) * (1 - smoothstep(p.hotC - 3, p.hotC + 3, t)),
    hot: smoothstep(p.warmC, p.hotC, t),
    value: t,
  });
}

function moistureWeight(moisture) {
  const p = TERRAIN_ENVIRONMENT_CLIMATE_TRANSITION_POLICY.moisture;
  const m = clamp01(moisture == null ? 0.5 : moisture);
  return freeze({
    dry: 1 - smoothstep(p.moderate, p.wet, m),
    moderate: smoothstep(p.dry, p.wet, m) * (1 - smoothstep(p.wet, 0.96, m) * 0.68),
    wet: smoothstep(p.moderate, 1, m),
    value: m,
  });
}

function elevationWeight(elevationMeters) {
  const p = TERRAIN_ENVIRONMENT_CLIMATE_TRANSITION_POLICY.elevation;
  const e = Math.max(0, finiteOr(elevationMeters));
  return freeze({
    upland: smoothstep(p.uplandMeters - 70, p.uplandMeters + 70, e),
    alpine: smoothstep(p.alpineMeters - 90, p.alpineMeters + 90, e),
    snowline: smoothstep(p.snowlineMeters - 70, p.snowlineMeters + 70, e),
    value: e,
  });
}

function windWeight(windExposure) {
  const value = clamp01(windExposure == null ? 0.5 : windExposure);
  return freeze({ sheltered: 1 - smoothstep(0.22, 0.72, value), exposed: smoothstep(0.32, 0.90, value), value });
}

function slopeWeight(slopeDegrees) {
  const s = clamp01(finiteOr(slopeDegrees) / 65);
  return freeze({ gentle: 1 - smoothstep(0.08, 0.42, s), steep: smoothstep(0.28, 0.78, s), value: s });
}

export function biomeTransitionWeights({ biome = 'meadow', moisture = 0.5, elevationMeters = 0, slopeDegrees = 0, temperatureC = 12 } = {}) {
  const b = keyOf(biome);
  const t = thermalWeight(temperatureC);
  const m = moistureWeight(moisture);
  const e = elevationWeight(elevationMeters);
  const s = slopeWeight(slopeDegrees);
  const isForest = ['forest', 'forest-edge'].includes(b);
  const isMeadow = ['meadow', 'grassland', 'wet-meadow'].includes(b);
  const isHeath = ['heath', 'dry-heath', 'upland-heath'].includes(b);
  const isTundra = ['tundra', 'tundra-edge'].includes(b);
  const isWetland = ['wetland', 'marsh', 'fen'].includes(b);
  const isDryland = ['dryland', 'steppe', 'scrub'].includes(b);
  const forest = clamp01((isForest ? 1 : 0) * (0.52 + t.mild * 0.24 + t.warm * 0.12) * (0.54 + m.wet * 0.46) * (1 - s.steep * 0.40) * (1 - e.alpine * 0.76));
  const wetForest = clamp01(forest * (0.48 + m.wet * 0.52));
  const meadow = clamp01((isMeadow ? 1 : 0) * (0.58 + m.moderate * 0.18 + m.wet * 0.28) * (1 - e.alpine * 0.55));
  const heath = clamp01((isHeath ? 1 : 0) * (0.54 + t.cool * 0.26 + t.mild * 0.22) * (1 - m.wet * 0.40) * (0.76 + e.upland * 0.24));
  const tundra = clamp01((isTundra ? 1 : 0) * (0.44 + t.cold * 0.40 + e.alpine * 0.42) * (0.94 + s.steep * 0.06));
  const wetland = clamp01((isWetland ? 1 : 0) * (0.58 + m.wet * 0.58) * (1 - s.steep * 0.70) * (1 - e.alpine * 0.88));
  const dryland = clamp01((isDryland ? 1 : 0) * (0.48 + t.warm * 0.44 + t.hot * 0.18) * (1 - m.wet * 0.68) * (1 - e.alpine * 0.84));
  const alpine = clamp01((e.alpine * 0.72 + t.cold * 0.24 + s.steep * 0.18) * (isTundra || b === 'alpine-bare' ? 1 : 0.72));
  return freeze({ forest, wetForest, meadow, heath, tundra, wetland, dryland, alpine, thermal: t, moisture: m, elevation: e, slope: s });
}

export function climateMaterialResponse({ biome = 'meadow', moisture = 0.5, temperatureC = 12, exposure = 0.5, rockWeight = 0, snowWeight = 0 } = {}) {
  const b = keyOf(biome) || 'meadow';
  const channel = CLIMATE_MATERIAL_CHANNELS[b] ?? CLIMATE_MATERIAL_CHANNELS.meadow;
  const t = thermalWeight(temperatureC);
  const m = moistureWeight(moisture);
  const w = windWeight(exposure);
  const rock = clamp01(rockWeight);
  const snow = clamp01(snowWeight);
  const dryFactor = clamp01((t.warm + t.hot * 0.62) * (1 - m.wet * 0.52) + w.exposed * 0.12);
  const wetFactor = clamp01(m.wet * (1 - t.hot * 0.24) + snow * 0.08);
  return freeze({
    biome: b,
    albedoValue: clamp(channel.albedoWet + (channel.albedoDry - channel.albedoWet) * dryFactor - snow * 0.055, 0.72, 1.18),
    roughnessOffset: clamp(channel.roughnessWet + (channel.roughnessDry - channel.roughnessWet) * dryFactor + wetFactor * -0.050 + rock * 0.080 + w.exposed * 0.024, -0.18, 0.18),
    mossBlend: clamp(channel.mossBias * wetFactor * (1 - rock * 0.42)),
    frostBlend: clamp(snow * (0.68 + (1 - w.exposed) * 0.18 + t.cold * 0.16)),
    weathering: clamp(0.20 + m.wet * 0.24 + w.exposed * 0.18 + rock * 0.24 + snow * 0.12),
    thermal: t,
    moisture: m,
    wind: w,
  });
}

export function seasonalAssetWeights({ season = 'summer', snowWeight = 0, temperatureC = 12, biome = 'meadow', moisture = 0.5, windExposure = 0.5 } = {}) {
  const s = keyOf(season) || 'summer';
  const b = keyOf(biome);
  const snow = clamp01(snowWeight);
  const t = thermalWeight(temperatureC);
  const m = moistureWeight(moisture);
  const w = windWeight(windExposure);
  const winterSignal = ['winter', 'late-winter', 'snow'].includes(s) ? 1 : 0;
  const springSignal = s === 'spring' ? 1 : 0;
  const autumnSignal = ['autumn', 'fall'].includes(s) ? 1 : 0;
  const evergreen = /pine|spruce|fir|evergreen|tundra/.test(b);
  const deciduous = !evergreen;
  return freeze({
    winterVegetation: clamp01(winterSignal * (snow * 0.70 + t.cold * 0.26 + (evergreen ? 0.24 : 0))),
    dormantLeaf: clamp01(winterSignal * (deciduous ? 0.90 : 0.20) + autumnSignal * 0.34),
    flowering: clamp01(springSignal * (m.moderate * 0.46 + t.mild * 0.44) * (1 - snow * 0.84)),
    dryGrass: clamp01((s === 'summer' || s === 'late-summer' ? 1 : s === 'autumn' ? 0.64 : s === 'spring' ? 0.42 : 0.08) * (0.44 + t.warm * 0.42) * (1 - m.wet * 0.58) * (1 - snow * 0.72)),
    wetGrowth: clamp01((springSignal * 0.44 + m.wet * 0.34) * (1 - winterSignal * 0.72)),
    evergreen,
    deciduous,
    windRetention: w.sheltered,
    season: s,
  });
}

export function climateExposureEnvelope({ temperatureC = 12, moisture = 0.5, windExposure = 0.5, elevationMeters = 0, biome = 'meadow', slopeDegrees = 0 } = {}) {
  const transitions = biomeTransitionWeights({ biome, moisture, elevationMeters, slopeDegrees, temperatureC });
  const t = thermalWeight(temperatureC);
  const m = moistureWeight(moisture);
  const w = windWeight(windExposure);
  const e = elevationWeight(elevationMeters);
  return freeze({
    forestScore: clamp01(transitions.forest * 0.42 + transitions.wetForest * 0.20 + t.mild * 0.12 + m.wet * 0.11 + w.sheltered * 0.08),
    heathScore: clamp01(transitions.heath * 0.40 + t.cool * 0.18 + m.dry * 0.20 + w.exposed * 0.10 + e.upland * 0.10),
    tundraScore: clamp01(transitions.tundra * 0.40 + transitions.alpine * 0.30 + t.cold * 0.16 + e.alpine * 0.10 + w.exposed * 0.04),
    wetlandScore: clamp01(transitions.wetland * 0.56 + m.wet * 0.24 + w.sheltered * 0.12),
    drylandScore: clamp01(transitions.dryland * 0.56 + t.hot * 0.18 + m.dry * 0.18 + e.upland * 0.08),
    transitions,
    thermal: t,
    moisture: m,
    wind: w,
    elevation: e,
  });
}

export function climateMaterialLayers(options = {}) {
  const response = climateMaterialResponse(options);
  const seasonal = seasonalAssetWeights(options);
  return freeze({
    policyId: TERRAIN_ENVIRONMENT_CLIMATE_TRANSITION_POLICY.id,
    albedoValue: response.albedoValue,
    roughnessOffset: response.roughnessOffset,
    mossBlend: response.mossBlend,
    frostBlend: response.frostBlend,
    weathering: response.weathering,
    seasonal,
    renderOnly: true,
  });
}

export function climateMaterialFamily(category, sample = {}) {
  const transitions = biomeTransitionWeights(sample);
  const envelope = climateExposureEnvelope(sample);
  const categoryKey = keyOf(category);
  if (categoryKey === 'tree') return envelope.forestScore > 0.45 ? 'forest' : envelope.heathScore > 0.36 ? 'heath' : envelope.tundraScore > 0.42 ? 'tundra' : 'meadow';
  if (categoryKey === 'grass' || categoryKey === 'shrub') return transitions.wetland > 0.50 ? 'wetland' : transitions.heath > 0.46 ? 'heath' : transitions.meadow > 0.42 ? 'meadow' : 'forest-edge';
  if (categoryKey === 'rock' || categoryKey === 'cliff' || categoryKey === 'scree') return envelope.tundraScore > 0.50 || transitions.alpine > 0.45 ? 'alpine-bare' : envelope.heathScore > 0.40 ? 'dryland' : 'rock';
  return keyOf(sample.biome) || 'meadow';
}

export function validateClimateTransitionSample(sample = {}) {
  const material = climateMaterialResponse(sample);
  const transitions = biomeTransitionWeights(sample);
  const seasonal = seasonalAssetWeights(sample);
  const errors = [];
  if (material.albedoValue < 0.72 || material.albedoValue > 1.18) errors.push('albedo-range');
  if (material.roughnessOffset < -0.18 || material.roughnessOffset > 0.18) errors.push('roughness-range');
  for (const [name, value] of Object.entries(transitions)) {
    if (typeof value === 'number' && (value < 0 || value > 1)) errors.push(`transition-range:${name}`);
  }
  if (seasonal.winterVegetation < 0 || seasonal.winterVegetation > 1) errors.push('seasonal-range');
  return freeze({ ok: errors.length === 0, errors: freeze(errors), policyId: TERRAIN_ENVIRONMENT_CLIMATE_TRANSITION_POLICY.id });
}

export function buildClimateTransitionManifest(samples = []) {
  const reports = samples.map(validateClimateTransitionSample);
  const errors = reports.flatMap((report) => report.errors);
  return freeze({
    version: 1,
    policyId: TERRAIN_ENVIRONMENT_CLIMATE_TRANSITION_POLICY.id,
    reports,
    errors: freeze(errors),
    acceptance: freeze({ ok: errors.length === 0, errorCount: errors.length }),
  });
}
