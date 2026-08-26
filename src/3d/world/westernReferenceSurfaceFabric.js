import * as THREE from 'three';

/**
 * Shared render-only material fabric for canonical owner-map Pindex 01-03.
 *
 * This module deliberately consumes world-space metres plus an already-authoritative surface class.
 * It never changes height, surface ownership, hydrology, shoreline or collision. The same global
 * coordinates are used in all three Pindexes, so albedo provinces cross Pindex boundaries without
 * resetting into visible strips.
 * @module world/westernReferenceSurfaceFabric
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;

export const WESTERN_REFERENCE_SURFACE_FABRIC_POLICY = Object.freeze({
  id: 'western-reference-surface-fabric-2026-08-26-v1-world-space-weathering',
  renderOnly: true,
  geographyAuthorityUnchanged: true,
  heightAuthorityUnchanged: true,
  hydrologyAuthorityUnchanged: true,
  colliderAuthorityUnchanged: true,
  macroMeters: 1560,
  mesoMeters: 430,
  fineMeters: 108,
  microMeters: 42,
  warpMeters: 118,
  soilShadeAmplitude: 0.072,
  rockShadeAmplitude: 0.066,
  snowShadeAmplitude: 0.038,
  lakeShadeAmplitude: 0.018,
});

const SOIL_DAMP = new THREE.Color(0x495947);
const SOIL_MINERAL = new THREE.Color(0x756b50);
const SOIL_HEATH = new THREE.Color(0x596047);
const ROCK_COOL = new THREE.Color(0x5b6060);
const ROCK_IRON = new THREE.Color(0x726355);
const ROCK_LICHEN = new THREE.Color(0x66705d);
const SNOW_SHADOW = new THREE.Color(0xb9c6c7);
const SNOW_CRUST = new THREE.Color(0xe3e3d8);
const LAKE_COLD = new THREE.Color(0x566f72);
const LAKE_SILT = new THREE.Color(0x65766d);

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hash01(ix, iz, seed) {
  const value = Math.sin(ix * 127.1 + iz * 311.7 + seed * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise2D(worldX, worldZ, scaleMeters, seed) {
  const x = worldX / scaleMeters;
  const z = worldZ / scaleMeters;
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const n00 = hash01(x0, z0, seed);
  const n10 = hash01(x0 + 1, z0, seed);
  const n01 = hash01(x0, z0 + 1, seed);
  const n11 = hash01(x0 + 1, z0 + 1, seed);
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sz);
}

function ridge01(value) {
  return 1 - Math.abs(value * 2 - 1);
}

function sampleFabric(worldX, worldZ) {
  const warpX = valueNoise2D(worldX + 910, worldZ - 470, 2180, 13.4) - 0.5;
  const warpZ = valueNoise2D(worldX - 620, worldZ + 840, 1840, 17.8) - 0.5;
  const x = worldX + warpX * WESTERN_REFERENCE_SURFACE_FABRIC_POLICY.warpMeters;
  const z = worldZ + warpZ * WESTERN_REFERENCE_SURFACE_FABRIC_POLICY.warpMeters;

  const macro = valueNoise2D(x + 130, z - 280, WESTERN_REFERENCE_SURFACE_FABRIC_POLICY.macroMeters, 3.7);
  const meso = valueNoise2D(x - 390, z + 170, WESTERN_REFERENCE_SURFACE_FABRIC_POLICY.mesoMeters, 7.9);
  const fine = valueNoise2D(x + 210, z + 360, WESTERN_REFERENCE_SURFACE_FABRIC_POLICY.fineMeters, 11.3);
  const micro = valueNoise2D(x - 80, z - 110, WESTERN_REFERENCE_SURFACE_FABRIC_POLICY.microMeters, 19.7);

  const moisture = clamp01(
    macro * 0.49
      + meso * 0.28
      + (1 - ridge01(fine)) * 0.13
      + micro * 0.10,
  );
  const mineral = clamp01(
    (1 - macro) * 0.32
      + ridge01(meso) * 0.31
      + fine * 0.22
      + ridge01(micro) * 0.15,
  );
  const weathering = clamp01(
    ridge01(valueNoise2D(x + z * 0.17, z - x * 0.11, 610, 23.1)) * 0.58
      + meso * 0.27
      + fine * 0.15,
  );
  const streak = ridge01(valueNoise2D(x + z * 0.23, z - x * 0.31, 178, 29.6));
  const crust = ridge01(valueNoise2D(x - z * 0.16, z + x * 0.28, 132, 37.4));
  return { macro, meso, fine, micro, moisture, mineral, weathering, streak, crust };
}

function tint(base, target, amount) {
  base.lerp(target, clamp01(amount));
}

function shadeColor(base, shade) {
  base.multiplyScalar(shade);
  base.r = clamp01(base.r);
  base.g = clamp01(base.g);
  base.b = clamp01(base.b);
}

function soilColor(base, fabric) {
  const shade = 1
    + (fabric.macro - 0.5) * 0.054
    + (fabric.meso - 0.5) * 0.052
    + (fabric.fine - 0.5) * 0.027
    + (fabric.micro - 0.5) * 0.011;
  shadeColor(base, THREE.MathUtils.clamp(shade, 0.90, 1.09));
  tint(base, SOIL_DAMP, smoothstep(0.56, 0.88, fabric.moisture) * 0.105);
  tint(base, SOIL_MINERAL, smoothstep(0.58, 0.90, fabric.mineral) * 0.090);
  tint(base, SOIL_HEATH, smoothstep(0.64, 0.93, fabric.weathering) * (1 - fabric.moisture) * 0.065);
}

function rockColor(base, fabric) {
  const strata = ridge01((fabric.streak * 0.74 + fabric.meso * 0.26) % 1);
  const shade = 1
    + (fabric.macro - 0.5) * 0.040
    + (strata - 0.5) * 0.072
    + (fabric.fine - 0.5) * 0.026
    + (fabric.micro - 0.5) * 0.012;
  shadeColor(base, THREE.MathUtils.clamp(shade, 0.89, 1.10));
  tint(base, ROCK_COOL, smoothstep(0.57, 0.89, fabric.moisture) * 0.080);
  tint(base, ROCK_IRON, smoothstep(0.60, 0.91, fabric.mineral) * 0.085);
  tint(base, ROCK_LICHEN, smoothstep(0.66, 0.94, fabric.weathering) * fabric.moisture * 0.055);
}

function snowColor(base, fabric) {
  const windCrust = smoothstep(0.57, 0.88, fabric.crust);
  const grit = smoothstep(0.67, 0.93, fabric.mineral) * (1 - fabric.moisture);
  const shade = 1
    + (fabric.macro - 0.5) * 0.022
    + (fabric.meso - 0.5) * 0.026
    + (windCrust - 0.5) * 0.032
    - grit * 0.020;
  shadeColor(base, THREE.MathUtils.clamp(shade, 0.94, 1.055));
  tint(base, SNOW_SHADOW, smoothstep(0.60, 0.90, fabric.moisture) * 0.050);
  tint(base, SNOW_CRUST, windCrust * 0.052);
}

function lakeColor(base, fabric) {
  const shade = 1
    + (fabric.macro - 0.5) * 0.016
    + (fabric.meso - 0.5) * 0.014
    + (fabric.fine - 0.5) * 0.008;
  shadeColor(base, THREE.MathUtils.clamp(shade, 0.975, 1.025));
  tint(base, LAKE_COLD, smoothstep(0.58, 0.90, fabric.macro) * 0.030);
  tint(base, LAKE_SILT, smoothstep(0.63, 0.92, fabric.mineral) * 0.018);
}

/**
 * Applies bounded world-space albedo variation to an already-authoritative surface class.
 * Sea is exact-neutral here because `westernMarineShelfTone.js` owns the submerged west-ocean pass.
 */
export function applyWesternReferenceSurfaceFabricToColorAttribute(
  color,
  index,
  { surface, worldX, worldZ },
) {
  if (surface === 'sea') return false;
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return false;
  if (!['soil', 'rock', 'snow', 'lake'].includes(surface)) return false;

  const base = new THREE.Color(color.getX(index), color.getY(index), color.getZ(index));
  const fabric = sampleFabric(worldX, worldZ);
  if (surface === 'soil') soilColor(base, fabric);
  else if (surface === 'rock') rockColor(base, fabric);
  else if (surface === 'snow') snowColor(base, fabric);
  else lakeColor(base, fabric);

  color.setXYZ(index, base.r, base.g, base.b);
  return true;
}

/** Deterministic scalar probe used by exact-head acceptance without exposing geography internals. */
export function sampleWesternReferenceSurfaceFabric(worldX, worldZ) {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) throw new TypeError('world coordinates must be finite');
  return Object.freeze(sampleFabric(worldX, worldZ));
}
