const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const round = (value, digits = 5) => Number(Number(value).toFixed(digits));

const normalize = (value, fallback = 0) => Number.isFinite(value) ? Number(value) : fallback;

const hashString = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const toStable = (value) => {
  if (Array.isArray(value)) return value.map(toStable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, toStable(value[key])]));
  }
  return value;
};

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

const surfaceBlend = (sample = {}) => {
  const slope = clamp(normalize(sample.slope), 0, 1);
  const moisture = clamp(normalize(sample.moisture), 0, 1);
  const elevation = clamp(normalize(sample.elevation), 0, 1);
  const waterDistance = Math.max(0, normalize(sample.waterDistance, 999));
  const shoreline = clamp(1 - waterDistance / 18, 0, 1);
  const shallow = clamp(normalize(sample.depth, 1), 0, 1) * (sample.isWater ? 1 : 0);
  const wetEdge = shoreline * (1 - shallow);
  const rock = clamp(slope * 1.35 + elevation * 0.35, 0, 1);
  const scree = clamp((slope - 0.48) * 1.8 + elevation * 0.25, 0, 1) * (1 - shallow);
  const snow = clamp((elevation - 0.72) * 3.3 + slope * 0.15, 0, 1) * (1 - shoreline);
  const grass = clamp((1 - slope) * (1 - snow) * (1 - shallow) * (0.65 + moisture * 0.35), 0, 1);
  const soil = clamp((1 - slope) * (1 - moisture * 0.45) * (1 - snow) * (1 - shallow), 0, 1);
  const mud = clamp(moisture * (1 - slope) * (1 - snow) * (1 - shallow), 0, 1);
  const sand = clamp(shoreline * (1 - slope) * (1 - shallow), 0, 1);
  const foam = clamp(shoreline * shallow * 1.35, 0, 1);
  const total = grass + soil + mud + sand + rock + scree + snow + wetEdge + foam;
  const divisor = total > 0 ? total : 1;
  return Object.fromEntries(Object.entries({ grass, soil, mud, sand, rock, scree, snow, wetEdge, foam }).map(([key, value]) => [key, round(value / divisor)]));
};

const classifyCoverage = (sample = {}) => {
  const footprint = sample.footprint || {};
  const width = Math.max(0, normalize(footprint.width));
  const height = Math.max(0, normalize(footprint.height));
  const regularity = clamp(normalize(footprint.regularity, 1), 0, 1);
  const cyanBias = clamp(normalize(sample.cyanBias), 0, 1);
  return {
    visibleRectangularWater: Boolean(sample.isWater && width > 0 && height > 0 && regularity > 0.94 && cyanBias > 0.52),
    visibleWaterMoire: Boolean(sample.isWater && normalize(sample.normalRepeat, 0) > 0.72 && normalize(sample.frequencyVariance, 0) < 0.16),
    shorelineHardEdge: Boolean(sample.isWater && normalize(sample.edgeGradient, 0) > 0.82 && normalize(sample.edgeBlend, 0) < 0.18),
  };
};

const terrainParity = (sample = {}) => {
  const canonical = normalize(sample.canonicalHeight);
  const rendered = normalize(sample.renderedHeight, canonical);
  const collider = normalize(sample.colliderHeight, canonical);
  const renderError = Math.abs(rendered - canonical);
  const colliderError = Math.abs(collider - canonical);
  return {
    canonical: round(canonical),
    rendered: round(rendered),
    collider: round(collider),
    renderError: round(renderError),
    colliderError: round(colliderError),
    parityPass: renderError <= 0.04 && colliderError <= 0.04,
  };
};

export function buildWaterShorelineAdoption(sample = {}, options = {}) {
  const surface = surfaceBlend(sample);
  const coverage = classifyCoverage(sample);
  const parity = terrainParity(sample);
  const phaseSeed = `${normalize(sample.worldX)}:${normalize(sample.worldZ)}:${options.seed || 'canonical'}`;
  const phase = Number.parseInt(hashString(phaseSeed), 16) / 0xffffffff;
  const water = Boolean(sample.isWater);
  const nearShore = clamp(1 - Math.max(0, normalize(sample.waterDistance, 999)) / 18, 0, 1);
  const response = {
    water: {
      deep: round(water ? clamp(1 - nearShore, 0, 1) : 0),
      shallow: round(water ? nearShore * (1 - clamp(normalize(sample.depth), 0, 1)) : 0),
      wetEdge: surface.wetEdge,
      foam: surface.foam,
      opacity: round(water ? clamp(0.62 + nearShore * 0.18, 0.62, 0.82) : 0),
      roughness: round(water ? clamp(0.24 + nearShore * 0.22, 0.24, 0.55) : 0.8),
      normalEnergy: round(water ? clamp(0.2 + (1 - phase) * 0.18, 0.2, 0.38) : 0.12),
    },
    terrain: {
      surface,
      parity,
      antiTilingPhase: round(phase),
      macroBreakup: round(clamp(0.35 + normalize(sample.macroVariation) * 0.55, 0.35, 0.9)),
      microRelief: round(clamp(0.12 + normalize(sample.microVariation) * 0.6 + normalize(sample.slope) * 0.18, 0.12, 0.85)),
    },
    vegetation: {
      grounded: Boolean(!water && !sample.inCliff && !sample.inRoad && !sample.inSettlement && !sample.permanentSnow && parity.parityPass),
      density: round(clamp((1 - normalize(sample.slope)) * (1 - surface.snow) * (1 - surface.rock * 0.55) * (0.55 + normalize(sample.moisture) * 0.45), 0, 1)),
      clusterRadius: round(clamp(5 + (1 - normalize(sample.slope)) * 18, 5, 23)),
      lodBias: round(clamp(1 - normalize(sample.cameraDistance) / 400, 0, 1)),
    },
    acceptance: {
      visibleRectangularWater: coverage.visibleRectangularWater,
      visibleWaterMoire: coverage.visibleWaterMoire,
      shorelineHardEdge: coverage.shorelineHardEdge,
      floatingOrInterpenetrating: Boolean(sample.floating || sample.interpenetrating),
      blackSky: Boolean(sample.backgroundLuminance !== undefined && normalize(sample.backgroundLuminance) < 0.025),
    },
    camera: {
      profile: options.cameraProfile || 'full-world-orthographic',
      width: 1536,
      height: 1024,
      fov: 90,
      deterministic: true,
    },
  };
  const stable = JSON.stringify(toStable(response));
  return deepFreeze({ ...response, digest: hashString(stable) });
}

export const applyWaterShorelineAdoption = (material = {}, plan = {}) => {
  if (!material || typeof material !== 'object') return material;
  if (plan.water) {
    material.opacity = plan.water.opacity;
    material.roughness = plan.water.roughness;
    material.normalEnergy = plan.water.normalEnergy;
  }
  material.antiTilingPhase = plan.terrain?.antiTilingPhase ?? 0;
  material.macroBreakup = plan.terrain?.macroBreakup ?? 0.35;
  material.microRelief = plan.terrain?.microRelief ?? 0.12;
  return material;
};

export default buildWaterShorelineAdoption;
