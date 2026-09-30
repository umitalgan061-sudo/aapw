/**
 * Render-only rainfall runoff-path surface response.
 *
 * This is not hydrology. It is a deterministic visual proxy for where repeated rainfall would leave
 * fine streaks, washed shoulders and transient drying lanes on already-authored terrain.
 */
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / Math.max(1e-9, b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

export const TERRAIN_RUNOFF_PATH_POLICY = Object.freeze({
  id: 'terrain-surface-runoff-paths-2026-09-15-v1',
  renderOnly: true, deterministic: true,
  canonicalHeightUnchanged: true, canonicalHydrologyUnchanged: true,
  canonicalCoastlineUnchanged: true, canonicalColliderUnchanged: true,
  canonicalVegetationPlacementUnchanged: true, newGeographyIntroduced: false,
  rainfallBearingRadians: 1.12, broadScaleMeters: 680, pathScaleMeters: 47,
  branchScaleMeters: 21, stainScaleMeters: 12, dryLaneScaleMeters: 9,
  slopeBandDegrees: Object.freeze([4, 36]),
  strongSlopeDegrees: Object.freeze([18, 48]),
  lowlandFadeMeters: Object.freeze([95, 210]),
  maximumColorEnergy: 0.082, maximumRoughnessEnergy: 0.072,
  maximumNormalEnergy: 0.064, materialKey: 'terrain-surface-runoff-paths-v1',
});

function hash2D(ix, iz, seed) {
  let h = Math.imul((ix | 0) ^ seed, 0x45d9f3b) ^ Math.imul((iz | 0) + seed, 0x119de1f3);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise2D(x, z, seed) {
  const ix = Math.floor(x); const iz = Math.floor(z); const fx = x - ix; const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx); const uz = fz * fz * (3 - 2 * fz);
  const a = hash2D(ix, iz, seed); const b = hash2D(ix + 1, iz, seed); const c = hash2D(ix, iz + 1, seed); const d = hash2D(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}
function fbm(x, z, seed, octaves = 4) {
  let value = 0; let weight = 0; let amp = 0.55;
  for (let i = 0; i < octaves; i += 1) { value += noise2D(x, z, seed + i * 67) * amp; weight += amp; x = x * 2.03 + 7.2; z = z * 2.03 - 6.1; amp *= 0.49; }
  return value / Math.max(weight, 1e-9);
}
function ridge(x, z, seed) { return 1 - Math.abs(fbm(x, z, seed) * 2 - 1); }
function rotate(x, z, a) { const c = Math.cos(a); const s = Math.sin(a); return { x: x * c - z * s, z: x * s + z * c }; }

function slopeMask(slopeDegrees) { return smoothstep(TERRAIN_RUNOFF_PATH_POLICY.slopeBandDegrees[0], TERRAIN_RUNOFF_PATH_POLICY.slopeBandDegrees[1], slopeDegrees); }
function strongSlopeMask(slopeDegrees) { return smoothstep(TERRAIN_RUNOFF_PATH_POLICY.strongSlopeDegrees[0], TERRAIN_RUNOFF_PATH_POLICY.strongSlopeDegrees[1], slopeDegrees); }
function lowlandMask(heightMeters) { return 1 - smoothstep(TERRAIN_RUNOFF_PATH_POLICY.lowlandFadeMeters[0], TERRAIN_RUNOFF_PATH_POLICY.lowlandFadeMeters[1], heightMeters); }

export function resolveTerrainRunoffPathState({ worldX, worldZ, heightMeters, slopeDegrees = 0, moisture = 0.5 }) {
  const x = Number(worldX) || 0; const z = Number(worldZ) || 0; const h = Number(heightMeters) || 0; const slope = Number(slopeDegrees) || 0; const m = clamp01(Number(moisture) || 0);
  const broad = fbm(x / 680, z / 680, 0x6110, 5);
  const axis = rotate(x, z, TERRAIN_RUNOFF_PATH_POLICY.rainfallBearingRadians);
  const path = fbm(axis.x / 47, axis.z / 47, 0x6111, 4);
  const branch = ridge(axis.x / 21, axis.z / 36, 0x6112);
  const stain = ridge(x / 12, z / 28, 0x6113);
  const dryLane = fbm(x / 9, z / 41, 0x6114, 3);
  const slopeEnergy = slopeMask(slope);
  const strong = strongSlopeMask(slope);
  const lowland = lowlandMask(h);
  const moistureEnergy = clamp01(m * 0.54 + (0.5 - broad) * 0.46);
  const primaryLane = smoothstep(0.46, 0.86, path * 0.54 + branch * 0.46);
  const runoff = clamp01(slopeEnergy * (0.24 + primaryLane * 0.52 + strong * 0.24) * (0.56 + moistureEnergy * 0.44));
  const washStreak = clamp01(runoff * (0.34 + stain * 0.44 + strong * 0.22));
  const branchStreak = clamp01(runoff * branch * 0.84);
  const drying = clamp01((1 - moistureEnergy) * (0.34 + dryLane * 0.66) * (0.44 + lowland * 0.36 + strong * 0.20));
  const shoulderBleach = clamp01(washStreak * 0.52 + branchStreak * 0.23 + drying * 0.25);
  const fineFilm = clamp01(runoff * (1 - slopeEnergy * 0.48) * (0.28 + noise2D(x / 17, z / 17, 0x6115) * 0.72));
  const sedimentCarry = clamp01(runoff * (0.36 + lowland * 0.28 + path * 0.36));
  const exposedAggregate = clamp01((strong * 0.44 + shoulderBleach * 0.36 + stain * 0.20) * (1 - fineFilm * 0.38));
  return Object.freeze({ broad, path, branch, stain, dryLane, slopeEnergy, strong, lowland, moistureEnergy, runoff, washStreak, branchStreak, drying, shoulderBleach, fineFilm, sedimentCarry, exposedAggregate });
}

export function resolveTerrainRunoffMaterialResponse({ state, baseColor, baseRoughness = 0.86 }) {
  const wash = state.shoulderBleach; const film = state.fineFilm; const drying = state.drying; const aggregate = state.exposedAggregate;
  const color = Object.freeze({
    r: clamp01(baseColor.r + state.sedimentCarry * 0.021 + wash * 0.012 - film * 0.014 + drying * 0.009),
    g: clamp01(baseColor.g + state.sedimentCarry * 0.018 + wash * 0.009 - film * 0.019 + drying * 0.006),
    b: clamp01(baseColor.b + state.sedimentCarry * 0.012 + film * 0.012 - drying * 0.004),
  });
  const roughness = clamp01(baseRoughness + aggregate * 0.060 + drying * 0.018 - film * 0.072);
  const normalStrength = clamp01(state.runoff * 0.036 + state.branchStreak * 0.018 + aggregate * 0.010) * 0.88;
  return Object.freeze({ color, roughness, normalStrength });
}

export const TERRAIN_RUNOFF_PATH_GLSL = String.raw`
float terrainRunHash(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float terrainRunNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float a=terrainRunHash(i),b=terrainRunHash(i+vec2(1,0)),c=terrainRunHash(i+vec2(0,1)),d=terrainRunHash(i+vec2(1,1));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float terrainRunFbm(vec2 p){float v=0.,w=0.,a=.55;for(int i=0;i<4;i++){v+=terrainRunNoise(p)*a;w+=a;p=p*2.03+vec2(7.2,-6.1);a*=.49;}return v/w;}
float terrainRunRidge(vec2 p){return 1.-abs(terrainRunFbm(p)*2.-1.);}
vec2 terrainRunRotate(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(p.x*c-p.y*s,p.x*s+p.y*c);}
void terrainRunoffApplyColor(){vec3 base=diffuseColor.rgb;vec2 p=vTerrainLowWorldPosition.xz;float h=vTerrainLowWorldPosition.y;vec3 n=normalize(vTerrainLowWorldNormal);float slope=1.-clamp(abs(n.y),0.,1.);vec2 axis=terrainRunRotate(p,1.12);float broad=terrainRunFbm(p/680.+vec2(5.2,-4.4));float path=terrainRunFbm(axis/47.+vec2(8.1,-3.2));float branch=terrainRunRidge(axis/21.+vec2(-6.7,14.2));float stain=terrainRunRidge(p/12.+vec2(13.2,-8.1));float lowland=1.-smoothstep(95.,210.,h);float runoff=smoothstep(4.,36.,degrees(atan(slope/max(sqrt(max(1.-slope*slope,0.001)),0.001))))*(0.24+smoothstep(.46,.86,path*.54+branch*.46)*.52+smoothstep(18.,48.,degrees(atan(slope/max(sqrt(max(1.-slope*slope,0.001)),0.001))))*.24);float film=runoff*(1.-smoothstep(3.,24.,degrees(atan(slope/max(sqrt(max(1.-slope*slope,0.001)),0.001)))))*(.28+terrainRunFbm(p/17.+vec2(9.1,-3.4))*.72);float stainMask=clamp(runoff*(.34+stain*.44+smoothstep(.42,.82,branch)*.22),0.,1.);float drying=(1.-clamp(.52+(0.5-broad)*.46,0.,1.))*(.34+terrainRunFbm(p/9.+vec2(7.4,3.1))*.66);float mask=1.-smoothstep(.58,.90,dot(base,vec3(.2126,.7152,.0722)));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.48,.44,.36),stainMask*.055*mask);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.35,.40,.43),film*.045*mask);diffuseColor.rgb+=vec3(.006,.005,.003)*drying*.34*mask;}
void terrainRunoffApplyRoughness(){vec2 p=vTerrainLowWorldPosition.xz;float slope=1.-clamp(abs(normalize(vTerrainLowWorldNormal).y),0.,1.);float runoff=smoothstep(.10,.44,slope);float film=(1.-smoothstep(.05,.38,slope))*(1.-smoothstep(95.,210.,vTerrainLowWorldPosition.y))*terrainRunFbm(p/52.+vec2(2.1,-6.4));float aggregate=terrainRunRidge(p/13.+vec2(2.2,18.1));roughnessFactor=clamp(roughnessFactor+runoff*.045+aggregate*.022-film*.062,0.42,1.0);}
void terrainRunoffApplyNormal(){vec2 p=vTerrainLowWorldPosition.xz;vec3 n=normalize(vTerrainLowWorldNormal);float slope=1.-clamp(abs(n.y),0.,1.);float runoff=smoothstep(.10,.44,slope);float a=terrainRunFbm(p/29.+vec2(2.4,-5.2));float b=terrainRunFbm(p/29.+vec2(3.1,-4.4));vec2 g=vec2(b-a,terrainRunRidge(p/118.+vec2(-8.7,12.1))-.5);normal=normalize(normal+mat3(viewMatrix)*vec3(-g.x,0.,-g.y)*runoff*.058);}
`;

export function installTerrainRunoffPaths(material) {
  if (!material) throw new TypeError('terrain runoff-path response requires a material');
  if (material.userData?.terrainRunoffPathsInstalled) return material;
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${TERRAIN_RUNOFF_PATH_GLSL}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nterrainRunoffApplyColor();');
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nterrainRunoffApplyRoughness();');
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nterrainRunoffApplyNormal();');
  };
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}|${TERRAIN_RUNOFF_PATH_POLICY.materialKey}`;
  material.userData = { ...material.userData, terrainRunoffPathsInstalled: true, terrainRunoffPolicyId: TERRAIN_RUNOFF_PATH_POLICY.id, terrainRunoffRenderOnly: true, terrainRunoffCanonicalHeightUnchanged: true, terrainRunoffCanonicalHydrologyUnchanged: true, terrainRunoffCanonicalColliderUnchanged: true, terrainRunoffCanonicalVegetationPlacementUnchanged: true };
  material.needsUpdate = true;
  return material;
}
