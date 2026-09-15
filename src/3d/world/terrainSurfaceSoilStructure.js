/**
 * World-space soil structure response: micro-aggregates, pore variation, crack rims and compacted
 * mineral patches. Render-only and deterministic; it does not alter terrain geometry or gameplay.
 */
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / Math.max(1e-9, b - a)); return t * t * (3 - 2 * t); };

export const TERRAIN_SOIL_STRUCTURE_POLICY = Object.freeze({
  id: 'terrain-surface-soil-structure-2026-09-15-v1-aggregate-pore-crack',
  renderOnly: true, deterministic: true,
  canonicalHeightUnchanged: true, canonicalHydrologyUnchanged: true,
  canonicalCoastlineUnchanged: true, canonicalColliderUnchanged: true,
  canonicalVegetationPlacementUnchanged: true, newGeographyIntroduced: false,
  aggregateScaleMeters: Object.freeze([28, 11, 3.8]),
  poreScaleMeters: Object.freeze([8.5, 3.1]),
  crackScaleMeters: Object.freeze([62, 17]),
  compactionScaleMeters: 145,
  mineralScaleMeters: 94,
  lowlandHeightMeters: Object.freeze([4, 185]),
  slopeBandDegrees: Object.freeze([2, 27]),
  moistureBand: Object.freeze([0.25, 0.82]),
  maxColorShift: 0.085,
  maxRoughnessShift: 0.115,
  maxNormalStrength: 0.072,
  materialKey: 'terrain-surface-soil-structure-v1',
});

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
  let v = 0; let w = 0; let a = 0.55;
  for (let i = 0; i < octaves; i += 1) { v += noise(x, z, seed + i * 71) * a; w += a; x = x * 2.02 + 6.8; z = z * 2.03 - 5.9; a *= 0.49; }
  return v / Math.max(w, 1e-9);
}
function ridge(x, z, seed) { return 1 - Math.abs(fbm(x, z, seed) * 2 - 1); }

function organicSignal(base) {
  const max = Math.max(base.r, base.g, base.b); const min = Math.min(base.r, base.g, base.b);
  return clamp01(smoothstep(0.006, 0.085, base.g - Math.max(base.r, base.b)) * (0.46 + (max - min) * 1.9));
}

export function resolveTerrainSoilStructure({ worldX, worldZ, heightMeters, slopeDegrees = 0, moisture = 0.5, baseColor = { r: 0.34, g: 0.39, b: 0.23 } }) {
  const x = Number(worldX) || 0; const z = Number(worldZ) || 0; const h = Number(heightMeters) || 0; const slope = Number(slopeDegrees) || 0; const m = clamp01(Number(moisture) || 0);
  const broad = fbm(x / 145, z / 145, 0x7010, 5);
  const regional = fbm(x / 620, z / 620, 0x7011, 4);
  const aggregate = ridge(x / 28, z / 41, 0x7012) * 0.62 + ridge(x / 11, z / 17, 0x7013) * 0.38;
  const pore = fbm(x / 8.5, z / 8.5, 0x7014, 4) * 0.64 + noise(x / 3.1, z / 3.1, 0x7015) * 0.36;
  const crackField = ridge(x / 62, z / 17, 0x7016);
  const crackFine = ridge(x / 21, z / 7.5, 0x7017);
  const compaction = clamp01(fbm(x / 145, z / 145, 0x7018, 4) * 0.62 + ridge(x / 38, z / 38, 0x7019) * 0.38);
  const mineral = clamp01(fbm(x / 94, z / 94, 0x7020, 4) * 0.58 + ridge(x / 23, z / 31, 0x7021) * 0.42);
  const lowland = 1 - smoothstep(4, 185, h);
  const slopeMask = 1 - smoothstep(2, 27, slope);
  const wetness = clamp01(m * 0.58 + (1 - broad) * 0.24 + (1 - regional) * 0.18);
  const organic = organicSignal(baseColor);
  const aggregateBreakup = clamp01((0.24 + aggregate * 0.76) * (0.36 + slopeMask * 0.42 + lowland * 0.22));
  const poreNetwork = clamp01(pore * (0.38 + organic * 0.22 + mineral * 0.40));
  const crackRim = clamp01((crackField * 0.62 + crackFine * 0.38) * (1 - wetness * 0.42) * (0.35 + slopeMask * 0.28 + compaction * 0.37));
  const compacted = clamp01(compaction * (0.42 + (1 - wetness) * 0.34 + mineral * 0.24) * (0.60 + slopeMask * 0.40));
  const friability = clamp01(poreNetwork * 0.48 + aggregateBreakup * 0.31 + organic * 0.21);
  const mineralSurface = clamp01(mineral * 0.56 + compacted * 0.26 + crackRim * 0.18);
  const soilSkin = clamp01(lowland * 0.34 + slopeMask * 0.26 + (1 - smoothstep(0, 250, h)) * 0.12 + organic * 0.28);
  return Object.freeze({ broad, regional, aggregate, pore, crackField, crackFine, compaction, mineral, lowland, slopeMask, wetness, organic, aggregateBreakup, poreNetwork, crackRim, compacted, friability, mineralSurface, soilSkin });
}

export function resolveTerrainSoilStructureMaterialResponse({ state, baseColor, baseRoughness = 0.86 }) {
  const soft = state.friability * 0.034; const mineral = state.mineralSurface * 0.025; const crack = state.crackRim * 0.018; const compact = state.compacted * 0.022;
  const color = Object.freeze({
    r: clamp01(baseColor.r - soft * 0.68 + mineral * 0.88 + crack * 0.42 + compact * 0.20),
    g: clamp01(baseColor.g - soft * 0.42 + mineral * 0.58 + crack * 0.30 + compact * 0.16),
    b: clamp01(baseColor.b - soft * 0.24 + mineral * 0.34 + crack * 0.20 + compact * 0.10),
  });
  const roughness = clamp01(baseRoughness + state.aggregateBreakup * 0.052 + state.crackRim * 0.034 + state.compacted * 0.028 - state.poreNetwork * 0.047);
  const normalStrength = clamp01(state.aggregateBreakup * 0.026 + state.poreNetwork * 0.021 + state.crackRim * 0.016 + state.mineralSurface * 0.009) * 0.94;
  return Object.freeze({ color, roughness, normalStrength });
}

export const TERRAIN_SOIL_STRUCTURE_CANONICAL_INVARIANTS = Object.freeze([
  'canonicalHeightUnchanged', 'canonicalHydrologyUnchanged', 'canonicalCoastlineUnchanged',
  'canonicalColliderUnchanged', 'canonicalVegetationPlacementUnchanged', 'newGeographyIntroduced:false',
]);

export const TERRAIN_SOIL_STRUCTURE_GLSL = String.raw`
float terrainSoilHash(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float terrainSoilNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float a=terrainSoilHash(i),b=terrainSoilHash(i+vec2(1,0)),c=terrainSoilHash(i+vec2(0,1)),d=terrainSoilHash(i+vec2(1,1));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float terrainSoilFbm(vec2 p){float v=0.,w=0.,a=.55;for(int i=0;i<4;i++){v+=terrainSoilNoise(p)*a;w+=a;p=p*2.02+vec2(6.8,-5.9);a*=.49;}return v/w;}
float terrainSoilRidge(vec2 p){return 1.-abs(terrainSoilFbm(p)*2.-1.);}
void terrainSoilStructureApplyColor(){vec2 p=vTerrainLowWorldPosition.xz;vec3 base=diffuseColor.rgb;float h=vTerrainLowWorldPosition.y;float slope=1.-clamp(abs(normalize(vTerrainLowWorldNormal).y),0.,1.);float organic=smoothstep(.006,.085,base.g-max(base.r,base.b));float aggregate=terrainSoilRidge(p/vec2(28.,41.))*.62+terrainSoilRidge(p/vec2(11.,17.))*.38;float pore=terrainSoilFbm(p/8.5)*.64+terrainSoilNoise(p/3.1)*.36;float crack=terrainSoilRidge(p/vec2(62.,17.))*.62+terrainSoilRidge(p/vec2(21.,7.5))*.38;float compact=terrainSoilFbm(p/145.+vec2(8.2,-4.7))*.62+terrainSoilRidge(p/38.+vec2(-11.2,6.4))*.38;float mineral=terrainSoilFbm(p/94.+vec2(3.6,11.1))*.58+terrainSoilRidge(p/vec2(23.,31.)+vec2(-5.7,8.3))*.42;float lowland=1.-smoothstep(4.,185.,h);float slopeMask=1.-smoothstep(.035,.46,slope);float wet=clamp(.50+organic*.14+(1.-terrainSoilFbm(p/145.+vec2(7.1,-3.9)))*.36,0.,1.);float agg=clamp((.24+aggregate*.76)*(.36+slopeMask*.42+lowland*.22),0.,1.);float pores=clamp(pore*(.38+organic*.22+mineral*.40),0.,1.);float crackR=clamp(crack*(1.-wet*.42)*(.35+slopeMask*.28+compact*.37),0.,1.);float skin=clamp(lowland*.34+slopeMask*.26+organic*.28,0.,1.);float mask=(1.-smoothstep(.58,.90,dot(base,vec3(.2126,.7152,.0722))));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.45,.37,.27),agg*.028*mask);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.39,.35,.29),pores*.020*mask);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.50,.42,.31),crackR*.020*mask);diffuseColor.rgb+=vec3(.006,.005,.003)*skin*mask;}
void terrainSoilStructureApplyRoughness(){vec2 p=vTerrainLowWorldPosition.xz;float aggregate=terrainSoilRidge(p/vec2(28.,41.))*.62+terrainSoilRidge(p/vec2(11.,17.))*.38;float pore=terrainSoilFbm(p/8.5);float crack=terrainSoilRidge(p/vec2(62.,17.));float compact=terrainSoilFbm(p/145.+vec2(8.2,-4.7));roughnessFactor=clamp(roughnessFactor+aggregate*.045+crack*.032+compact*.020-pore*.040,0.42,1.0);}
void terrainSoilStructureApplyNormal(){vec2 p=vTerrainLowWorldPosition.xz;float slope=1.-clamp(abs(normalize(vTerrainLowWorldNormal).y),0.,1.);float organic=smoothstep(.006,.085,diffuseColor.g-max(diffuseColor.r,diffuseColor.b));float aggregate=terrainSoilRidge(p/11.+vec2(2.4,-5.3));float pore=terrainSoilFbm(p/8.5+vec2(5.1,3.2));float crack=terrainSoilRidge(p/31.+vec2(-7.9,12.1));vec2 g=vec2(aggregate-.5,pore-.5);normal=normalize(normal+mat3(viewMatrix)*vec3(-g.x,0.,-g.y)*(slope*.44+organic*.24+crack*.20)*.072);}
`;

export function installTerrainSoilStructure(material) {
  if (!material) throw new TypeError('terrain soil structure requires a material');
  if (material.userData?.terrainSoilStructureInstalled) return material;
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${TERRAIN_SOIL_STRUCTURE_GLSL}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nterrainSoilStructureApplyColor();');
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nterrainSoilStructureApplyRoughness();');
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nterrainSoilStructureApplyNormal();');
  };
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}|${TERRAIN_SOIL_STRUCTURE_POLICY.materialKey}`;
  material.userData = { ...material.userData, terrainSoilStructureInstalled: true, terrainSoilStructurePolicyId: TERRAIN_SOIL_STRUCTURE_POLICY.id, terrainSoilStructureRenderOnly: true, terrainSoilStructureCanonicalHeightUnchanged: true, terrainSoilStructureCanonicalHydrologyUnchanged: true, terrainSoilStructureCanonicalColliderUnchanged: true };
  material.needsUpdate = true;
  return material;
}
