const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value)));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((finite(value) - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const hash01 = (x, z, seed = 0) => {
  const n = Math.sin((finite(x) * 12.9898) + (finite(z) * 78.233) + (finite(seed) * 37.719)) * 43758.5453;
  return n - Math.floor(n);
};
const normalize = (value, fallback = 0) => {
  const safe = finite(value, fallback);
  return safe > 1 ? clamp01(safe / 100) : clamp01(safe);
};
const freeze = (value) => Object.freeze(value);

const buildSurfaceWeights = (sample = {}) => {
  const slope = normalize(sample.slope);
  const moisture = normalize(sample.moisture);
  const elevation = normalize(sample.elevation);
  const snow = Math.max(normalize(sample.snow), smoothstep(0.7, 1, elevation));
  const waterDistance = Math.max(0, finite(sample.waterDistance, 9999));
  const shore = 1 - smoothstep(2, 48, waterDistance);
  const rock = clamp01((slope * 0.72) + (elevation * 0.22) - (moisture * 0.14));
  const scree = clamp01((slope * 0.48) + (rock * 0.32) + (snow * 0.18));
  const wetEdge = clamp01(shore * (0.45 + moisture * 0.55));
  const wet = clamp01((moisture * 0.56) + (wetEdge * 0.42));
  const mud = clamp01((moisture * 0.58) + (shore * 0.2) - (rock * 0.2));
  const sand = clamp01(shore * (1 - rock) * (0.58 + (1 - moisture) * 0.3));
  const grass = clamp01((1 - rock) * (1 - snow) * (0.56 + (1 - slope) * 0.3));
  const soil = clamp01((1 - snow) * (0.2 + (1 - grass) * 0.45));
  const sum = Math.max(1e-6, grass + soil + mud + sand + rock + scree + snow + wetEdge);
  return freeze({
    grass: grass / sum,
    soil: soil / sum,
    mud: mud / sum,
    sand: sand / sum,
    rock: rock / sum,
    scree: scree / sum,
    snow: snow / sum,
    wetEdge: wetEdge / sum,
    wetness: wet,
    shoreline: shore,
  });
};

export const createEnvironmentVisualAdoption = (options = {}) => {
  const distance = Math.max(0, finite(options.cameraDistance, 0));
  const fadeStart = Math.max(1, finite(options.normalFadeStart, 180));
  const fadeEnd = Math.max(fadeStart + 1, finite(options.normalFadeEnd, 4200));
  const microFade = 1 - smoothstep(fadeStart, fadeEnd, distance);
  const sample = options.sample || {};
  const weights = buildSurfaceWeights(sample);
  const phase = hash01(options.worldX, options.worldZ, options.seed);
  const water = sample.waterBody === true || finite(sample.waterDepth, 0) > 0;
  const steep = normalize(sample.slope) >= 0.86;
  const permanentSnow = normalize(sample.permanentSnow) >= 0.75 || normalize(sample.snow) >= 0.96;
  const road = normalize(sample.roadInfluence);
  const settlement = normalize(sample.settlementInfluence);
  const groundConfidence = normalize(sample.groundConfidence, 1);
  const excluded = water || steep || permanentSnow || groundConfidence < 0.7;
  const detail = freeze({
    macro: clamp01(0.64 + (phase * 0.18)),
    meso: clamp01(0.42 + (1 - Math.abs(phase - 0.5)) * 0.28),
    micro: clamp01(microFade * (0.72 + phase * 0.2)),
    antiTilingPhase: phase,
  });
  return freeze({
    contract: 'environment-visual-adoption-v20',
    accepted: !excluded,
    excluded,
    exclusionReasons: freeze([
      ...(water ? ['canonical-water'] : []),
      ...(steep ? ['steep-slope'] : []),
      ...(permanentSnow ? ['permanent-snow'] : []),
      ...(groundConfidence < 0.7 ? ['low-ground-confidence'] : []),
    ]),
    surfaceWeights: weights,
    detail,
    modifiers: freeze({
      roadClearance: clamp01(road),
      settlementClearance: clamp01(settlement),
      wetEdgeFoam: clamp01(weights.wetEdge * (0.55 + microFade * 0.45)),
      normalEnergy: clamp01(0.18 + microFade * 0.82),
      albedoVariation: clamp01(0.35 + detail.macro * 0.35),
    }),
    adoption: freeze({
      requiresHydratedAsset: true,
      requiresMaterialAssignmentCore: true,
      requiresWorldAssetPlacementPipeline: true,
      editorRuntimeImport: false,
      sceneAttachOwner: 'caller',
    }),
    canonical: freeze({
      terrainHeightUnchanged: true,
      hydrologyUnchanged: true,
      colliderUnchanged: true,
      geographyInvented: false,
    }),
  });
};

export const applyEnvironmentVisualAdoption = (target, profile) => {
  if (!target || !profile || profile.contract !== 'environment-visual-adoption-v20') return false;
  const materials = Array.isArray(target.material) ? target.material : [target.material];
  for (const material of materials) {
    if (!material || typeof material !== 'object') continue;
    if ('roughness' in material) material.roughness = Math.max(0.18, Math.min(0.92, 0.82 - profile.modifiers.wetEdgeFoam * 0.18));
    if ('metalness' in material) material.metalness = Math.max(0, Math.min(0.2, finite(material.metalness)));
    if ('normalScale' in material && material.normalScale && typeof material.normalScale.set === 'function') {
      const energy = profile.modifiers.normalEnergy;
      material.normalScale.set(energy, energy);
    }
    material.userData = {
      ...(material.userData || {}),
      environmentVisualAdoption: profile,
    };
  }
  target.userData = {
    ...(target.userData || {}),
    environmentVisualAdoption: profile,
  };
  return true;
};

export const serializeEnvironmentVisualAdoption = (profile) => JSON.stringify(profile);
