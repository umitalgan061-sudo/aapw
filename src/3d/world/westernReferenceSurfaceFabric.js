import * as THREE from 'three';

/**
 * Shared render-only material fabric for canonical owner-map Pindex 01-03.
 *
 * World-space deterministic material response only: never changes terrain height,
 * surface ownership, shoreline, hydrology or collision. All three Pindexes sample
 * identical global coordinates so ecological and weathering provinces cross chunk
 * and Pindex seams without restarting.
 * @module world/westernReferenceSurfaceFabric
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;

export const WESTERN_REFERENCE_SURFACE_FABRIC_POLICY = Object.freeze({
  id: 'western-reference-surface-fabric-2026-08-30-v9-lowland-relief-response',
  renderOnly: true,
  geographyAuthorityUnchanged: true,
  heightAuthorityUnchanged: true,
  hydrologyAuthorityUnchanged: true,
  colliderAuthorityUnchanged: true,
  macroMeters: 1760,
  mesoMeters: 470,
  fineMeters: 126,
  microMeters: 44,
  subMicroMeters: 17,
  warpMeters: 168,
  drainageMeters: 710,
  alluviumMeters: 1360,
  fractureMeters: 276,
  frostWashMeters: 590,
  erosionMeters: 312,
  heathMosaicMeters: 940,
  pastureBreakMeters: 520,
  colluviumMeters: 820,
  wetHollowMeters: 390,
  soilShadeAmplitude: 0.152,
  rockShadeAmplitude: 0.126,
  snowShadeAmplitude: 0.046,
  lakeShadeAmplitude: 0.018,
});

const SOIL_DAMP = new THREE.Color(0x40513d);
const SOIL_MINERAL = new THREE.Color(0x7b6a4a);
const SOIL_HEATH = new THREE.Color(0x505a3d);
const SOIL_ALLUVIUM = new THREE.Color(0x71664b);
const SOIL_DRAINAGE = new THREE.Color(0x34483a);
const SOIL_OXIDE = new THREE.Color(0x875d40);
const SOIL_STONY = new THREE.Color(0x6e6858);
const SOIL_GRASS_DRY = new THREE.Color(0x76744f);
const SOIL_GRASS_LUSH = new THREE.Color(0x435a3e);
const ROCK_COOL = new THREE.Color(0x545b5b);
const ROCK_IRON = new THREE.Color(0x79604d);
const ROCK_LICHEN = new THREE.Color(0x606b53);
const ROCK_EXPOSED = new THREE.Color(0x7e7566);
const ROCK_WET_FRACTURE = new THREE.Color(0x444c4d);
const ROCK_TALUS_DUST = new THREE.Color(0x897b69);
const ROCK_SCREE = new THREE.Color(0x69645b);
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
  const P = WESTERN_REFERENCE_SURFACE_FABRIC_POLICY;
  const warpX = valueNoise2D(worldX + 910, worldZ - 470, 2240, 13.4) - 0.5;
  const warpZ = valueNoise2D(worldX - 620, worldZ + 840, 1910, 17.8) - 0.5;
  const secondaryWarp = valueNoise2D(worldX + worldZ * 0.19, worldZ - worldX * 0.13, 760, 21.9) - 0.5;
  const x = worldX + warpX * P.warpMeters + secondaryWarp * 54;
  const z = worldZ + warpZ * P.warpMeters - secondaryWarp * 39;

  const macro = valueNoise2D(x + 130, z - 280, P.macroMeters, 3.7);
  const meso = valueNoise2D(x - 390, z + 170, P.mesoMeters, 7.9);
  const fine = valueNoise2D(x + 210, z + 360, P.fineMeters, 11.3);
  const micro = valueNoise2D(x - 80, z - 110, P.microMeters, 19.7);
  const subMicro = valueNoise2D(x + z * 0.11 + 37, z - x * 0.07 - 53, P.subMicroMeters, 67.1);

  const moisture = clamp01(
    macro * 0.44
      + meso * 0.28
      + (1 - ridge01(fine)) * 0.12
      + micro * 0.08
      + valueNoise2D(x - 440, z + 190, P.wetHollowMeters, 79.3) * 0.08,
  );
  const mineral = clamp01(
    (1 - macro) * 0.29
      + ridge01(meso) * 0.29
      + fine * 0.23
      + ridge01(micro) * 0.12
      + ridge01(subMicro) * 0.07,
  );
  const weathering = clamp01(
    ridge01(valueNoise2D(x + z * 0.17, z - x * 0.11, 640, 23.1)) * 0.52
      + meso * 0.25
      + fine * 0.15
      + ridge01(valueNoise2D(x - 90, z + 160, 230, 24.8)) * 0.08,
  );
  const streak = ridge01(valueNoise2D(x + z * 0.23, z - x * 0.31, 178, 29.6));
  const crust = ridge01(valueNoise2D(x - z * 0.16, z + x * 0.28, 132, 37.4));

  const drainageCarrier = ridge01(valueNoise2D(
    x + z * 0.34 + warpX * 210,
    z - x * 0.19 + warpZ * 170,
    P.drainageMeters,
    41.7,
  ));
  const drainageThread = smoothstep(0.80, 0.962, drainageCarrier)
    * smoothstep(0.31, 0.83, moisture)
    * (0.54 + meso * 0.46);

  const wetHollow = smoothstep(0.59, 0.88, valueNoise2D(
    x - z * 0.12 - 170,
    z + x * 0.10 + 260,
    P.wetHollowMeters,
    83.7,
  )) * smoothstep(0.46, 0.84, moisture)
    * (1 - smoothstep(0.72, 0.94, mineral));

  const alluvium = smoothstep(0.50, 0.86, valueNoise2D(
    x - z * 0.13,
    z + x * 0.09,
    P.alluviumMeters,
    47.3,
  )) * smoothstep(0.34, 0.80, moisture) * (1 - drainageThread * 0.48);

  const colluvium = smoothstep(0.55, 0.88, valueNoise2D(
    x + z * 0.08 + 310,
    z - x * 0.15 - 220,
    P.colluviumMeters,
    87.1,
  )) * smoothstep(0.43, 0.83, mineral)
    * smoothstep(0.42, 0.84, weathering)
    * (1 - wetHollow * 0.44);

  const exposedInterfluve = smoothstep(0.56, 0.90, mineral)
    * smoothstep(0.50, 0.87, weathering)
    * (1 - smoothstep(0.44, 0.80, moisture));

  const stonyPatch = smoothstep(0.56, 0.91, ridge01(subMicro * 0.68 + fine * 0.32))
    * smoothstep(0.43, 0.86, mineral)
    * (1 - smoothstep(0.65, 0.90, moisture));

  const fractureCarrier = ridge01(valueNoise2D(
    x + z * 0.41 + warpX * 96,
    z - x * 0.27 + warpZ * 84,
    P.fractureMeters,
    53.9,
  ));
  const fracture = smoothstep(0.72, 0.945, fractureCarrier)
    * (0.40 + weathering * 0.37 + moisture * 0.23);

  const frostWash = smoothstep(0.50, 0.86, valueNoise2D(
    x - z * 0.22,
    z + x * 0.18,
    P.frostWashMeters,
    61.4,
  )) * smoothstep(0.45, 0.84, mineral)
    * (1 - smoothstep(0.57, 0.88, moisture))
    * (1 - drainageThread * 0.45);

  const erosionCarrier = ridge01(valueNoise2D(
    x + z * 0.53 + warpX * 80,
    z - x * 0.08 + warpZ * 60,
    P.erosionMeters,
    71.3,
  ));
  const erosionScour = smoothstep(0.68, 0.94, erosionCarrier)
    * (0.33 + weathering * 0.41 + mineral * 0.26)
    * (1 - drainageThread * 0.31);

  const heathMosaic = smoothstep(0.42, 0.83, valueNoise2D(
    x - z * 0.21,
    z + x * 0.17,
    P.heathMosaicMeters,
    73.9,
  )) * (1 - smoothstep(0.61, 0.90, moisture));

  const pastureCarrier = valueNoise2D(
    x + z * 0.07 + 540,
    z - x * 0.05 - 320,
    P.pastureBreakMeters,
    91.6,
  );
  const pastureBreak = smoothstep(0.36, 0.72, pastureCarrier)
    * (1 - smoothstep(0.68, 0.92, mineral))
    * (1 - exposedInterfluve * 0.52);

  return {
    macro, meso, fine, micro, subMicro, moisture, mineral, weathering, streak, crust,
    stonyPatch: clamp01(stonyPatch),
    drainageThread: clamp01(drainageThread),
    wetHollow: clamp01(wetHollow),
    alluvium: clamp01(alluvium),
    colluvium: clamp01(colluvium),
    exposedInterfluve: clamp01(exposedInterfluve),
    fracture: clamp01(fracture),
    frostWash: clamp01(frostWash),
    erosionScour: clamp01(erosionScour),
    heathMosaic: clamp01(heathMosaic),
    pastureBreak: clamp01(pastureBreak),
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
  const broadRelief = (fabric.macro - 0.5) * 0.102 + (fabric.meso - 0.5) * 0.092;
  const localRelief = (fabric.fine - 0.5) * 0.056
    + (fabric.micro - 0.5) * 0.030
    + (fabric.subMicro - 0.5) * 0.022;
  const shade = 1 + broadRelief + localRelief
    - fabric.drainageThread * 0.060
    - fabric.wetHollow * 0.045
    + fabric.exposedInterfluve * 0.040
    + fabric.frostWash * 0.046
    + fabric.colluvium * 0.030
    + fabric.stonyPatch * 0.028
    - fabric.erosionScour * 0.084
    - fabric.heathMosaic * 0.028
    + (fabric.pastureBreak - 0.5) * 0.030;
  shadeColor(base, THREE.MathUtils.clamp(shade, 0.73, 1.23));

  tint(base, SOIL_DAMP, smoothstep(0.52, 0.86, fabric.moisture) * 0.180);
  tint(base, SOIL_MINERAL, smoothstep(0.53, 0.88, fabric.mineral) * 0.160);
  tint(base, SOIL_HEATH, clamp01(
    smoothstep(0.58, 0.91, fabric.weathering) * (1 - fabric.moisture) * 0.126
      + fabric.heathMosaic * 0.118,
  ));
  tint(base, SOIL_DRAINAGE, clamp01(fabric.drainageThread * 0.168 + fabric.wetHollow * 0.082));
  tint(base, SOIL_ALLUVIUM, fabric.alluvium * 0.108);
  tint(base, SOIL_OXIDE, fabric.frostWash * fabric.exposedInterfluve * 0.154);
  tint(base, SOIL_STONY, clamp01(
    fabric.stonyPatch * 0.132
      + fabric.erosionScour * fabric.mineral * 0.104
      + fabric.colluvium * 0.076,
  ));
  tint(base, SOIL_GRASS_LUSH, fabric.pastureBreak * fabric.moisture * 0.088);
  tint(base, SOIL_GRASS_DRY, fabric.pastureBreak * (1 - fabric.moisture) * 0.074);
}

function rockColor(base, fabric) {
  const strata = ridge01((fabric.streak * 0.74 + fabric.meso * 0.26) % 1);
  const shade = 1
    + (fabric.macro - 0.5) * 0.068
    + (strata - 0.5) * 0.112
    + (fabric.fine - 0.5) * 0.050
    + (fabric.micro - 0.5) * 0.030
    + (fabric.subMicro - 0.5) * 0.034
    + fabric.exposedInterfluve * 0.046
    - fabric.fracture * 0.102
    + fabric.frostWash * 0.058
    + fabric.colluvium * 0.028
    - fabric.stonyPatch * 0.022
    - fabric.erosionScour * 0.078;
  shadeColor(base, THREE.MathUtils.clamp(shade, 0.71, 1.25));
  tint(base, ROCK_COOL, smoothstep(0.53, 0.87, fabric.moisture) * 0.126);
  tint(base, ROCK_IRON, smoothstep(0.55, 0.89, fabric.mineral) * 0.140);
  tint(base, ROCK_LICHEN, smoothstep(0.62, 0.92, fabric.weathering) * fabric.moisture * 0.088);
  tint(base, ROCK_EXPOSED, clamp01(fabric.exposedInterfluve * 0.108 + fabric.erosionScour * 0.068));
  tint(base, ROCK_WET_FRACTURE, fabric.fracture * (0.096 + fabric.moisture * 0.134));
  tint(base, ROCK_TALUS_DUST, clamp01(fabric.frostWash * 0.092 + fabric.colluvium * 0.082));
  tint(base, ROCK_SCREE, fabric.stonyPatch * (0.112 + fabric.weathering * 0.060));
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
