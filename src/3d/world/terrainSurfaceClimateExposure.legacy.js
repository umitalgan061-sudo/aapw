/**
 * Deterministic climate-exposure response for terrain surface materials.
 *
 * This layer interprets authored terrain height, slope, moisture and base albedo into stable
 * proxies for frost exposure, solar drying, thermal range and cold-air pooling. It is intentionally
 * render-only: it does not alter terrain geometry, hydrology, coastlines, vegetation placement,
 * gameplay navigation, colliders or world topology.
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / Math.max(1e-9, b - a));
  return t * t * (3 - 2 * t);
};

function hash2D(ix, iz, seed) {
  let h = Math.imul((ix | 0) ^ seed, 0x45d9f3b) ^ Math.imul((iz | 0) + seed, 0x119de1f3);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2D(ix, iz, seed);
  const b = hash2D(ix + 1, iz, seed);
  const c = hash2D(ix, iz + 1, seed);
  const d = hash2D(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}

function fbm(x, z, seed, octaves = 4) {
  let value = 0;
  let weight = 0;
  let amp = 0.55;
  for (let i = 0; i < octaves; i += 1) {
    value += noise(x, z, seed + i * 83) * amp;
    weight += amp;
    x = x * 2.01 + 7.1;
    z = z * 2.03 - 5.7;
    amp *= 0.49;
  }
  return value / Math.max(1e-9, weight);
}

function ridge(x, z, seed) {
  return 1 - Math.abs(fbm(x, z, seed) * 2 - 1);
}

function aspectProxy(x, z) {
  const broad = fbm(x / 900, z / 900, 0x5a01, 5);
  const meso = fbm(x / 260, z / 260, 0x5a02, 4);
  return clamp01(broad * 0.62 + meso * 0.38);
}

function cloudProxy(x, z) {
  return clamp01(fbm(x / 1500, z / 1500, 0x5a10, 5) * 0.72 + fbm(x / 360, z / 360, 0x5a11, 3) * 0.28);
}

export const TERRAIN_CLIMATE_EXPOSURE_POLICY = Object.freeze({
  id: 'terrain-surface-climate-exposure-2026-09-15-v1',
  renderOnly: true,
  deterministic: true,
  canonicalHeightUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalCoastlineUnchanged: true,
  canonicalColliderUnchanged: true,
  canonicalVegetationPlacementUnchanged: true,
  newGeographyIntroduced: false,
  macroScaleMeters: 1500,
  mesoScaleMeters: 360,
  frostScaleMeters: Object.freeze([180, 52, 14]),
  solarScaleMeters: Object.freeze([900, 220, 44]),
  thermalScaleMeters: Object.freeze([420, 96, 22]),
  coldPoolScaleMeters: Object.freeze([760, 180]),
  frostHeightMeters: Object.freeze([260, 1550]),
  snowpackHeightMeters: Object.freeze([480, 2100]),
  maxAlbedoShift: 0.075,
  maxRoughnessShift: 0.065,
  maxNormalStrength: 0.055,
  materialKey: 'terrain-surface-climate-exposure-v1',
});

export const TERRAIN_CLIMATE_CANONICAL_INVARIANTS = Object.freeze([
  'canonicalHeightUnchanged',
  'canonicalHydrologyUnchanged',
  'canonicalCoastlineUnchanged',
  'canonicalColliderUnchanged',
  'canonicalVegetationPlacementUnchanged',
  'newGeographyIntroduced:false',
]);

function resolveBand(heightMeters, low, high) {
  return smoothstep(low, Math.max(low + 1, high), heightMeters);
}

export function resolveTerrainClimateExposureState({
  worldX,
  worldZ,
  heightMeters,
  slopeDegrees = 0,
  moisture = 0.5,
  baseColor = { r: 0.35, g: 0.43, b: 0.25 },
}) {
  const x = Number(worldX) || 0;
  const z = Number(worldZ) || 0;
  const h = Number(heightMeters) || 0;
  const slope = Math.max(0, Number(slopeDegrees) || 0);
  const m = clamp01(Number(moisture) || 0);
  const climate = aspectProxy(x, z);
  const cloud = cloudProxy(x, z);
  const luma = clamp01(Number(baseColor.r) * 0.2126 + Number(baseColor.g) * 0.7152 + Number(baseColor.b) * 0.0722);
  const dryBase = clamp01((1 - m) * 0.62 + climate * 0.18 + (1 - cloud) * 0.20);
  const wetBase = clamp01(m * 0.65 + (1 - climate) * 0.16 + cloud * 0.19);
  const frostBand = resolveBand(h, TERRAIN_CLIMATE_EXPOSURE_POLICY.frostHeightMeters[0], TERRAIN_CLIMATE_EXPOSURE_POLICY.frostHeightMeters[1]);
  const snowBand = resolveBand(h, TERRAIN_CLIMATE_EXPOSURE_POLICY.snowpackHeightMeters[0], TERRAIN_CLIMATE_EXPOSURE_POLICY.snowpackHeightMeters[1]);
  const slopeExposure = smoothstep(3, 24, slope);
  const sheltered = smoothstep(0.22, 0.78, ridge(x / 180, z / 52, 0x5b01));
  const frostTexture = clamp01(
    frostBand * (0.42 + noise(x / 14, z / 14, 0x5b10) * 0.34 + ridge(x / 52, z / 18, 0x5b11) * 0.24),
  );
  const freezeThaw = clamp01(frostBand * (0.58 + wetBase * 0.42) * (0.48 + slopeExposure * 0.36 + sheltered * 0.16));
  const solarDrying = clamp01(dryBase * (0.42 + noise(x / 44, z / 44, 0x5b20) * 0.30 + climate * 0.28));
  const thermalRange = clamp01(0.26 + frostBand * 0.40 + solarDrying * 0.22 + (1 - cloud) * 0.12);
  const coldAirPool = clamp01((1 - slopeExposure) * (0.36 + (1 - climate) * 0.34 + ridge(x / 760, z / 180, 0x5b30) * 0.30));
  const iceLens = clamp01(freezeThaw * (0.38 + wetBase * 0.46 + ridge(x / 9, z / 9, 0x5b40) * 0.16));
  const rime = clamp01(frostTexture * (0.42 + cloud * 0.34 + coldAirPool * 0.24));
  const saltDrying = clamp01(solarDrying * (1 - frostBand * 0.62) * (0.55 + dryBase * 0.45));
  const exposedMineral = clamp01((1 - luma) * 0.22 + slopeExposure * 0.34 + freezeThaw * 0.28 + saltDrying * 0.16);
  const stress = clamp01(freezeThaw * 0.44 + thermalRange * 0.28 + solarDrying * 0.18 + exposedMineral * 0.10);
  return Object.freeze({
    climate,
    cloud,
    dryBase,
    wetBase,
    frostBand,
    snowBand,
    slopeExposure,
    sheltered,
    frostTexture,
    freezeThaw,
    solarDrying,
    thermalRange,
    coldAirPool,
    iceLens,
    rime,
    saltDrying,
    exposedMineral,
    stress,
  });
}

export function resolveTerrainClimateMaterialResponse({ state, baseColor, baseRoughness = 0.86 }) {
  const frost = state.rime * 0.028 + state.iceLens * 0.016;
  const dry = state.solarDrying * 0.022 + state.saltDrying * 0.012;
  const mineral = state.exposedMineral * 0.016;
  const color = Object.freeze({
    r: clamp01(baseColor.r + frost * 0.72 + dry * 0.34 + mineral * 0.50),
    g: clamp01(baseColor.g + frost * 0.82 + dry * 0.28 + mineral * 0.34),
    b: clamp01(baseColor.b + frost * 0.94 + dry * 0.16 + mineral * 0.20),
  });
  const roughness = clamp01(baseRoughness + state.stress * 0.042 + state.exposedMineral * 0.026 - state.iceLens * 0.034);
  const normalStrength = clamp01(state.freezeThaw * 0.030 + state.iceLens * 0.022 + state.exposedMineral * 0.018);
  return Object.freeze({ color, roughness, normalStrength, frost, dry, mineral });
}

export const TERRAIN_CLIMATE_EXPOSURE_GLSL = String.raw`
float terrainClimateHash(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float terrainClimateNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float a=terrainClimateHash(i),b=terrainClimateHash(i+vec2(1,0)),c=terrainClimateHash(i+vec2(0,1)),d=terrainClimateHash(i+vec2(1,1));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float terrainClimateFbm(vec2 p){float v=0.,w=0.,a=.55;for(int i=0;i<5;i++){v+=terrainClimateNoise(p)*a;w+=a;p=p*2.01+vec2(7.1,-5.7);a*=.49;}return v/w;}
float terrainClimateRidge(vec2 p){return 1.-abs(terrainClimateFbm(p)*2.-1.);}
void terrainClimateApplyColor(){vec2 p=vTerrainLowWorldPosition.xz;float h=vTerrainLowWorldPosition.y;float slope=1.-clamp(abs(normalize(vTerrainLowWorldNormal).y),0.,1.);float climate=clamp(terrainClimateFbm(p/1500.),0.,1.);float cloud=clamp(terrainClimateFbm(p/900.+vec2(17.2,-9.1))*.7+terrainClimateFbm(p/220.+vec2(-4.2,6.4))*.3,0.,1.);float frost=smoothstep(260.,1550.,h)*(0.42+terrainClimateNoise(p/14.)*.34+terrainClimateRidge(p/52.)*.24);float wet=clamp(.50+(1.-climate)*.16+cloud*.19,0.,1.);float freeze=clamp(frost*(.58+wet*.42)*(.48+smoothstep(.05,.40,slope)*.36),0.,1.);float dry=clamp((1.-wet)*.62+climate*.18+(1.-cloud)*.20,0.,1.);float rime=clamp(frost*(.42+cloud*.34+terrainClimateRidge(p/180.)*.24),0.,1.);float mineral=clamp((smoothstep(.08,.28,1.-diffuseColor.rgb.r)*.22)+smoothstep(.05,.40,slope)*.34+freeze*.28+dry*.16,0.,1.);float mask=1.-smoothstep(.58,.88,dot(diffuseColor.rgb,vec3(.2126,.7152,.0722)))*(1.-smoothstep(.08,.22,max(diffuseColor.r,max(diffuseColor.g,diffuseColor.b))-min(diffuseColor.r,min(diffuseColor.g,diffuseColor.b))));diffuseColor.rgb+=vec3(.028,.032,.036)*rime*.46*mask;diffuseColor.rgb+=vec3(.016,.012,.008)*dry*.38*mask;diffuseColor.rgb+=vec3(.012,.010,.007)*mineral*.34*mask;}
void terrainClimateApplyRoughness(){vec2 p=vTerrainLowWorldPosition.xz;float h=vTerrainLowWorldPosition.y;float slope=1.-clamp(abs(normalize(vTerrainLowWorldNormal).y),0.,1.);float frost=smoothstep(260.,1550.,h)*(0.48+terrainClimateRidge(p/52.)*.52);float freeze=frost*(0.55+smoothstep(.05,.40,slope)*.45);float dry=(1.-frost)*terrainClimateFbm(p/420.);roughnessFactor=clamp(roughnessFactor+freeze*.044+dry*.026-frost*.018,0.42,1.0);}
void terrainClimateApplyNormal(){vec2 p=vTerrainLowWorldPosition.xz;float h=vTerrainLowWorldPosition.y;float frost=smoothstep(260.,1550.,h);float a=terrainClimateNoise(p/15.),b=terrainClimateNoise(p/15.+vec2(2.7,-1.9));vec2 g=vec2(b-a,terrainClimateRidge(p/38.)-.5);normal=normalize(normal+mat3(viewMatrix)*vec3(-g.x,0.,-g.y)*frost*.052);}
`;

export function installTerrainClimateExposure(material) {
  if (!material) throw new TypeError('terrain climate exposure requires a material');
  if (material.userData?.terrainClimateExposureInstalled) return material;
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${TERRAIN_CLIMATE_EXPOSURE_GLSL}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nterrainClimateApplyColor();');
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nterrainClimateApplyRoughness();');
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nterrainClimateApplyNormal();');
  };
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}|${TERRAIN_CLIMATE_EXPOSURE_POLICY.materialKey}`;
  material.userData = {
    ...material.userData,
    terrainClimateExposureInstalled: true,
    terrainClimateExposurePolicyId: TERRAIN_CLIMATE_EXPOSURE_POLICY.id,
    terrainClimateExposureRenderOnly: true,
    terrainClimateExposureCanonicalHeightUnchanged: true,
    terrainClimateExposureCanonicalHydrologyUnchanged: true,
    terrainClimateExposureCanonicalCoastlineUnchanged: true,
    terrainClimateExposureCanonicalColliderUnchanged: true,
    terrainClimateExposureCanonicalVegetationPlacementUnchanged: true,
  };
  material.needsUpdate = true;
  return material;
}

export function climateExposurePolicySnapshot() {
  return Object.freeze({
    id: TERRAIN_CLIMATE_EXPOSURE_POLICY.id,
    renderOnly: true,
    deterministic: true,
    scales: Object.freeze({
      macro: TERRAIN_CLIMATE_EXPOSURE_POLICY.macroScaleMeters,
      meso: TERRAIN_CLIMATE_EXPOSURE_POLICY.mesoScaleMeters,
      frost: TERRAIN_CLIMATE_EXPOSURE_POLICY.frostScaleMeters,
      solar: TERRAIN_CLIMATE_EXPOSURE_POLICY.solarScaleMeters,
      thermal: TERRAIN_CLIMATE_EXPOSURE_POLICY.thermalScaleMeters,
    }),
    invariants: TERRAIN_CLIMATE_CANONICAL_INVARIANTS,
  });
}
