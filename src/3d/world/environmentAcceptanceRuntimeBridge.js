/**
 * Read-only runtime bridge for the shipped world bootstrap.
 * It turns already-available renderer/canonical observations into bounded,
 * caller-owned adoption hints for terrain, water, vegetation and atmosphere.
 * No geometry, geography, collider or placement state is created here.
 */

const clamp = (value, min = 0, max = 1, fallback = min) => {
  const finite = Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, finite));
};

const text = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : fallback;
const round = value => Math.round((Number.isFinite(value) ? value : 0) * 1e6) / 1e6;

const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stable(value[key]);
    return result;
  }, {});
};

const digest = value => {
  const source = JSON.stringify(stable(value));
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const normalizeObservation = (observation = {}, index = 0) => {
  const canonical = observation.canonical ?? {};
  const rendered = observation.rendered ?? {};
  const environment = observation.environment ?? {};
  const slope = clamp(canonical.slope);
  const height = Number.isFinite(canonical.height) ? canonical.height : 0;
  const waterDistance = Math.max(0, Number.isFinite(canonical.waterDistance) ? canonical.waterDistance : 999999);
  const waterBody = text(canonical.waterBody, 'none');
  const biome = text(canonical.biome, 'unknown');
  const wet = waterDistance <= 16 || waterBody !== 'none';
  const alpine = biome.includes('alpine') || biome.includes('snow') || height >= 1800;
  const cliff = slope >= 0.72;
  const cyan = clamp(rendered.cyanRatio);
  const moire = clamp(rendered.moireRisk);
  const seam = clamp(rendered.tileBoundaryRisk);
  const blackSky = clamp(rendered.blackSkyRisk);
  const flatness = clamp(1 - clamp(environment.macroBreakup, 0, 1, 0.5));
  const repeat = clamp(rendered.textureRepeatRisk);
  const visibleArtifactRisk = Math.max(cyan, moire, seam, blackSky, repeat);
  return {
    id: text(observation.id, `observation-${String(index).padStart(3, '0')}`),
    coordinate: {
      x: round(observation.coordinate?.x),
      y: round(observation.coordinate?.y),
      z: round(observation.coordinate?.z),
    },
    canonical: {
      height: round(height),
      slope: round(slope),
      moisture: round(clamp(canonical.moisture, 0, 1, 0.5)),
      waterDistance: round(waterDistance),
      waterBody,
      biome,
      roadDistance: round(Math.max(0, Number.isFinite(canonical.roadDistance) ? canonical.roadDistance : 999999)),
      settlementDistance: round(Math.max(0, Number.isFinite(canonical.settlementDistance) ? canonical.settlementDistance : 999999)),
    },
    rendered: {
      height: round(rendered.height),
      luminance: round(clamp(rendered.luminance, 0, 1, 0.5)),
      cyanRatio: round(cyan),
      moireRisk: round(moire),
      tileBoundaryRisk: round(seam),
      blackSkyRisk: round(blackSky),
      textureRepeatRisk: round(repeat),
      vegetationVoidRisk: round(clamp(rendered.vegetationVoidRisk, 0, 1, 0.5)),
    },
    context: { wet, alpine, cliff, flatness: round(flatness) },
    risk: {
      visibleArtifactRisk: round(visibleArtifactRisk),
      structural: seam > 0.25 || cyan > 0.35 || moire > 0.35,
      atmospheric: blackSky > 0.35,
      terrain: flatness > 0.55 || (cliff && flatness > 0.35),
      snowline: alpine && flatness > 0.35,
      vegetation: !wet && !cliff && !alpine && clamp(rendered.vegetationVoidRisk, 0, 1, 0.5) > 0.55,
    },
  };
};

const createHints = observation => {
  const { canonical, context, risk } = observation;
  const water = context.wet ? {
    deepToShallowBlend: clamp(1 - canonical.waterDistance / 16, 0.2, 1),
    wetEdge: clamp(1 - canonical.waterDistance / 8, 0, 1),
    suppressCyanOverlay: risk.structural,
    suppressMoiré: risk.structural,
  } : { deepToShallowBlend: 0, wetEdge: 0, suppressCyanOverlay: false, suppressMoiré: false };
  const terrain = {
    macroBreakup: clamp(1 - observation.risk.terrain * 0.55, 0.35, 1),
    microRelief: clamp(canonical.slope * 0.75 + (context.alpine ? 0.25 : 0), 0.15, 1),
    rockExposure: clamp(canonical.slope * 1.1 + (context.alpine ? 0.15 : 0), 0, 1),
    snowlineBlend: context.alpine ? clamp(0.35 + canonical.slope * 0.65, 0.35, 1) : 0,
  };
  const vegetation = {
    allow: !context.wet && !context.cliff && !context.alpine,
    density: context.wet || context.cliff ? 0 : clamp(1 - observation.rendered.vegetationVoidRisk, 0.25, 1),
    ecotone: context.alpine ? 0 : clamp(canonical.moisture * 0.6 + (canonical.roadDistance > 20 ? 0.2 : 0), 0, 1),
    lodBias: observation.rendered.vegetationVoidRisk > 0.75 ? 1 : 0,
  };
  const atmosphere = {
    readableBackground: !risk.atmospheric,
    exposureFloor: risk.atmospheric ? 0.85 : 0.65,
    fogLift: risk.atmospheric ? 0.2 : 0,
    cameraRelativeSky: true,
  };
  return { water, terrain, vegetation, atmosphere };
};

export function createEnvironmentAcceptanceRuntimeBridge({ observations = [], frameTimeMs = 16.7, mobile = false } = {}) {
  const normalized = observations.map(normalizeObservation).sort((left, right) => left.id.localeCompare(right.id));
  const averageRisk = normalized.length ? normalized.reduce((sum, item) => sum + item.risk.visibleArtifactRisk, 0) / normalized.length : 0;
  const performancePressure = clamp((Number.isFinite(frameTimeMs) ? frameTimeMs : 16.7) / (mobile ? 33.3 : 16.7) - 1, 0, 1);
  const tier = averageRisk > 0.65 ? 'guarded' : performancePressure > 0.35 ? 'degraded' : 'full';
  const plans = normalized.map(item => ({ id: item.id, coordinate: item.coordinate, hints: createHints(item), risk: item.risk }));
  const acceptance = {
    status: tier === 'full' && normalized.every(item => item.risk.visibleArtifactRisk < 0.35) ? 'candidate' : 'guarded',
    targets: {
      visibleRectangularWater: 0,
      visibleWaterMoire: 0,
      visibleGridOrSeam: 0,
      blackSkyFailure: 0,
      floatingOrInvalidVegetation: 0,
    },
    observed: {
      structuralRiskCount: normalized.filter(item => item.risk.structural).length,
      atmosphericRiskCount: normalized.filter(item => item.risk.atmospheric).length,
      terrainRiskCount: normalized.filter(item => item.risk.terrain).length,
      vegetationRiskCount: normalized.filter(item => item.risk.vegetation).length,
    },
  };
  const result = {
    version: 'environment-acceptance-runtime-bridge-v28',
    tier,
    frameTimeMs: Number.isFinite(frameTimeMs) ? round(frameTimeMs) : 16.7,
    mobile: mobile === true,
    observations: normalized,
    plans,
    acceptance,
  };
  return Object.freeze({ ...result, digest: digest(result) });
}

export function serializeEnvironmentAcceptanceRuntimeBridge(value) {
  return JSON.stringify(stable(value));
}
