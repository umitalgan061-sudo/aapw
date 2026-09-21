const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));

export const V66_GROUND_POLICY = Object.freeze({
  id: 'environment-runtime-ground-response-v66-2026-09-15', version: 66, deterministic: true, mutation: false,
  repeatMin: 0.72, repeatMax: 18, blackLumaFloor: 0.08,
});

export const normalizeGroundSampleV66 = (sample = {}) => ({
  elevation: Number(sample.elevation) || 0,
  slope: clamp(sample.slope, 0, 90), moisture: clamp(sample.moisture), snow: clamp(sample.snow), wetness: clamp(sample.wetness),
  rockExposure: clamp(sample.rockExposure), soilDepth: clamp(sample.soilDepth ?? 0.5), traffic: clamp(sample.traffic),
  biome: sample.biome || 'grassland', material: sample.material || 'ground', confidence: clamp(sample.confidence ?? 1),
});

export const computeGroundRoleWeightsV66 = (sample = {}, weather = {}) => {
  const s = normalizeGroundSampleV66(sample);
  const rain = clamp(weather.precipitation ?? 0);
  const cold = clamp((0.38 - (Number(weather.temperature) || 0.5)) * 1.8);
  const grass = clamp((1 - s.rockExposure) * (1 - s.snow) * (0.64 + s.moisture * 0.36) * (1 - s.traffic * 0.22));
  const soil = clamp(0.26 + (1 - s.soilDepth) * 0.22 + s.traffic * 0.28 + rain * 0.12);
  const mud = clamp(s.moisture * 0.5 + rain * 0.34 + s.wetness * 0.16);
  const rock = clamp(s.rockExposure * 0.72 + s.slope / 100 * 0.28);
  const snow = clamp(s.snow * 0.72 + cold * 0.28);
  const wet = clamp(s.wetness * 0.72 + rain * 0.18 + s.moisture * 0.1);
  const total = grass + soil + mud + rock + snow + wet || 1;
  return { grass: grass / total, soil: soil / total, mud: mud / total, rock: rock / total, snow: snow / total, wet: wet / total };
};

export const buildGroundMaterialResponseV66 = (sample = {}, weather = {}, camera = {}) => {
  const s = normalizeGroundSampleV66(sample);
  const roles = computeGroundRoleWeightsV66(s, weather);
  const distance = Math.max(1, Number(camera.distance) || 600);
  const repeat = clamp(14 / Math.sqrt(distance / 100), 0.8, 18);
  const detailFade = clamp(1 - distance / 3500);
  const worldScale = 0.75 + roles.rock * 0.55 + roles.soil * 0.2;
  const macro = clamp(0.38 + roles.grass * 0.28 + roles.rock * 0.22);
  const micro = clamp(0.26 + detailFade * 0.5 + roles.wet * 0.1);
  return {
    policy: V66_GROUND_POLICY.id, roles, repeat, detailFade, worldScale,
    pbr: { macroRoughness: clamp(0.46 + roles.soil * 0.24 + roles.rock * 0.18), microNormal: micro, macroVariation: macro, specular: clamp(0.12 + roles.wet * 0.28 + roles.snow * 0.22) },
    antiTilingPhase: { x: Number((sample.x || 0) * 0.037 % 7).toFixed(4), y: Number((sample.z || 0) * 0.043 % 7).toFixed(4) },
    triplanarEquivalent: s.slope > 38 || roles.rock > 0.44,
    snowlineBreakup: clamp(roles.snow * 0.78 + roles.rock * 0.22),
    lumaFloor: Math.max(V66_GROUND_POLICY.blackLumaFloor, 0.12 + roles.grass * 0.1),
  };
};

export const buildGroundBiomePaletteV66 = (biome, weather = {}) => {
  const templates = {
    forest: { grass: 0.48, soil: 0.18, mud: 0.13, rock: 0.08, moss: 0.13 },
    taiga: { grass: 0.28, soil: 0.18, mud: 0.1, rock: 0.16, moss: 0.28 },
    wetland: { grass: 0.3, soil: 0.16, mud: 0.28, rock: 0.04, moss: 0.22 },
    alpine: { grass: 0.16, soil: 0.12, mud: 0.04, rock: 0.48, moss: 0.2 },
    tundra: { grass: 0.14, soil: 0.12, mud: 0.06, rock: 0.26, moss: 0.42 },
    steppe: { grass: 0.68, soil: 0.16, mud: 0.03, rock: 0.09, moss: 0.04 },
    grassland: { grass: 0.76, soil: 0.16, mud: 0.02, rock: 0.04, moss: 0.02 },
    desert: { grass: 0.02, soil: 0.38, mud: 0.01, rock: 0.56, moss: 0.01 },
    coastal: { grass: 0.34, soil: 0.16, mud: 0.12, rock: 0.26, moss: 0.12 },
  };
  const base = templates[biome] || templates.grassland;
  const wet = clamp(weather.humidity ?? 0.5);
  const result = { ...base, mud: clamp(base.mud + wet * 0.06), moss: clamp(base.moss + wet * 0.08), grass: clamp(base.grass - wet * 0.03) };
  const total = Object.values(result).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value / total]));
};

export const validateGroundResponseV66 = (response) => {
  const errors = [];
  if (response?.policy !== V66_GROUND_POLICY.id) errors.push('policy');
  if ((response?.repeat ?? 0) < V66_GROUND_POLICY.repeatMin || (response?.repeat ?? 0) > V66_GROUND_POLICY.repeatMax) errors.push('repeat');
  const total = Object.values(response?.roles || {}).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 0.03) errors.push('weights');
  if ((response?.lumaFloor ?? 0) < V66_GROUND_POLICY.blackLumaFloor) errors.push('luma');
  return { ok: errors.length === 0, errors };
};

export const groundResponseTelemetryV66 = (response) => ({
  policy: response?.policy, repeat: response?.repeat || 0, detailFade: response?.detailFade || 0,
  triplanar: response?.triplanarEquivalent === true, lumaFloor: response?.lumaFloor || 0,
  snowline: response?.snowlineBreakup || 0,
});

export const getV66GroundSummary = () => Object.freeze({ contract: V66_GROUND_POLICY, features: ['role-weights', 'multiscale-pbr', 'anti-tiling', 'triplanar-equivalent', 'snowline-breakup'] });
