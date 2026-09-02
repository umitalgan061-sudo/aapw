/**
 * Deterministic CPU-side material atlas for terrain cryosphere surface breakup.
 *
 * The atlas contains no geography. It is a reusable, tileable material signal sampled later in
 * world space by `terrainCryosphereSurfaceFabric.js`; canonical snow/ice coverage remains owned by
 * the existing terrain biome/climate chain.
 *
 * RGBA channels:
 * - R: granular albedo response around a neutral midpoint;
 * - G: intrinsic compact/powder roughness family;
 * - B: micro-height for normal perturbation;
 * - A: sparse mineral/dirt concentration used only on already-classified ablation snow.
 * @module world/terrainCryosphereSurfaceAtlas
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

export const TERRAIN_CRYOSPHERE_WIND_FRAME = Object.freeze({
  travelX: WIND_TRAVEL_X,
  travelZ: WIND_TRAVEL_Z,
  crossX: WIND_CROSS_X,
  crossZ: WIND_CROSS_Z,
});

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

export function sampleTerrainCryosphereSurfaceAtlas(u, v) {
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

  const albedo = clamp01(
    0.50
      + (broad - 0.5) * 0.30
      + (granular - 0.5) * 0.28
      + (crystal - 0.5) * 0.12
      - smoothstep(0.69, 0.90, mineral) * 0.10,
  );
  const roughness = clamp01(
    0.66
      + (granular - 0.5) * 0.24
      + (crystal - 0.5) * 0.14
      - windRidge * 0.18
      - smoothstep(0.64, 0.88, broad) * 0.08,
  );
  const microHeight = clamp01(
    0.50
      + (granular - 0.5) * 0.34
      + (crystal - 0.5) * 0.20
      + (windRidge - 0.5) * 0.26,
  );
  const mineralMask = clamp01(
    smoothstep(0.58, 0.87, mineral) * 0.72
      + smoothstep(0.68, 0.91, 1 - broad) * smoothstep(0.61, 0.88, granular) * 0.28,
  );
  return Object.freeze({ albedo, roughness, microHeight, mineralMask });
}

export function buildTerrainCryosphereSurfaceAtlasData(size = TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.atlasSize) {
  const resolvedSize = Math.max(8, Math.floor(Number(size) || TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.atlasSize));
  const data = new Uint8Array(resolvedSize * resolvedSize * 4);
  for (let y = 0; y < resolvedSize; y += 1) {
    for (let x = 0; x < resolvedSize; x += 1) {
      const sample = sampleTerrainCryosphereSurfaceAtlas(x / resolvedSize, y / resolvedSize);
      const offset = (y * resolvedSize + x) * 4;
      data[offset] = Math.round(sample.albedo * 255);
      data[offset + 1] = Math.round(sample.roughness * 255);
      data[offset + 2] = Math.round(sample.microHeight * 255);
      data[offset + 3] = Math.round(sample.mineralMask * 255);
    }
  }
  return data;
}

let sharedCryosphereAtlas = null;

export function getSharedTerrainCryosphereSurfaceAtlas() {
  if (sharedCryosphereAtlas) return sharedCryosphereAtlas;
  const P = TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY;
  const texture = new THREE.DataTexture(
    buildTerrainCryosphereSurfaceAtlasData(P.atlasSize),
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
