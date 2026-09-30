/**
 * Deterministic seasonal surface response for authored terrain materials.
 *
 * Seasonality is explicit input, never inferred into gameplay state. The module changes only albedo,
 * roughness and normal energy so the same canonical terrain can read as spring-wet, summer-dry,
 * autumn-littered or winter-cold without altering height, vegetation placement or hydrology.
 */
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / Math.max(1e-9, b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

export const TERRAIN_SEASONAL_POLICY = Object.freeze({
  id: 'terrain-surface-seasonality-2026-09-15-v1',
  renderOnly: true, deterministic: true,
  canonicalHeightUnchanged: true, canonicalHydrologyUnchanged: true,
  canonicalCoastlineUnchanged: true, canonicalColliderUnchanged: true,
  canonicalVegetationPlacementUnchanged: true, newGeographyIntroduced: false,
  defaultSeasonPhase: 0.34,
  phaseRange: Object.freeze([0, 1]),
  wetPeakPhase: 0.12,
  dryPeakPhase: 0.58,
  litterPeakPhase: 0.78,
  coldPeakPhase: 0.94,
  transitionWidth: 0.14,
  broadScaleMeters: 1800,
  microScaleMeters: 24,
  maxColorEnergy: 0.095,
  maxRoughnessEnergy: 0.11,
  maxNormalEnergy: 0.07,
  materialKey: 'terrain-surface-seasonality-v1',
});

function wrappedDistance(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d);
}
function phasePulse(phase, center, width = TERRAIN_SEASONAL_POLICY.transitionWidth) {
  return 1 - smoothstep(0, width, wrappedDistance(phase, center));
}
function hash2D(ix, iz, seed) {
  let h = Math.imul((ix | 0) ^ seed, 0x45d9f3b) ^ Math.imul((iz | 0) + seed, 0x119de1f3);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise(x, z, seed) {
  const ix = Math.floor(x); const iz = Math.floor(z); const fx = x - ix; const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx); const uz = fz * fz * (3 - 2 * fz);
  const a = hash2D(ix, iz, seed); const b = hash2D(ix + 1, iz, seed); const c = hash2D(ix, iz + 1, seed); const d = hash2D(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}
function fbm(x, z, seed, octaves = 4) {
  let v = 0; let w = 0; let amp = 0.55;
  for (let i = 0; i < octaves; i += 1) { v += noise(x, z, seed + i * 83) * amp; w += amp; x = x * 2.03 + 7.2; z = z * 2.03 - 6.1; amp *= 0.49; }
  return v / Math.max(w, 1e-9);
}

export function resolveTerrainSeasonalState({ worldX, worldZ, heightMeters, slopeDegrees = 0, moisture = 0.5, seasonPhase = TERRAIN_SEASONAL_POLICY.defaultSeasonPhase }) {
  const x = Number(worldX) || 0; const z = Number(worldZ) || 0; const h = Number(heightMeters) || 0; const slope = Number(slopeDegrees) || 0; const phase = clamp01(Number(seasonPhase) || 0);
  const regional = fbm(x / 1800, z / 1800, 0x8110, 5);
  const broad = fbm(x / 620, z / 620, 0x8111, 4);
  const micro = fbm(x / 24, z / 24, 0x8112, 3);
  const localClimate = clamp01(Number(moisture) * 0.68 + (1 - broad) * 0.20 + (1 - regional) * 0.12);
  const wet = phasePulse(phase, TERRAIN_SEASONAL_POLICY.wetPeakPhase) * (0.58 + localClimate * 0.42);
  const dry = phasePulse(phase, TERRAIN_SEASONAL_POLICY.dryPeakPhase) * (0.40 + (1 - localClimate) * 0.60);
  const litter = phasePulse(phase, TERRAIN_SEASONAL_POLICY.litterPeakPhase) * (0.64 + localClimate * 0.36) * (0.48 + smoothstep(20, 180, h) * 0.52);
  const cold = phasePulse(phase, TERRAIN_SEASONAL_POLICY.coldPeakPhase) * (0.52 + smoothstep(120, 620, h) * 0.48);
  const frost = cold * (0.48 + micro * 0.52) * (1 - smoothstep(2, 28, slope));
  const wetFilm = wet * (1 - smoothstep(2, 24, slope)) * (0.44 + micro * 0.56);
  const droughtCrust = dry * smoothstep(4, 31, slope) * (0.52 + micro * 0.48);
  const autumnLitter = litter * (0.46 + noise(x / 54, z / 54, 0x8120) * 0.54);
  const freezeDry = cold * (0.22 + dry * 0.34 + smoothstep(150, 580, h) * 0.44);
  const seasonalContrast = clamp01(wet * 0.30 + dry * 0.27 + litter * 0.19 + cold * 0.24);
  return Object.freeze({ phase, regional, broad, micro, localClimate, wet, dry, litter, cold, frost, wetFilm, droughtCrust, autumnLitter, freezeDry, seasonalContrast });
}

export function resolveTerrainSeasonalMaterialResponse({ state, baseColor, baseRoughness = 0.86 }) {
  const wet = state.wetFilm; const dry = state.droughtCrust; const litter = state.autumnLitter; const cold = state.freezeDry;
  const color = Object.freeze({
    r: clamp01(baseColor.r - wet * 0.018 + dry * 0.028 + litter * 0.022 - cold * 0.010),
    g: clamp01(baseColor.g - wet * 0.024 + dry * 0.020 + litter * 0.012 - cold * 0.006),
    b: clamp01(baseColor.b + wet * 0.022 - dry * 0.008 + litter * 0.016 + cold * 0.024),
  });
  const roughness = clamp01(baseRoughness + dry * 0.042 + cold * 0.031 + litter * 0.020 - wet * 0.092);
  const normalStrength = clamp01(wet * 0.022 + dry * 0.026 + litter * 0.018 + cold * 0.019) * 0.94;
  return Object.freeze({ color, roughness, normalStrength });
}

export const TERRAIN_SEASONAL_GLSL = String.raw`
float terrainSeasonHash(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float terrainSeasonNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float a=terrainSeasonHash(i),b=terrainSeasonHash(i+vec2(1,0)),c=terrainSeasonHash(i+vec2(0,1)),d=terrainSeasonHash(i+vec2(1,1));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float terrainSeasonFbm(vec2 p){float v=0.,w=0.,a=.55;for(int i=0;i<4;i++){v+=terrainSeasonNoise(p)*a;w+=a;p=p*2.03+vec2(7.2,-6.1);a*=.49;}return v/w;}
float terrainSeasonPulse(float phase,float center,float width){float d=abs(phase-center);d=min(d,1.-d);return 1.-smoothstep(0.,width,d);}
void terrainSeasonalApplyColor(){vec2 p=vTerrainLowWorldPosition.xz;float h=vTerrainLowWorldPosition.y;vec3 base=diffuseColor.rgb;float phase=.34;float broad=terrainSeasonFbm(p/1800.+vec2(5.1,-7.2));float micro=terrainSeasonFbm(p/24.+vec2(8.3,-4.1));float local=clamp(.50+(1.-broad)*.32,0.,1.);float wet=terrainSeasonPulse(phase,.12,.14)*(.58+local*.42);float dry=terrainSeasonPulse(phase,.58,.14)*(.40+(1.-local)*.60);float litter=terrainSeasonPulse(phase,.78,.14)*(.64+local*.36)*(.48+smoothstep(20.,180.,h)*.52);float cold=terrainSeasonPulse(phase,.94,.14)*(.52+smoothstep(120.,620.,h)*.48);float film=wet*(1.-smoothstep(.035,.42,1.-abs(normalize(vTerrainLowWorldNormal).y)))*(.44+micro*.56);float crust=dry*smoothstep(.07,.52,1.-abs(normalize(vTerrainLowWorldNormal).y))*(.52+micro*.48);float leaf=litter*(.46+terrainSeasonNoise(p/54.+vec2(4.2,-7.1))*.54);float freezeDry=cold*(.22+dry*.34+smoothstep(150.,580.,h)*.44);float snow=smoothstep(.58,.88,dot(base,vec3(.2126,.7152,.0722)))*(1.-smoothstep(.08,.24,max(base.r,max(base.g,base.b))-min(base.r,min(base.g,base.b))));float mask=1.-snow*.78;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.33,.41,.44),film*.060*mask);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.47,.39,.27),crust*.035*mask);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.23,.20,.13),leaf*.045*mask);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.42,.48,.52),freezeDry*.028*mask);}
void terrainSeasonalApplyRoughness(){vec2 p=vTerrainLowWorldPosition.xz;float broad=terrainSeasonFbm(p/1800.+vec2(5.1,-7.2));float micro=terrainSeasonFbm(p/24.+vec2(8.3,-4.1));float wet=terrainSeasonPulse(.34,.12,.14)*(.58+(1.-broad)*.42);float dry=terrainSeasonPulse(.34,.58,.14)*(.40+broad*.60);roughnessFactor=clamp(roughnessFactor+dry*.045+micro*.018-wet*.088,0.42,1.0);}
void terrainSeasonalApplyNormal(){vec2 p=vTerrainLowWorldPosition.xz;float slope=1.-clamp(abs(normalize(vTerrainLowWorldNormal).y),0.,1.);float a=terrainSeasonFbm(p/31.+vec2(3.2,-4.6));float b=terrainSeasonFbm(p/31.+vec2(4.1,-3.8));vec2 g=vec2(b-a,terrainSeasonNoise(p/18.+vec2(-7.2,11.4))-.5);float mask=clamp(slope*.42+(1.-slope)*.18,0.,1.);normal=normalize(normal+mat3(viewMatrix)*vec3(-g.x,0.,-g.y)*mask*.065);}
`;

export function installTerrainSeasonal(material) {
  if (!material) throw new TypeError('terrain seasonal response requires a material');
  if (material.userData?.terrainSeasonalSurfaceInstalled) return material;
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${TERRAIN_SEASONAL_GLSL}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nterrainSeasonalApplyColor();');
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nterrainSeasonalApplyRoughness();');
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nterrainSeasonalApplyNormal();');
  };
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}|${TERRAIN_SEASONAL_POLICY.materialKey}`;
  material.userData = { ...material.userData, terrainSeasonalSurfaceInstalled: true, terrainSeasonalPolicyId: TERRAIN_SEASONAL_POLICY.id, terrainSeasonalRenderOnly: true, terrainSeasonalCanonicalHeightUnchanged: true, terrainSeasonalCanonicalHydrologyUnchanged: true, terrainSeasonalCanonicalColliderUnchanged: true, terrainSeasonalCanonicalVegetationPlacementUnchanged: true };
  material.needsUpdate = true;
  return material;
}
