/**
 * Deterministic sediment, rainwash and transient surface-film model.
 * Material-only: no terrain geometry or gameplay state is mutated.
 */
import { TERRAIN_SEDIMENT_PROFILES, sedimentProfileIndex } from './terrainSurfaceSedimentProfiles.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / Math.max(1e-9, b - a));
  return t * t * (3 - 2 * t);
};

export const TERRAIN_SEDIMENT_POLICY = Object.freeze({
  id: 'terrain-surface-sediment-2026-09-15-v1-rainwash-catchment-film',
  renderOnly: true,
  deterministic: true,
  canonicalHeightUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalCoastlineUnchanged: true,
  canonicalColliderUnchanged: true,
  canonicalVegetationPlacementUnchanged: true,
  newGeographyIntroduced: false,
  broadScaleMeters: 760,
  mesoScaleMeters: 190,
  basinScaleMeters: 96,
  rillScaleMeters: 31,
  aggregateScaleMeters: 13,
  poreScaleMeters: 4.2,
  filmScaleMeters: 52,
  profileCount: TERRAIN_SEDIMENT_PROFILES.length,
  rainBearingRadians: 1.12,
  basinSlopeDegrees: Object.freeze([1.5, 9.5]),
  washSlopeDegrees: Object.freeze([4, 31]),
  strongWashSlopeDegrees: Object.freeze([18, 44]),
  lowlandHeightMeters: Object.freeze([-2, 170]),
  dryHeightMeters: Object.freeze([45, 520]),
  maxAlbedoShift: 0.19,
  maxRoughnessShift: 0.13,
  maxNormalStrength: 0.095,
  materialKey: 'terrain-surface-sediment-rainwash-v1',
});

function hash2D(ix, iz, seed) {
  let x = Math.imul((ix | 0) ^ seed, 0x45d9f3b);
  let z = Math.imul((iz | 0) + seed, 0x119de1f3);
  let value = x ^ z;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function valueNoise(x, z, seed) {
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
  let total = 0;
  let weight = 0;
  let amplitude = 0.55;
  for (let i = 0; i < octaves; i += 1) {
    total += valueNoise(x, z, seed + i * 73) * amplitude;
    weight += amplitude;
    x = x * 2.03 + 11.2;
    z = z * 2.03 - 7.9;
    amplitude *= 0.48;
  }
  return total / Math.max(1e-9, weight);
}

function ridge(x, z, seed) {
  return 1 - Math.abs(fbm(x, z, seed) * 2 - 1);
}

function rotate(x, z, radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: x * c - z * s, z: x * s + z * c };
}

function profileField(worldX, worldZ) {
  const regional = fbm(worldX / 5200, worldZ / 5200, 0x3101, 5);
  const broad = fbm(worldX / TERRAIN_SEDIMENT_POLICY.broadScaleMeters, worldZ / TERRAIN_SEDIMENT_POLICY.broadScaleMeters, 0x3102, 4);
  const meso = fbm(worldX / TERRAIN_SEDIMENT_POLICY.mesoScaleMeters, worldZ / TERRAIN_SEDIMENT_POLICY.mesoScaleMeters, 0x3103, 4);
  return clamp01(regional * 0.45 + broad * 0.35 + meso * 0.20);
}

function profileAt(worldX, worldZ) {
  const field = profileField(worldX, worldZ);
  const index = sedimentProfileIndex(field);
  const next = (index + 1) % TERRAIN_SEDIMENT_PROFILES.length;
  const blend = smoothstep(0.35, 0.88, valueNoise(worldX / 240, worldZ / 240, 0x3104));
  const left = TERRAIN_SEDIMENT_PROFILES[index];
  const right = TERRAIN_SEDIMENT_PROFILES[next];
  return Object.freeze({
    index,
    field,
    blend,
    deposit: lerp(left.deposit, right.deposit, blend),
    wash: lerp(left.wash, right.wash, blend),
    film: lerp(left.film, right.film, blend),
    crust: lerp(left.crust, right.crust, blend),
    aggregate: lerp(left.aggregate, right.aggregate, blend),
    cool: lerp(left.cool, right.cool, blend),
  });
}

function basinSignal(worldX, worldZ, heightMeters, slopeDegrees) {
  const broad = fbm(worldX / 760, worldZ / 760, 0x4210, 5);
  const meso = fbm(worldX / 190, worldZ / 190, 0x4211, 4);
  const pocket = ridge(worldX / 96, worldZ / 96, 0x4212);
  const lowland = 1 - smoothstep(95, 240, heightMeters);
  const gentle = 1 - smoothstep(1.5, 9.5, slopeDegrees);
  return clamp01((gentle * 0.48 + lowland * 0.18 + (1 - broad) * 0.18 + pocket * 0.16) * (0.58 + meso * 0.42));
}

function rainwashSignal(worldX, worldZ, slopeDegrees, basin) {
  const rainAxis = rotate(worldX, worldZ, TERRAIN_SEDIMENT_POLICY.rainBearingRadians);
  const directional = fbm(rainAxis.x / 31, rainAxis.z / 31, 0x4310, 4);
  const cross = fbm(rainAxis.z / 53, rainAxis.x / 23, 0x4311, 3);
  const channel = ridge(worldX / 31, worldZ / 83, 0x4312);
  const washSlope = smoothstep(4, 31, slopeDegrees);
  const strong = smoothstep(18, 44, slopeDegrees);
  const lane = smoothstep(0.55, 0.86, channel * 0.55 + directional * 0.30 + cross * 0.15);
  return clamp01(washSlope * (0.30 + basin * 0.44 + lane * 0.44) + strong * 0.16);
}

function aggregateSignal(worldX, worldZ) {
  const primary = ridge(worldX / 13, worldZ / 21, 0x4410);
  const secondary = fbm(worldX / 37, worldZ / 37, 0x4411, 3);
  return clamp01(primary * 0.68 + secondary * 0.32);
}

function filmSignal(worldX, worldZ, basin, slopeDegrees) {
  const storm = fbm(worldX / 52, worldZ / 52, 0x4510, 4);
  const micro = valueNoise(worldX / 28, worldZ / 28, 0x4511);
  const shallow = 1 - smoothstep(3, 24, slopeDegrees);
  return clamp01(basin * (0.28 + storm * 0.50 + micro * 0.22) * shallow);
}

function crustSignal(worldX, worldZ, heightMeters, basin, wash) {
  const drying = fbm(worldX / 410, worldZ / 410, 0x4610, 4);
  const warm = smoothstep(45, 520, heightMeters);
  return clamp01((1 - basin * 0.72) * warm * (1 - wash * 0.74) * (0.62 + drying * 0.38));
}

function microPoreSignal(worldX, worldZ) {
  const pore = valueNoise(worldX / 4.2, worldZ / 4.2, 0x4710);
  const pits = ridge(worldX / 7.5, worldZ / 5.8, 0x4711);
  return clamp01(pore * 0.55 + pits * 0.45);
}

function resolveStateInternal(worldX, worldZ, heightMeters, slopeDegrees) {
  const basin = basinSignal(worldX, worldZ, heightMeters, slopeDegrees);
  const broadWet = fbm(worldX / 1200, worldZ / 1200, 0x4810, 4);
  const catchment = clamp01(basin * 0.72 + (1 - broadWet) * 0.28);
  const wash = rainwashSignal(worldX, worldZ, slopeDegrees, catchment);
  const aggregate = aggregateSignal(worldX, worldZ);
  const film = filmSignal(worldX, worldZ, basin, slopeDegrees);
  const crust = crustSignal(worldX, worldZ, heightMeters, catchment, wash);
  const pore = microPoreSignal(worldX, worldZ);
  const profile = profileAt(worldX, worldZ);
  const sedimentLoad = clamp01(catchment * 0.40 + wash * 0.35 + profile.deposit * 0.15 + aggregate * 0.10);
  const mineralDeposit = clamp01(catchment * 0.36 + wash * 0.18 + profile.deposit * 0.24 + aggregate * 0.22);
  const muddyFilm = clamp01(film * 0.74 + catchment * 0.17 + profile.film * 0.09);
  const washBleach = clamp01(wash * 0.52 + aggregate * 0.20 + profile.wash * 0.28);
  const dryCrust = clamp01(crust * 0.78 + profile.crust * 0.22);
  const poreRoughness = clamp01(pore * 0.63 + aggregate * 0.37);
  const transient = clamp01(muddyFilm * 0.64 + dryCrust * 0.18 + film * 0.18);
  return Object.freeze({ basin, catchment, wash, aggregate, film, crust, pore, profile, sedimentLoad, mineralDeposit, muddyFilm, washBleach, dryCrust, poreRoughness, transient });
}

export function resolveTerrainSedimentState({ worldX, worldZ, heightMeters, slopeDegrees = 0 }) {
  return resolveStateInternal(Number(worldX) || 0, Number(worldZ) || 0, Number(heightMeters) || 0, Number(slopeDegrees) || 0);
}

export function resolveTerrainSedimentMaterialResponse({ state, baseColor, baseRoughness = 0.86 }) {
  const p = state.profile;
  const deposit = state.mineralDeposit * (0.72 + p.deposit * 0.28);
  const wet = state.muddyFilm * (0.76 + p.film * 0.24);
  const wash = state.washBleach * (0.76 + p.wash * 0.24);
  const crust = state.dryCrust * (0.78 + p.crust * 0.22);
  const aggregate = state.poreRoughness * (0.78 + p.aggregate * 0.22);
  const color = Object.freeze({
    r: clamp01(baseColor.r + deposit * 0.045 + wash * 0.020 + crust * 0.018 - wet * 0.022),
    g: clamp01(baseColor.g + deposit * 0.034 + wash * 0.012 + crust * 0.014 - wet * 0.030),
    b: clamp01(baseColor.b + deposit * 0.019 + wet * 0.027 - wash * 0.006),
  });
  const roughness = clamp01(baseRoughness + aggregate * 0.065 + crust * 0.032 - wet * 0.085);
  const normalStrength = clamp01(state.wash * 0.048 + aggregate * 0.031 + state.film * 0.016) * (0.76 + p.wash * 0.24);
  return Object.freeze({ color, roughness, normalStrength });
}

export function sedimentRegionSignature(worldX, worldZ) {
  const state = resolveStateInternal(Number(worldX) || 0, Number(worldZ) || 0, 70, 8);
  return Object.freeze({ profileIndex: state.profile.index, basin: Number(state.basin.toFixed(6)), wash: Number(state.wash.toFixed(6)), film: Number(state.film.toFixed(6)), crust: Number(state.crust.toFixed(6)), aggregate: Number(state.aggregate.toFixed(6)) });
}

export const TERRAIN_SEDIMENT_CANONICAL_INVARIANTS = Object.freeze([
  'canonicalHeightUnchanged', 'canonicalHydrologyUnchanged', 'canonicalCoastlineUnchanged', 'canonicalColliderUnchanged',
  'canonicalVegetationPlacementUnchanged', 'newGeographyIntroduced:false',
]);

export function installTerrainSediment(material) {
  if (!material) throw new TypeError('terrain sediment response requires a material');
  if (material.userData?.terrainSedimentSurfaceInstalled) return material;
  const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${TERRAIN_SEDIMENT_GLSL}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nterrainSedimentApplyColor();');
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nterrainSedimentApplyRoughness();');
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nterrainSedimentApplyNormal();');
  };
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}|${TERRAIN_SEDIMENT_POLICY.materialKey}`;
  material.userData = { ...material.userData, terrainSedimentSurfaceInstalled: true, terrainSedimentPolicyId: TERRAIN_SEDIMENT_POLICY.id, terrainSedimentRenderOnly: true, terrainSedimentCanonicalHeightUnchanged: true, terrainSedimentCanonicalHydrologyUnchanged: true, terrainSedimentCanonicalCoastlineUnchanged: true, terrainSedimentCanonicalColliderUnchanged: true };
  material.needsUpdate = true;
  return material;
}

export const TERRAIN_SEDIMENT_GLSL = String.raw`
float terrainSedHash(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float terrainSedNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float a=terrainSedHash(i),b=terrainSedHash(i+vec2(1,0)),c=terrainSedHash(i+vec2(0,1)),d=terrainSedHash(i+vec2(1,1));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float terrainSedFbm(vec2 p){float v=0.,w=0.,a=.55;for(int i=0;i<5;i++){v+=terrainSedNoise(p)*a;w+=a;p=p*2.03+vec2(11.2,-7.9);a*=.48;}return v/w;}
float terrainSedRidge(vec2 p){return 1.-abs(terrainSedFbm(p)*2.-1.);}
vec2 terrainSedRotate(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(p.x*c-p.y*s,p.x*s+p.y*c);}
void terrainSedimentApplyColor(){vec3 base=diffuseColor.rgb;float slope=1.-clamp(abs(normalize(vTerrainLowWorldNormal).y),0.,1.);vec2 p=vTerrainLowWorldPosition.xz;float basin=clamp((1.-smoothstep(1.5,9.5,slope))*.45+(1.-smoothstep(95.,240.,vTerrainLowWorldPosition.y))*.20+(1.-terrainSedFbm(p/760.+vec2(5.1,-3.8)))*.19+terrainSedRidge(p/96.+vec2(-7.4,8.2))*.16,0.,1.);float wash=smoothstep(4.,31.,slope)*(.32+basin*.45+smoothstep(.55,.86,terrainSedRidge(p/vec2(31.,83.)+vec2(4.6,-11.7)))*.39);float film=basin*(.28+terrainSedFbm(p/52.+vec2(-2.4,15.6))*.50+terrainSedNoise(p/28.+vec2(5.9,-7.1))*.22)*(1.-smoothstep(3.,24.,slope));float crust=(1.-basin*.72)*smoothstep(45.,520.,vTerrainLowWorldPosition.y)*(1.-wash*.74);float aggregate=terrainSedRidge(p/13.+vec2(2.2,18.1));float snow=smoothstep(.58,.88,dot(base,vec3(.2126,.7152,.0722)))*(1.-smoothstep(.08,.24,max(base.r,max(base.g,base.b))-min(base.r,min(base.g,base.b))));float mask=1.-snow*.72;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.38,.30,.22),basin*.10*mask);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.30,.36,.38),film*.06*mask);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.53,.48,.39),wash*.032*mask);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.47,.39,.28),crust*.025*mask);diffuseColor.rgb+=vec3(.008,.006,.003)*aggregate*mask;diffuseColor.rgb=clamp(diffuseColor.rgb,vec3(.01),vec3(.90));}
void terrainSedimentApplyRoughness(){float slope=1.-clamp(abs(normalize(vTerrainLowWorldNormal).y),0.,1.);vec2 p=vTerrainLowWorldPosition.xz;float basin=1.-smoothstep(1.5,9.5,slope);float film=basin*(.30+terrainSedFbm(p/52.+vec2(-2.4,15.6))*.70)*(1.-smoothstep(3.,24.,slope));float wash=smoothstep(4.,31.,slope);float aggregate=terrainSedRidge(p/13.+vec2(2.2,18.1));roughnessFactor=clamp(roughnessFactor+aggregate*.048+wash*.055-film*.105,0.42,1.0);}
void terrainSedimentApplyNormal(){vec2 p=vTerrainLowWorldPosition.xz;float slope=1.-clamp(abs(normalize(vTerrainLowWorldNormal).y),0.,1.);float wash=smoothstep(4.,31.,slope);float film=(1.-smoothstep(3.,24.,slope))*(1.-smoothstep(85.,210.,vTerrainLowWorldPosition.y))*terrainSedFbm(p/52.+vec2(2.1,-6.4));float a=terrainSedFbm(p/29.+vec2(2.4,-5.2));float b=terrainSedFbm(p/29.+vec2(3.1,-4.4));float c=terrainSedRidge(p/118.+vec2(-8.7,12.1));vec2 g=vec2(b-a,c-.5);normal=normalize(normal+mat3(viewMatrix)*vec3(-g.x,0.,-g.y)*(wash*.42+film*.22)*.085);}
`;

export function sedimentPolicySnapshot() {
  return Object.freeze({ id: TERRAIN_SEDIMENT_POLICY.id, profileCount: TERRAIN_SEDIMENT_POLICY.profileCount, scales: Object.freeze([TERRAIN_SEDIMENT_POLICY.broadScaleMeters, TERRAIN_SEDIMENT_POLICY.mesoScaleMeters, TERRAIN_SEDIMENT_POLICY.basinScaleMeters, TERRAIN_SEDIMENT_POLICY.rillScaleMeters, TERRAIN_SEDIMENT_POLICY.aggregateScaleMeters, TERRAIN_SEDIMENT_POLICY.poreScaleMeters, TERRAIN_SEDIMENT_POLICY.filmScaleMeters]), renderOnly: TERRAIN_SEDIMENT_POLICY.renderOnly, deterministic: TERRAIN_SEDIMENT_POLICY.deterministic, invariants: TERRAIN_SEDIMENT_CANONICAL_INVARIANTS });
}
