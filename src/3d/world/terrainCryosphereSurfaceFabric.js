/**
 * Render-only cryosphere surface fabric for terrain materials.
 *
 * This layer deliberately does not decide where snow, tundra or permanent ice exists. The existing
 * terrainBiomeShading -> terrainMicroSurface chain remains the only geographic classifier. This
 * module runs after that chain and only breaks already-classified snow/ice material into believable
 * old firn, blue-ice lenses, wind crust, mineral ablation and sheltered powder responses.
 *
 * A generated tileable RGBA atlas supplies centimetre-to-decametre material grain. The shader samples
 * that atlas through several independently rotated world-space frames, then combines it with the
 * established kilometre/hectometre terrainPhoto* signals. The result is deterministic and seam-safe
 * without returning to a visibly repeated UV tile.
 *
 * Canonical terrain height, map.png/Pindex ownership, hydrology, shoreline, snow coverage and
 * colliders are untouched.
 * @module world/terrainCryosphereSurfaceFabric
 */

import * as THREE from 'three';
import { TERRAIN_WIND_SNOW_POLICY } from './terrainWindSnowExposure.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / Math.max(1e-9, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const WIND_TRAVEL_X = -TERRAIN_WIND_SNOW_POLICY.prevailingSourceX;
const WIND_TRAVEL_Z = -TERRAIN_WIND_SNOW_POLICY.prevailingSourceZ;
const WIND_CROSS_X = -WIND_TRAVEL_Z;
const WIND_CROSS_Z = WIND_TRAVEL_X;

export const TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY = Object.freeze({
  id: 'terrain-cryosphere-surface-fabric-2026-09-02-v1-wind-firn-ablation',
  renderOnly: true,
  canonicalTerrainHeightUnchanged: true,
  canonicalSnowCoverageUnchanged: true,
  canonicalCryosphereMaskUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalColliderUnchanged: true,
  deterministic: true,
  worldSpace: true,
  atlasSize: 256,
  atlasAnisotropy: 8,
  // Atlas frames are deliberately incommensurate and independently rotated in shader space.
  fineScaleMeters: 11.5,
  mesoScaleMeters: 37,
  coarseScaleMeters: 118,
  crustScaleMeters: 53,
  ablationScaleMeters: 470,
  firnAgeScaleMeters: 920,
  blueIceScaleMeters: 245,
  windRibbonAlongMeters: 165,
  windRibbonAcrossMeters: 24,
  sastrugiAlongMeters: 62,
  sastrugiAcrossMeters: 8.5,
  normalProbeMeters: 2.2,
  maxAlbedoDarkening: 0.17,
  maxAlbedoLift: 0.045,
  oldFirnMixMax: 0.34,
  blueIceMixMax: 0.30,
  mineralAblationMixMax: 0.28,
  windCrustMixMax: 0.20,
  powderMixMax: 0.10,
  normalGainMin: 0.008,
  normalGainMax: 0.082,
  roughnessMin: 0.38,
  roughnessMax: 0.99,
  windAlignedSastrugi: true,
  multiScaleFirnAge: true,
  blueIceLenses: true,
  mineralAblation: true,
  shelteredPowderBreakup: true,
  nonPeriodicAtlasSampling: true,
});

function mix32(value) {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function hash01(ix, iy, seed) {
  const a = Math.imul((ix | 0) ^ seed, 0x9e3779b1);
  const b = Math.imul((iy | 0) + seed, 0x85ebca77);
  return mix32(a ^ b) / 4294967296;
}

function wrapCell(value, cells) {
  return ((value % cells) + cells) % cells;
}

function valueNoise(u, v, cells, seed) {
  const gx = u * cells;
  const gy = v * cells;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx0 = gx - x0;
  const fy0 = gy - y0;
  const fx = fx0 * fx0 * (3 - 2 * fx0);
  const fy = fy0 * fy0 * (3 - 2 * fy0);
  const a = hash01(wrapCell(x0, cells), wrapCell(y0, cells), seed);
  const b = hash01(wrapCell(x0 + 1, cells), wrapCell(y0, cells), seed);
  const c = hash01(wrapCell(x0, cells), wrapCell(y0 + 1, cells), seed);
  const d = hash01(wrapCell(x0 + 1, cells), wrapCell(y0 + 1, cells), seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

function fbm(u, v, seed) {
  let total = 0;
  let amplitude = 0.54;
  let weight = 0;
  for (let octave = 0; octave < 5; octave += 1) {
    const cells = 4 * (1 << octave);
    total += valueNoise(u, v, cells, seed + octave * 173) * amplitude;
    weight += amplitude;
    amplitude *= 0.47;
  }
  return total / Math.max(weight, 1e-9);
}

function ridge(value) {
  return 1 - Math.abs(value * 2 - 1);
}

function cryosphereAtlasSample(u, v) {
  const warpA = fbm(u, v, 0x5139);
  const warpB = fbm((u + 0.317) % 1, (v + 0.683) % 1, 0x91d7);
  const warpedU = (u + (warpA - 0.5) * 0.082 + 1) % 1;
  const warpedV = (v + (warpB - 0.5) * 0.069 + 1) % 1;

  const broad = fbm(warpedU, warpedV, 0xc2a5);
  const granular = fbm((warpedU + 0.173) % 1, (warpedV + 0.411) % 1, 0x7f31);
  const crystal = fbm((warpedU + 0.619) % 1, (warpedV + 0.127) % 1, 0x32e9);
  const mineral = fbm((warpedU + 0.431) % 1, (warpedV + 0.793) % 1, 0xb84d);

  const windAlong = warpedU * WIND_TRAVEL_X + warpedV * WIND_TRAVEL_Z;
  const windAcross = warpedU * WIND_CROSS_X + warpedV * WIND_CROSS_Z;
  const windWarp = (broad - 0.5) * 0.42 + (crystal - 0.5) * 0.16;
  const ribbonA = ridge(valueNoise(
    (windAlong * 1.9 + windWarp + 10) % 1,
    (windAcross * 7.2 - windWarp * 0.37 + 10) % 1,
    32,
    0x6e15,
  ));
  const ribbonB = ridge(valueNoise(
    (windAlong * 4.3 - windWarp * 0.19 + 10) % 1,
    (windAcross * 13.7 + windWarp * 0.28 + 10) % 1,
    64,
    0x1a93,
  ));
  const windRidge = clamp01(ribbonA * 0.66 + ribbonB * 0.34);

  // R: granular albedo response around neutral 0.5.
  const albedo = clamp01(
    0.50
      + (broad - 0.5) * 0.30
      + (granular - 0.5) * 0.28
      + (crystal - 0.5) * 0.12
      - smoothstep(0.69, 0.90, mineral) * 0.10,
  );
  // G: intrinsic roughness family. Bright powder/crystals stay rough; compact ribbons polish.
  const roughness = clamp01(
    0.66
      + (granular - 0.5) * 0.24
      + (crystal - 0.5) * 0.14
      - windRidge * 0.18
      - smoothstep(0.64, 0.88, broad) * 0.08,
  );
  // B: micro-height used for normal perturbation. Keep broad components out of this channel.
  const microHeight = clamp01(
    0.50
      + (granular - 0.5) * 0.34
      + (crystal - 0.5) * 0.20
      + (windRidge - 0.5) * 0.26,
  );
  // A: sparse mineral/dirt concentration for ablation surfaces.
  const mineralMask = clamp01(
    smoothstep(0.58, 0.87, mineral) * 0.72
      + smoothstep(0.68, 0.91, 1 - broad) * smoothstep(0.61, 0.88, granular) * 0.28,
  );
  return [albedo, roughness, microHeight, mineralMask];
}

function buildAtlasData(size) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sample = cryosphereAtlasSample(x / size, y / size);
      const offset = (y * size + x) * 4;
      data[offset] = Math.round(sample[0] * 255);
      data[offset + 1] = Math.round(sample[1] * 255);
      data[offset + 2] = Math.round(sample[2] * 255);
      data[offset + 3] = Math.round(sample[3] * 255);
    }
  }
  return data;
}

let sharedCryosphereAtlas = null;

export function getSharedTerrainCryosphereSurfaceAtlas() {
  if (sharedCryosphereAtlas) return sharedCryosphereAtlas;
  const P = TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY;
  const texture = new THREE.DataTexture(
    buildAtlasData(P.atlasSize),
    P.atlasSize,
    P.atlasSize,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = 'terrain-cryosphere-surface-fabric-v1';
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = P.atlasAnisotropy;
  texture.colorSpace = THREE.NoColorSpace;
  texture.userData = {
    ...texture.userData,
    terrainCryosphereSurfaceFabricPolicy: P.id,
    channelMeaning: Object.freeze({
      r: 'granular-albedo',
      g: 'intrinsic-roughness',
      b: 'micro-height',
      a: 'mineral-ablation',
    }),
  };
  texture.needsUpdate = true;
  sharedCryosphereAtlas = texture;
  return texture;
}

function replaceRequired(source, anchor, replacement, label) {
  if (!source.includes(anchor)) {
    throw new Error(`[terrainCryosphereSurfaceFabric] shader anchor missing: ${label}`);
  }
  return source.replace(anchor, replacement);
}

const GLSL_FUNCTION_ANCHOR = `float terrainPhotoRidgeNoise(vec2 p) {
\tfloat n = terrainPhotoFbm(p);
\treturn 1.0 - abs(n * 2.0 - 1.0);
}`;

const GLSL_COLOR_ANCHOR = 'diffuseColor.rgb = clamp(diffuseColor.rgb, vec3(0.010), vec3(0.845));';

const GLSL_NORMAL_ANCHOR = 'normal = normalize(normal + mat3(viewMatrix) * vec3(terrainPhotoSnowNormalX, 0.0, terrainPhotoSnowNormalZ) * terrainPhotoSnowNormalGain);';

const shaderFunctions = /* glsl */ `
uniform sampler2D uTerrainCryosphereSurfaceAtlas;

mat2 terrainCryoRotation(float radians) {
  float c = cos(radians);
  float s = sin(radians);
  return mat2(c, -s, s, c);
}

vec4 terrainCryoAtlas(vec2 worldXZ, float scaleMeters, float rotationRadians, vec2 offset) {
  vec2 uv = terrainCryoRotation(rotationRadians) * worldXZ / max(scaleMeters, 0.001) + offset;
  return texture2D(uTerrainCryosphereSurfaceAtlas, fract(uv));
}

float terrainCryoRidge(float value) {
  return 1.0 - abs(value * 2.0 - 1.0);
}

float terrainCryoDirectionalRibbon(vec2 worldXZ, float alongMeters, float acrossMeters, float phase) {
  const vec2 windTravel = vec2(${WIND_TRAVEL_X.toFixed(7)}, ${WIND_TRAVEL_Z.toFixed(7)});
  const vec2 windCross = vec2(${WIND_CROSS_X.toFixed(7)}, ${WIND_CROSS_Z.toFixed(7)});
  float along = dot(worldXZ, windTravel) / alongMeters;
  float across = dot(worldXZ, windCross) / acrossMeters;
  float warp = terrainPhotoFbm(worldXZ / 530.0 + vec2(phase * 0.37, -phase * 0.21));
  float band = terrainPhotoNoise(vec2(along + warp * 0.82, across - warp * 0.31) + vec2(phase, -phase * 1.7));
  return terrainCryoRidge(band);
}
`;

const colorChunk = /* glsl */ `
// Dedicated cryosphere material breakup. This consumes only terrainPhoto* masks that the canonical
// terrain shading chain already resolved; no coordinate here creates snow/ice geography.
vec4 terrainCryoFine = terrainCryoAtlas(
  terrainPhotoXZ,
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.fineScaleMeters.toFixed(1)},
  0.37,
  vec2(0.173, 0.619)
);
vec4 terrainCryoMeso = terrainCryoAtlas(
  terrainPhotoXZ,
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.mesoScaleMeters.toFixed(1)},
  -0.83,
  vec2(0.731, 0.283)
);
vec4 terrainCryoCoarse = terrainCryoAtlas(
  terrainPhotoXZ,
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.coarseScaleMeters.toFixed(1)},
  1.41,
  vec2(0.419, 0.887)
);

float terrainCryoFirnAgeField = terrainPhotoFbm(
  (terrainPhotoWarpedXZ + (terrainCryoCoarse.rg - 0.5) * 340.0)
    / ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.firnAgeScaleMeters.toFixed(1)}
    + vec2(-31.7, 14.8)
);
float terrainCryoAblationField = terrainPhotoFbm(
  (terrainPhotoWarpedXZ + (terrainCryoMeso.ra - 0.5) * 170.0)
    / ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.ablationScaleMeters.toFixed(1)}
    + vec2(19.2, -27.6)
);
float terrainCryoBlueIceField = terrainPhotoRidgeNoise(
  (terrainPhotoWarpedXZ + (terrainCryoCoarse.br - 0.5) * 110.0)
    / ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.blueIceScaleMeters.toFixed(1)}
    + vec2(7.8, 23.1)
);
float terrainCryoWindRibbon = terrainCryoDirectionalRibbon(
  terrainPhotoXZ,
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.windRibbonAlongMeters.toFixed(1)},
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.windRibbonAcrossMeters.toFixed(1)},
  3.7
);
float terrainCryoSastrugiRibbon = terrainCryoDirectionalRibbon(
  terrainPhotoXZ,
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.sastrugiAlongMeters.toFixed(1)},
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.sastrugiAcrossMeters.toFixed(1)},
  11.3
);

float terrainCryoColdBase = smoothstep(0.008, 0.090, diffuseColor.b - diffuseColor.r);
float terrainCryoOldFirn = terrainPhotoSnow
  * smoothstep(0.42, 0.76, terrainCryoFirnAgeField * 0.62 + terrainCryoCoarse.r * 0.38)
  * clamp(0.36 + terrainPhotoSnowFirn * 0.64 + terrainCryoColdBase * 0.22, 0.0, 1.0)
  * (1.0 - terrainPhotoSnowPowder * 0.34);
float terrainCryoBlueIceLens = terrainPhotoSnow
  * smoothstep(0.56, 0.86, terrainCryoBlueIceField * 0.68 + terrainCryoMeso.b * 0.32)
  * clamp(terrainPhotoSnowBlueIce * 0.90 + terrainPhotoSteep * terrainPhotoSnowFirn * 0.42, 0.0, 1.0)
  * (1.0 - terrainPhotoSnowPowder * 0.52);
float terrainCryoWindCrust = terrainPhotoSnow
  * terrainPhotoShoulder
  * smoothstep(0.55, 0.86, terrainCryoWindRibbon * 0.62 + terrainCryoMeso.g * 0.38)
  * clamp(0.30 + terrainPhotoSnowSastrugi * 0.82 + terrainPhotoSnowScour * 0.48, 0.0, 1.0);
float terrainCryoSastrugi = terrainPhotoSnow
  * smoothstep(0.60, 0.90, terrainCryoSastrugiRibbon * 0.68 + terrainCryoFine.b * 0.32)
  * clamp(terrainPhotoSnowSastrugi * 0.92 + terrainCryoWindCrust * 0.46, 0.0, 1.0);
float terrainCryoMineralAblation = terrainPhotoSnow
  * smoothstep(0.58, 0.86, terrainCryoAblationField * 0.52 + terrainCryoCoarse.a * 0.48)
  * clamp(terrainPhotoSnowRockReveal * 0.72 + terrainPhotoSnowScour * 0.36 + terrainCryoOldFirn * 0.24, 0.0, 1.0)
  * (1.0 - terrainPhotoSnowPowder * 0.72);
float terrainCryoShelteredPowder = terrainPhotoSnowPowder
  * smoothstep(0.46, 0.82, terrainCryoMeso.r * 0.58 + terrainCryoFine.g * 0.42)
  * (1.0 - terrainCryoWindCrust * 0.58);

float terrainCryoGranularValue =
  (terrainCryoCoarse.r - 0.5) * 0.15
  + (terrainCryoMeso.r - 0.5) * 0.095
  + (terrainCryoFine.r - 0.5) * 0.040;
float terrainCryoSnowValue = clamp(
  1.0 + terrainCryoGranularValue * terrainPhotoSnow,
  ${(1 - TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.maxAlbedoDarkening).toFixed(3)},
  ${(1 + TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.maxAlbedoLift).toFixed(3)}
);
diffuseColor.rgb *= terrainCryoSnowValue;

vec3 terrainCryoOldFirnTone = vec3(0.500, 0.567, 0.602);
vec3 terrainCryoBlueIceTone = vec3(0.330, 0.475, 0.548);
vec3 terrainCryoWindCrustTone = vec3(0.590, 0.632, 0.642);
vec3 terrainCryoMineralTone = vec3(0.335, 0.342, 0.329);
vec3 terrainCryoPowderTone = vec3(0.805, 0.817, 0.806);
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  terrainCryoOldFirnTone,
  terrainCryoOldFirn * ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.oldFirnMixMax.toFixed(3)}
);
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  terrainCryoBlueIceTone,
  terrainCryoBlueIceLens * ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.blueIceMixMax.toFixed(3)}
);
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  terrainCryoWindCrustTone,
  terrainCryoWindCrust * ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.windCrustMixMax.toFixed(3)}
);
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  terrainCryoMineralTone,
  terrainCryoMineralAblation * ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.mineralAblationMixMax.toFixed(3)}
);
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  terrainCryoPowderTone,
  terrainCryoShelteredPowder * ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.powderMixMax.toFixed(3)}
);

// Broad white plates are visually flattened most by a uniform highlight floor. On already-classified
// snow, lower that floor only where old-firn/crust evidence exists; fresh powder keeps its brightness.
float terrainCryoCompactionDarken = clamp(
  terrainCryoOldFirn * 0.055
    + terrainCryoWindCrust * 0.040
    + terrainCryoBlueIceLens * 0.065
    + terrainCryoMineralAblation * 0.075,
  0.0,
  0.115
);
diffuseColor.rgb *= 1.0 - terrainCryoCompactionDarken;
diffuseColor.rgb = clamp(diffuseColor.rgb, vec3(0.010), vec3(0.825));
`;

const normalChunk = /* glsl */ `
// Fine cryosphere relief is sampled in world space so adjacent chunks share the same crust/sastrugi.
float terrainCryoProbe = ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.normalProbeMeters.toFixed(2)};
vec4 terrainCryoNormalEast = terrainCryoAtlas(
  terrainPhotoXZ + vec2(terrainCryoProbe, 0.0),
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.fineScaleMeters.toFixed(1)},
  0.37,
  vec2(0.173, 0.619)
);
vec4 terrainCryoNormalWest = terrainCryoAtlas(
  terrainPhotoXZ - vec2(terrainCryoProbe, 0.0),
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.fineScaleMeters.toFixed(1)},
  0.37,
  vec2(0.173, 0.619)
);
vec4 terrainCryoNormalNorth = terrainCryoAtlas(
  terrainPhotoXZ + vec2(0.0, terrainCryoProbe),
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.fineScaleMeters.toFixed(1)},
  0.37,
  vec2(0.173, 0.619)
);
vec4 terrainCryoNormalSouth = terrainCryoAtlas(
  terrainPhotoXZ - vec2(0.0, terrainCryoProbe),
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.fineScaleMeters.toFixed(1)},
  0.37,
  vec2(0.173, 0.619)
);
float terrainCryoNormalX = terrainCryoNormalEast.b - terrainCryoNormalWest.b;
float terrainCryoNormalZ = terrainCryoNormalNorth.b - terrainCryoNormalSouth.b;
const vec2 terrainCryoWindTravel = vec2(${WIND_TRAVEL_X.toFixed(7)}, ${WIND_TRAVEL_Z.toFixed(7)});
const vec2 terrainCryoWindCross = vec2(${WIND_CROSS_X.toFixed(7)}, ${WIND_CROSS_Z.toFixed(7)});
float terrainCryoSastrugiSlope = (terrainCryoSastrugiRibbon - 0.5) * 2.0;
vec2 terrainCryoDirectionalNormal = terrainCryoWindCross * terrainCryoSastrugiSlope;
float terrainCryoNormalGain = mix(
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.normalGainMin.toFixed(3)},
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.normalGainMax.toFixed(3)},
  clamp(terrainCryoSastrugi * 0.66 + terrainCryoOldFirn * 0.22 + terrainCryoWindCrust * 0.30, 0.0, 1.0)
) * terrainPhotoSnow * (1.0 - terrainCryoShelteredPowder * 0.44);
vec2 terrainCryoCombinedNormal = vec2(terrainCryoNormalX, terrainCryoNormalZ)
  + terrainCryoDirectionalNormal * (0.42 + terrainCryoWindCrust * 0.44);
normal = normalize(
  normal
    + mat3(viewMatrix) * vec3(terrainCryoCombinedNormal.x, 0.0, terrainCryoCombinedNormal.y)
      * terrainCryoNormalGain
);
`;

const roughnessChunk = /* glsl */ `
float terrainCryoAtlasRoughness = clamp(
  terrainCryoCoarse.g * 0.28 + terrainCryoMeso.g * 0.44 + terrainCryoFine.g * 0.28,
  0.0,
  1.0
);
float terrainCryoMaterialRoughness = mix(0.79, 0.96, terrainCryoAtlasRoughness);
terrainCryoMaterialRoughness -= terrainCryoOldFirn * 0.12;
terrainCryoMaterialRoughness -= terrainCryoBlueIceLens * 0.28;
terrainCryoMaterialRoughness -= terrainCryoWindCrust * 0.13;
terrainCryoMaterialRoughness += terrainCryoShelteredPowder * 0.10;
terrainCryoMaterialRoughness += terrainCryoMineralAblation * 0.035;
terrainCryoMaterialRoughness = clamp(
  terrainCryoMaterialRoughness,
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.roughnessMin.toFixed(2)},
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.roughnessMax.toFixed(2)}
);
float terrainCryoRoughnessBlend = clamp(
  terrainPhotoSnow * (0.18 + terrainCryoOldFirn * 0.18 + terrainCryoBlueIceLens * 0.34
    + terrainCryoWindCrust * 0.22 + terrainCryoShelteredPowder * 0.16),
  0.0,
  0.66
);
roughnessFactor = mix(roughnessFactor, terrainCryoMaterialRoughness, terrainCryoRoughnessBlend);
`;

export function installTerrainCryosphereSurfaceFabric(material) {
  if (!material?.isMeshStandardMaterial) {
    throw new TypeError('terrain cryosphere surface fabric requires MeshStandardMaterial');
  }
  const atlas = getSharedTerrainCryosphereSurfaceAtlas();
  const previousCompile = material.onBeforeCompile?.bind(material);
  const previousCacheKey = material.customProgramCacheKey?.bind(material);

  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);
    shader.uniforms.uTerrainCryosphereSurfaceAtlas = { value: atlas };

    shader.fragmentShader = replaceRequired(
      shader.fragmentShader,
      GLSL_FUNCTION_ANCHOR,
      `${GLSL_FUNCTION_ANCHOR}\n${shaderFunctions}`,
      'photoreal-functions',
    );
    shader.fragmentShader = replaceRequired(
      shader.fragmentShader,
      GLSL_COLOR_ANCHOR,
      `${colorChunk}\n${GLSL_COLOR_ANCHOR}`,
      'photoreal-color-tail',
    );
    shader.fragmentShader = replaceRequired(
      shader.fragmentShader,
      GLSL_NORMAL_ANCHOR,
      `${GLSL_NORMAL_ANCHOR}\n${normalChunk}`,
      'photoreal-normal-tail',
    );
    shader.fragmentShader = replaceRequired(
      shader.fragmentShader,
      '#include <metalnessmap_fragment>',
      `${roughnessChunk}\n#include <metalnessmap_fragment>`,
      'metalness-after-roughness',
    );
  };

  material.customProgramCacheKey = () => `${previousCacheKey?.() || ''}|${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.id}`;
  material.userData ||= {};
  material.userData.terrainCryosphereSurfaceFabric = Object.freeze({
    policyId: TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.id,
    renderOnly: true,
    canonicalTerrainHeightUnchanged: true,
    canonicalSnowCoverageUnchanged: true,
    canonicalCryosphereMaskUnchanged: true,
    canonicalHydrologyUnchanged: true,
    canonicalColliderUnchanged: true,
    worldSpace: true,
    atlasSize: TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.atlasSize,
    multiScaleFirnAge: true,
    blueIceLenses: true,
    mineralAblation: true,
    windAlignedSastrugi: true,
    roughnessVariation: true,
    normalVariation: true,
  });
  material.needsUpdate = true;
  return material;
}

export function auditTerrainCryosphereSurfaceFabric(material) {
  const metadata = material?.userData?.terrainCryosphereSurfaceFabric;
  const errors = [];
  if (!material?.isMeshStandardMaterial) errors.push('not-mesh-standard-material');
  if (!metadata) errors.push('missing-metadata');
  if (metadata?.policyId !== TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.id) errors.push('policy-id-drift');
  if (metadata?.renderOnly !== true) errors.push('render-only-contract-lost');
  if (metadata?.canonicalTerrainHeightUnchanged !== true) errors.push('height-authority-drift');
  if (metadata?.canonicalSnowCoverageUnchanged !== true) errors.push('snow-authority-drift');
  if (metadata?.canonicalHydrologyUnchanged !== true) errors.push('hydrology-authority-drift');
  if (metadata?.canonicalColliderUnchanged !== true) errors.push('collider-authority-drift');
  const atlas = getSharedTerrainCryosphereSurfaceAtlas();
  if (!atlas?.isDataTexture) errors.push('missing-fabric-atlas');
  if (atlas?.wrapS !== THREE.RepeatWrapping || atlas?.wrapT !== THREE.RepeatWrapping) errors.push('atlas-wrap-drift');
  if (atlas?.colorSpace !== THREE.NoColorSpace) errors.push('atlas-color-space-drift');
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    policyId: TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.id,
    metadata: metadata || null,
  });
}
