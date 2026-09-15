/**
 * Deterministic organic-litter and biogenic-soil surface response.
 *
 * Material-only. It reads the already authored terrain color, height and slope and adds subtle
 * litter mats, dark humus pockets, moss-biocrust traces and exposed mineral-soil breakup. No
 * vegetation instances, terrain vertices, hydrology, roads or colliders are created or moved.
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / Math.max(1e-9, b - a));
  return t * t * (3 - 2 * t);
};

export const TERRAIN_BIOGENIC_POLICY = Object.freeze({
  id: 'terrain-surface-biogenic-2026-09-15-v1-organic-litter-biocrust',
  renderOnly: true,
  deterministic: true,
  canonicalHeightUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalCoastlineUnchanged: true,
  canonicalColliderUnchanged: true,
  canonicalVegetationPlacementUnchanged: true,
  newGeographyIntroduced: false,
  litterScaleMeters: Object.freeze([72, 31, 9]),
  humusScaleMeters: Object.freeze([220, 64, 18]),
  biocrustScaleMeters: Object.freeze([38, 12, 4.5]),
  decompositionScaleMeters: 260,
  moistureScaleMeters: 520,
  lowlandHeightMeters: Object.freeze([8, 150]),
  forestHeightMeters: Object.freeze([20, 260]),
  heathHeightMeters: Object.freeze([55, 360]),
  slopeLimitDegrees: 22,
  moistureMinimum: 0.34,
  maxAlbedoShift: 0.11,
  maxRoughnessShift: 0.10,
  maxNormalStrength: 0.075,
  materialKey: 'terrain-surface-biogenic-v1',
});

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
    value += noise(x, z, seed + i * 79) * amp;
    weight += amp;
    x = x * 2.03 + 8.1;
    z = z * 2.03 - 6.3;
    amp *= 0.49;
  }
  return value / Math.max(weight, 1e-9);
}

function ridge(x, z, seed) {
  return 1 - Math.abs(fbm(x, z, seed) * 2 - 1);
}

function vegetationSignal(base) {
  const max = Math.max(base.r, base.g, base.b);
  const min = Math.min(base.r, base.g, base.b);
  const greenLead = base.g - Math.max(base.r, base.b);
  const chroma = max - min;
  return clamp01(smoothstep(0.006, 0.09, greenLead) * (0.50 + chroma * 2.2) * (1 - smoothstep(0.70, 0.90, max)));
}

function snowSignal(base) {
  const luma = base.r * 0.2126 + base.g * 0.7152 + base.b * 0.0722;
  const max = Math.max(base.r, base.g, base.b);
  const min = Math.min(base.r, base.g, base.b);
  return clamp01(smoothstep(0.60, 0.88, luma) * (1 - smoothstep(0.08, 0.22, max - min)));
}

export function resolveTerrainBiogenicState({
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
  const slope = Number(slopeDegrees) || 0;
  const m = clamp01(Number(moisture) || 0);
  const organicDomain = fbm(x / 720, z / 720, 0x5310, 5);
  const decomposition = fbm(x / TERRAIN_BIOGENIC_POLICY.decompositionScaleMeters, z / TERRAIN_BIOGENIC_POLICY.decompositionScaleMeters, 0x5311, 4);
  const moistureField = clamp01(m * 0.64 + (1 - organicDomain) * 0.22 + (1 - decomposition) * 0.14);
  const vegetation = vegetationSignal(baseColor);
  const snow = snowSignal(baseColor);
  const gentle = 1 - smoothstep(5, TERRAIN_BIOGENIC_POLICY.slopeLimitDegrees, slope);
  const lowland = 1 - smoothstep(40, 180, h);
  const forestBand = smoothstep(20, 55, h) * (1 - smoothstep(220, 310, h));
  const heathBand = smoothstep(55, 140, h) * (1 - smoothstep(300, 390, h));
  const litterBroad = fbm(x / 72, z / 72, 0x5320, 4);
  const litterFine = ridge(x / 31, z / 31, 0x5321);
  const litterMicro = noise(x / 9, z / 9, 0x5322);
  const humusBroad = fbm(x / 220, z / 220, 0x5330, 4);
  const humusFine = ridge(x / 64, z / 64, 0x5331);
  const biocrustBroad = fbm(x / 38, z / 38, 0x5340, 4);
  const biocrustFine = ridge(x / 12, z / 12, 0x5341);
  const pore = noise(x / 4.5, z / 4.5, 0x5350);
  const litterHabitat = clamp01((vegetation * 0.62 + forestBand * 0.17 + heathBand * 0.11 + lowland * 0.10) * gentle);
  const litter = clamp01(litterHabitat * (0.40 + litterBroad * 0.36 + litterFine * 0.18 + litterMicro * 0.06));
  const humus = clamp01(litter * (0.32 + humusBroad * 0.42 + humusFine * 0.26) * (0.50 + moistureField * 0.50));
  const moss = clamp01(vegetation * smoothstep(TERRAIN_BIOGENIC_POLICY.moistureMinimum, 0.78, moistureField) * (0.38 + biocrustBroad * 0.34 + biocrustFine * 0.28) * gentle);
  const dryCrust = clamp01((1 - moistureField) * (1 - litter * 0.45) * (0.36 + decomposition * 0.64));
  const mineralExposure = clamp01((1 - litter * 0.55 - humus * 0.30) * (0.38 + ridge(x / 42, z / 58, 0x5360) * 0.42) * (0.72 + gentle * 0.28));
  const decompositionAge = clamp01((1 - decomposition) * 0.52 + humus * 0.33 + moistureField * 0.15);
  const poreStructure = clamp01(pore * 0.52 + humus * 0.28 + litter * 0.20);
  const effectiveOrganic = clamp01(litter * 0.50 + humus * 0.30 + moss * 0.20);
  return Object.freeze({
    organicDomain,
    decomposition,
    moistureField,
    vegetation,
    snow,
    gentle,
    lowland,
    forestBand,
    heathBand,
    litterBroad,
    litterFine,
    litterMicro,
    humusBroad,
    humusFine,
    biocrustBroad,
    biocrustFine,
    pore,
    litterHabitat,
    litter,
    humus,
    moss,
    dryCrust,
    mineralExposure,
    decompositionAge,
    poreStructure,
    effectiveOrganic,
  });
}

export function resolveTerrainBiogenicMaterialResponse({ state, baseColor, baseRoughness = 0.86 }) {
  const organic = state.effectiveOrganic;
  const darkening = state.humus * 0.060 + state.litter * 0.022;
  const green = state.moss * 0.035;
  const dry = state.dryCrust * 0.025;
  const mineral = state.mineralExposure * 0.018;
  const color = Object.freeze({
    r: clamp01(baseColor.r - darkening * 0.92 + dry * 0.60 + mineral * 0.35),
    g: clamp01(baseColor.g - darkening * 0.58 + green + dry * 0.32 + mineral * 0.15),
    b: clamp01(baseColor.b - darkening * 0.30 + green * 0.70 + mineral * 0.08),
  });
  const roughness = clamp01(baseRoughness + state.poreStructure * 0.052 + state.mineralExposure * 0.030 - state.humus * 0.078 - state.moss * 0.018);
  const normalStrength = clamp01(state.litter * 0.034 + state.humus * 0.026 + state.mineralExposure * 0.015 + state.moss * 0.010) * 0.95;
  return Object.freeze({ color, roughness, normalStrength, organic, darkening, mineral });
}

export const TERRAIN_BIOGENIC_CANONICAL_INVARIANTS = Object.freeze([
  'canonicalHeightUnchanged',
  'canonicalHydrologyUnchanged',
  'canonicalCoastlineUnchanged',
  'canonicalColliderUnchanged',
  'canonicalVegetationPlacementUnchanged',
  'newGeographyIntroduced:false',
]);

export const TERRAIN_BIOGENIC_GLSL = String.raw`
float terrainBioHash(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float terrainBioNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float a=terrainBioHash(i),b=terrainBioHash(i+vec2(1,0)),c=terrainBioHash(i+vec2(0,1)),d=terrainBioHash(i+vec2(1,1));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float terrainBioFbm(vec2 p){float v=0.,w=0.,a=.55;for(int i=0;i<4;i++){v+=terrainBioNoise(p)*a;w+=a;p=p*2.03+vec2(8.1,-6.3);a*=.49;}return v/w;}
float terrainBioRidge(vec2 p){return 1.-abs(terrainBioFbm(p)*2.-1.);}
float terrainBioVegetation(vec3 base){return clamp(smoothstep(.006,.09,base.g-max(base.r,base.b))*(.50+(max(base.r,max(base.g,base.b))-min(base.r,min(base.g,base.b)))*2.2)*(1.-smoothstep(.70,.90,max(base.r,max(base.g,base.b)))),0.,1.);}
float terrainBioSnow(vec3 base){float l=dot(base,vec3(.2126,.7152,.0722));float c=max(base.r,max(base.g,base.b))-min(base.r,min(base.g,base.b));return clamp(smoothstep(.60,.88,l)*(1.-smoothstep(.08,.22,c)),0.,1.);}
void terrainBiogenicApplyColor(){vec3 base=diffuseColor.rgb;vec2 p=vTerrainLowWorldPosition.xz;float h=vTerrainLowWorldPosition.y;vec3 n=normalize(vTerrainLowWorldNormal);float slope=1.-clamp(abs(n.y),0.,1.);float veg=terrainBioVegetation(base);float snow=terrainBioSnow(base);float domain=terrainBioFbm(p/720.+vec2(5.4,-8.2));float moisture=clamp(.52+(1.-domain)*.25+terrainBioFbm(p/2600.+vec2(-7.1,11.2))*.10,0.,1.);float gentle=1.-smoothstep(.09,.38,slope);float lowland=1.-smoothstep(40.,180.,h);float litter=clamp((veg*.62+gentle*.20+lowland*.18)*(0.38+terrainBioFbm(p/72.+vec2(7.2,-4.8))*.38+terrainBioRidge(p/31.+vec2(-11.4,5.6))*.24),0.,1.);float humus=litter*(.34+terrainBioFbm(p/220.+vec2(12.4,-5.1))*.40+terrainBioRidge(p/64.+vec2(4.7,-13.2))*.26)*(0.50+moisture*.50);float moss=clamp(veg*smoothstep(.34,.78,moisture)*(0.36+terrainBioFbm(p/38.+vec2(9.1,-7.2))*.35+terrainBioRidge(p/12.+vec2(-3.4,14.7))*.29)*gentle,0.,1.);float dry=(1.-moisture)*(1.-litter*.45)*(.38+terrainBioFbm(p/260.+vec2(-8.4,6.1))*.62);float mineral=clamp((1.-litter*.55-humus*.30)*(.40+terrainBioRidge(p/42.+vec2(8.7,12.1))*.42),0.,1.);float mask=1.-snow*.78;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.12,.14,.08),humus*.11*mask);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.08,.15,.08),moss*.055*mask);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.42,.34,.23),dry*.022*mask);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.40,.36,.29),mineral*.025*mask);diffuseColor.rgb=clamp(diffuseColor.rgb,vec3(.01),vec3(.90));}
void terrainBiogenicApplyRoughness(){vec2 p=vTerrainLowWorldPosition.xz;vec3 n=normalize(vTerrainLowWorldNormal);float slope=1.-clamp(abs(n.y),0.,1.);float veg=terrainBioVegetation(diffuseColor.rgb);float domain=terrainBioFbm(p/720.+vec2(5.4,-8.2));float moisture=clamp(.52+(1.-domain)*.25,0.,1.);float litter=clamp((veg*.64+(1.-smoothstep(.09,.38,slope))*.18)*(.40+terrainBioFbm(p/72.+vec2(7.2,-4.8))*.60),0.,1.);float humus=litter*(.34+terrainBioFbm(p/220.+vec2(12.4,-5.1))*.66)*(0.50+moisture*.50);float pore=terrainBioNoise(p/4.5+vec2(2.3,-7.2));roughnessFactor=clamp(roughnessFactor+pore*.032+litter*.020-humus*.082,0.42,1.0);}
void terrainBiogenicApplyNormal(){vec2 p=vTerrainLowWorldPosition.xz;vec3 n=normalize(vTerrainLowWorldNormal);float slope=1.-clamp(abs(n.y),0.,1.);float veg=terrainBioVegetation(diffuseColor.rgb);float mask=veg*(1.-smoothstep(.34,.72,slope));float a=terrainBioFbm(p/18.+vec2(2.4,-5.3));float b=terrainBioFbm(p/18.+vec2(3.0,-4.8));float c=terrainBioRidge(p/48.+vec2(-7.9,13.1));vec2 g=vec2(b-a,c-.5);normal=normalize(normal+mat3(viewMatrix)*vec3(-g.x,0.,-g.y)*mask*.075);}
`;

export function installTerrainBiogenic(material) {
  if (!material) throw new TypeError('terrain biogenic response requires a material');
  if (material.userData?.terrainBiogenicSurfaceInstalled) return material;
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${TERRAIN_BIOGENIC_GLSL}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nterrainBiogenicApplyColor();');
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nterrainBiogenicApplyRoughness();');
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nterrainBiogenicApplyNormal();');
  };
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}|${TERRAIN_BIOGENIC_POLICY.materialKey}`;
  material.userData = {
    ...material.userData,
    terrainBiogenicSurfaceInstalled: true,
    terrainBiogenicPolicyId: TERRAIN_BIOGENIC_POLICY.id,
    terrainBiogenicRenderOnly: true,
    terrainBiogenicCanonicalHeightUnchanged: true,
    terrainBiogenicCanonicalHydrologyUnchanged: true,
    terrainBiogenicCanonicalCoastlineUnchanged: true,
    terrainBiogenicCanonicalColliderUnchanged: true,
    terrainBiogenicCanonicalVegetationPlacementUnchanged: true,
  };
  material.needsUpdate = true;
  return material;
}
