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
  id: 'western-reference-surface-fabric-2026-08-30-v7-anisotropic-lowland-erosion',
  renderOnly: true,
  geographyAuthorityUnchanged: true,
  heightAuthorityUnchanged: true,
  hydrologyAuthorityUnchanged: true,
  colliderAuthorityUnchanged: true,
  macroMeters: 1560,
  mesoMeters: 430,
  fineMeters: 108,
  microMeters: 42,
  subMicroMeters: 17,
  warpMeters: 118,
  drainageMeters: 760,
  alluviumMeters: 1280,
  fractureMeters: 286,
  frostWashMeters: 560,
  erosionMeters: 330,
  heathMosaicMeters: 910,
  soilShadeAmplitude: 0.112,
  rockShadeAmplitude: 0.106,
  snowShadeAmplitude: 0.046,
  lakeShadeAmplitude: 0.018,
});

const SOIL_DAMP = new THREE.Color(0x435340);
const SOIL_MINERAL = new THREE.Color(0x796b4d);
const SOIL_HEATH = new THREE.Color(0x555d42);
const SOIL_ALLUVIUM = new THREE.Color(0x746a50);
const SOIL_DRAINAGE = new THREE.Color(0x394b3d);
const SOIL_OXIDE = new THREE.Color(0x855f45);
const SOIL_STONY = new THREE.Color(0x6b6658);
const ROCK_COOL = new THREE.Color(0x565d5e);
const ROCK_IRON = new THREE.Color(0x77604f);
const ROCK_LICHEN = new THREE.Color(0x626d57);
const ROCK_EXPOSED = new THREE.Color(0x7c7467);
const ROCK_WET_FRACTURE = new THREE.Color(0x474e4f);
const ROCK_TALUS_DUST = new THREE.Color(0x887c6b);
const ROCK_SCREE = new THREE.Color(0x69655c);
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
  const subMicro = valueNoise2D(
    x + z * 0.11 + 37,
    z - x * 0.07 - 53,
    WESTERN_REFERENCE_SURFACE_FABRIC_POLICY.subMicroMeters,
    67.1,
  );

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
  const stonyPatch = smoothstep(0.58, 0.92, ridge01(subMicro * 0.72 + fine * 0.28))
    * smoothstep(0.45, 0.86, mineral)
    * (1 - smoothstep(0.66, 0.90, moisture));

  // Render-only pseudo-hydrologic weathering: thin, warped drainage-like ribbons break broad
  // lowlands into damp swales without claiming to be canonical rivers. They alter colour only.
  const drainageCarrier = ridge01(valueNoise2D(
    x + z * 0.34 + warpX * 210,
    z - x * 0.19 + warpZ * 170,
    WESTERN_REFERENCE_SURFACE_FABRIC_POLICY.drainageMeters,
    41.7,
  ));
  const drainageThread = smoothstep(0.82, 0.965, drainageCarrier)
    * smoothstep(0.34, 0.82, moisture)
    * (0.58 + meso * 0.42);
  const alluvium = smoothstep(0.53, 0.86, valueNoise2D(
    x - z * 0.13,
    z + x * 0.09,
    WESTERN_REFERENCE_SURFACE_FABRIC_POLICY.alluviumMeters,
    47.3,
  )) * smoothstep(0.36, 0.78, moisture) * (1 - drainageThread * 0.55);
  const exposedInterfluve = smoothstep(0.58, 0.91, mineral)
    * smoothstep(0.52, 0.88, weathering)
    * (1 - smoothstep(0.46, 0.80, moisture));

  // Cross-cutting lithologic seams and frost-wash aprons are render-only material cues. Their
  // oblique coordinates avoid axis-aligned bands while staying deterministic in world metres.
  const fractureCarrier = ridge01(valueNoise2D(
    x + z * 0.41 + warpX * 96,
    z - x * 0.27 + warpZ * 84,
    WESTERN_REFERENCE_SURFACE_FABRIC_POLICY.fractureMeters,
    53.9,
  ));
  const fracture = smoothstep(0.74, 0.945, fractureCarrier)
    * (0.42 + weathering * 0.36 + moisture * 0.22);
  const frostWash = smoothstep(0.52, 0.86, valueNoise2D(
    x - z * 0.22,
    z + x * 0.18,
    WESTERN_REFERENCE_SURFACE_FABRIC_POLICY.frostWashMeters,
    61.4,
  )) * smoothstep(0.47, 0.84, mineral)
    * (1 - smoothstep(0.58, 0.88, moisture))
    * (1 - drainageThread * 0.48);

  // Low-amplitude oblique scour and vegetation mosaic remove the remaining airbrushed lowland look.
  // Both are material-only cues: they never create or reroute canonical drainage or terrain relief.
  const erosionCarrier = ridge01(valueNoise2D(
    x + z * 0.53 + warpX * 80,
    z - x * 0.08 + warpZ * 60,
    WESTERN_REFERENCE_SURFACE_FABRIC_POLICY.erosionMeters,
    71.3,
  ));
  const erosionScour = smoothstep(0.76, 0.95, erosionCarrier)
    * (0.35 + weathering * 0.40 + mineral * 0.25)
    * (1 - drainageThread * 0.35);
  const heathMosaic = smoothstep(0.48, 0.84, valueNoise2D(
    x - z * 0.21,
    z + x * 0.17,
    WESTERN_REFERENCE_SURFACE_FABRIC_POLICY.heathMosaicMeters,
    73.9,
  )) * (1 - smoothstep(0.62, 0.90, moisture));

  return {
    macro, meso, fine, micro, subMicro, moisture, mineral, weathering, streak, crust,
    stonyPatch: clamp01(stonyPatch),
    drainageThread: clamp01(drainageThread),
    alluvium: clamp01(alluvium),
    exposedInterfluve: clamp01(exposedInterfluve),
    fracture: clamp01(fracture),
    frostWash: clamp01(frostWash),
    erosionScour: clamp01(erosionScour),
    heathMosaic: clamp01(heathMosaic),
  };
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
    + (fabric.macro - 0.5) * 0.076
    + (fabric.meso - 0.5) * 0.071
    + (fabric.fine - 0.5) * 0.042
    + (fabric.micro - 0.5) * 0.022
    + (fabric.subMicro - 0.5) * 0.023
    - fabric.drainageThread * 0.048
    + fabric.exposedInterfluve * 0.030
    + fabric.frostWash * 0.036
    + fabric.stonyPatch * 0.021
    - fabric.erosionScour * 0.052
    - fabric.heathMosaic * 0.018;
  shadeColor(base, THREE.MathUtils.clamp(shade, 0.80, 1.18));
  tint(base, SOIL_DAMP, smoothstep(0.54, 0.87, fabric.moisture) * 0.155);
  tint(base, SOIL_MINERAL, smoothstep(0.56, 0.89, fabric.mineral) * 0.136);
  tint(base, SOIL_HEATH, clamp01(smoothstep(0.62, 0.92, fabric.weathering) * (1 - fabric.moisture) * 0.105 + fabric.heathMosaic * 0.080));
  tint(base, SOIL_DRAINAGE, fabric.drainageThread * 0.145);
  tint(base, SOIL_ALLUVIUM, fabric.alluvium * 0.094);
  tint(base, SOIL_OXIDE, fabric.frostWash * fabric.exposedInterfluve * 0.132);
  tint(base, SOIL_STONY, clamp01(fabric.stonyPatch * 0.112 + fabric.erosionScour * fabric.mineral * 0.075));
}

function rockColor(base, fabric) {
  const strata = ridge01((fabric.streak * 0.74 + fabric.meso * 0.26) % 1);
  const shade = 1
    + (fabric.macro - 0.5) * 0.058
    + (strata - 0.5) * 0.098
    + (fabric.fine - 0.5) * 0.040
    + (fabric.micro - 0.5) * 0.024
    + (fabric.subMicro - 0.5) * 0.030
    + fabric.exposedInterfluve * 0.039
    - fabric.fracture * 0.090
    + fabric.frostWash * 0.050
    - fabric.stonyPatch * 0.018
    - fabric.erosionScour * 0.060;
  shadeColor(base, THREE.MathUtils.clamp(shade, 0.76, 1.21));
  tint(base, ROCK_COOL, smoothstep(0.55, 0.88, fabric.moisture) * 0.115);
  tint(base, ROCK_IRON, smoothstep(0.58, 0.90, fabric.mineral) * 0.124);
  tint(base, ROCK_LICHEN, smoothstep(0.64, 0.93, fabric.weathering) * fabric.moisture * 0.078);
  tint(base, ROCK_EXPOSED, clamp01(fabric.exposedInterfluve * 0.092 + fabric.erosionScour * 0.052));
  tint(base, ROCK_WET_FRACTURE, fabric.fracture * (0.085 + fabric.moisture * 0.122));
  tint(base, ROCK_TALUS_DUST, fabric.frostWash * (0.080 + fabric.exposedInterfluve * 0.094));
  tint(base, ROCK_SCREE, fabric.stonyPatch * (0.100 + fabric.weathering * 0.052));
}

function snowColor(base, fabric) {
  const windCrust = smoothstep(0.57, 0.88, fabric.crust);
  const grit = smoothstep(0.67, 0.93, fabric.mineral) * (1 - fabric.moisture);
  const shade = 1
    + (fabric.macro - 0.5) * 0.026
    + (fabric.meso - 0.5) * 0.032
    + (windCrust - 0.5) * 0.038
    + (fabric.subMicro - 0.5) * 0.010
    - grit * 0.025
    - fabric.drainageThread * 0.014
    - fabric.fracture * 0.012
    - fabric.frostWash * 0.014
    - fabric.stonyPatch * 0.011
    - fabric.erosionScour * 0.009;
  shadeColor(base, THREE.MathUtils.clamp(shade, 0.920, 1.068));
  tint(base, SNOW_SHADOW, smoothstep(0.60, 0.90, fabric.moisture) * 0.056);
  tint(base, SNOW_CRUST, windCrust * 0.058);
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