import * as THREE from 'three';

/**
 * Shared render-only material fabric for canonical owner-map Pindex 01-03.
 * World-space deterministic response only: never changes terrain height, surface
 * ownership, shoreline, hydrology or collision. Coordinates do not restart at
 * Pindex/chunk seams.
 * @module world/westernReferenceSurfaceFabric
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;

export const WESTERN_REFERENCE_SURFACE_FABRIC_POLICY = Object.freeze({
  id: 'western-reference-surface-fabric-2026-09-06-v21-braided-drainage-microterraces',
  renderOnly: true,
  geographyAuthorityUnchanged: true,
  heightAuthorityUnchanged: true,
  hydrologyAuthorityUnchanged: true,
  colliderAuthorityUnchanged: true,
  macroMeters: 1760,
  broadReliefMeters: 3180,
  continentalMeters: 4620,
  mesoMeters: 470,
  fineMeters: 126,
  microMeters: 44,
  subMicroMeters: 17,
  warpMeters: 184,
  drainageMeters: 760,
  braidedDrainageMeters: 520,
  alluviumMeters: 1420,
  depositionalFanMeters: 1640,
  terraceMeters: 590,
  microTerraceMeters: 214,
  fractureMeters: 276,
  frostWashMeters: 590,
  erosionMeters: 312,
  heathMosaicMeters: 940,
  pastureBreakMeters: 520,
  colluviumMeters: 820,
  wetHollowMeters: 430,
  dryBenchMeters: 1380,
  aerialReliefMeters: 980,
  surfaceCarrierMeters: 286,
  soilShadeAmplitude: 0.248,
  rockShadeAmplitude: 0.194,
  snowShadeAmplitude: 0.046,
  lakeShadeAmplitude: 0.028,
});

const COLORS = Object.freeze({
  soilDamp: new THREE.Color(0x3b4c39),
  soilMineral: new THREE.Color(0x806c49),
  soilHeath: new THREE.Color(0x4b5738),
  soilAlluvium: new THREE.Color(0x756748),
  soilDrainage: new THREE.Color(0x304236),
  soilOxide: new THREE.Color(0x8c5d3c),
  soilStony: new THREE.Color(0x716a58),
  grassDry: new THREE.Color(0x7b774c),
  grassLush: new THREE.Color(0x3e5639),
  rockCool: new THREE.Color(0x50595a),
  rockIron: new THREE.Color(0x7d6049),
  rockLichen: new THREE.Color(0x5b684e),
  rockExposed: new THREE.Color(0x837968),
  rockWetFracture: new THREE.Color(0x40494b),
  rockTalus: new THREE.Color(0x8e7e68),
  rockScree: new THREE.Color(0x6c665b),
  snowShadow: new THREE.Color(0xb9c6c7),
  snowCrust: new THREE.Color(0xe3e3d8),
  lakeCold: new THREE.Color(0x526d72),
  lakeSilt: new THREE.Color(0x69786c),
});

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

const ridge01 = (value) => 1 - Math.abs(value * 2 - 1);

function sampleFabric(worldX, worldZ) {
  const P = WESTERN_REFERENCE_SURFACE_FABRIC_POLICY;
  const warpX = valueNoise2D(worldX + 910, worldZ - 470, 2240, 13.4) - 0.5;
  const warpZ = valueNoise2D(worldX - 620, worldZ + 840, 1910, 17.8) - 0.5;
  const secondaryWarp = valueNoise2D(worldX + worldZ * 0.19, worldZ - worldX * 0.13, 760, 21.9) - 0.5;
  const x = worldX + warpX * P.warpMeters + secondaryWarp * 54;
  const z = worldZ + warpZ * P.warpMeters - secondaryWarp * 39;

  const continental = valueNoise2D(x + z * 0.11 - 1180, z - x * 0.07 + 760, P.continentalMeters, 1.6);
  const broadPrimary = valueNoise2D(x - 740, z + 520, P.broadReliefMeters, 2.9);
  const broadRelief = clamp01(broadPrimary * 0.70 + ridge01(continental) * 0.30);
  const macro = valueNoise2D(x + 130, z - 280, P.macroMeters, 3.7);
  const meso = valueNoise2D(x - 390, z + 170, P.mesoMeters, 7.9);
  const fine = valueNoise2D(x + 210, z + 360, P.fineMeters, 11.3);
  const micro = valueNoise2D(x - 80, z - 110, P.microMeters, 19.7);
  const subMicro = valueNoise2D(x + z * 0.11 + 37, z - x * 0.07 - 53, P.subMicroMeters, 67.1);

  const aerialPrimary = ridge01(valueNoise2D(
    x + z * 0.29 + warpX * 118,
    z - x * 0.18 + warpZ * 96,
    P.aerialReliefMeters,
    101.3,
  ));
  const aerialCross = valueNoise2D(
    x - z * 0.37 + secondaryWarp * 105,
    z + x * 0.22 - secondaryWarp * 84,
    P.aerialReliefMeters * 1.47,
    103.9,
  );
  const aerialRelief = clamp01(aerialPrimary * 0.68 + aerialCross * 0.32);
  const surfaceCarrier = clamp01(
    ridge01(valueNoise2D(
      x + z * 0.43 + warpX * 52,
      z - x * 0.26 + warpZ * 46,
      P.surfaceCarrierMeters,
      107.7,
    )) * 0.62
      + valueNoise2D(
        x - z * 0.17 + secondaryWarp * 37,
        z + x * 0.31 - secondaryWarp * 31,
        P.surfaceCarrierMeters * 1.73,
        109.1,
      ) * 0.38,
  );

  const moisture = clamp01(
    macro * 0.35 + broadRelief * 0.10 + meso * 0.21 + (1 - ridge01(fine)) * 0.10 + micro * 0.05
      + valueNoise2D(x - 440, z + 190, P.wetHollowMeters, 79.3) * 0.10
      + (1 - aerialRelief) * 0.06 + (1 - surfaceCarrier) * 0.03,
  );
  const mineralBase = clamp01(
    (1 - macro) * 0.22 + (1 - broadRelief) * 0.10 + ridge01(meso) * 0.23 + fine * 0.17
      + ridge01(micro) * 0.08 + ridge01(subMicro) * 0.07
      + aerialRelief * 0.07 + surfaceCarrier * 0.06,
  );
  const mineral = clamp01(0.5 + (mineralBase - 0.5) * 1.10);
  const weathering = clamp01(
    ridge01(valueNoise2D(x + z * 0.17, z - x * 0.11, 640, 23.1)) * 0.37
      + meso * 0.20 + broadRelief * 0.11 + fine * 0.09
      + ridge01(valueNoise2D(x - 90, z + 160, 230, 24.8)) * 0.07
      + aerialRelief * 0.10 + surfaceCarrier * 0.06,
  );
  const streak = ridge01(valueNoise2D(x + z * 0.23, z - x * 0.31, 178, 29.6));
  const crust = ridge01(valueNoise2D(x - z * 0.16, z + x * 0.28, 132, 37.4));

  const drainageCarrier = ridge01(valueNoise2D(
    x + z * 0.34 + warpX * 210,
    z - x * 0.19 + warpZ * 170,
    P.drainageMeters,
    41.7,
  ));
  const drainageThread = smoothstep(0.78, 0.958, drainageCarrier)
    * smoothstep(0.29, 0.82, moisture) * (0.50 + meso * 0.50);
  const braidedCarrier = ridge01(valueNoise2D(
    x - z * 0.41 + secondaryWarp * 126,
    z + x * 0.23 - warpX * 88,
    P.braidedDrainageMeters,
    43.9,
  ));
  const braidedDrainage = smoothstep(0.72, 0.94, braidedCarrier)
    * smoothstep(0.34, 0.84, moisture) * (0.38 + (1 - aerialRelief) * 0.36 + surfaceCarrier * 0.26)
    * (1 - drainageThread * 0.42);
  const wetHollow = smoothstep(0.57, 0.87, valueNoise2D(
    x - z * 0.12 - 170,
    z + x * 0.10 + 260,
    P.wetHollowMeters,
    83.7,
  )) * smoothstep(0.43, 0.82, moisture) * (1 - smoothstep(0.72, 0.94, mineral));
  const alluvium = smoothstep(0.48, 0.84, valueNoise2D(
    x - z * 0.13,
    z + x * 0.09,
    P.alluviumMeters,
    47.3,
  )) * smoothstep(0.32, 0.78, moisture) * (1 - drainageThread * 0.46);
  const depositionalFan = smoothstep(0.43, 0.80, valueNoise2D(
    x + z * 0.24 + warpX * 260,
    z - x * 0.10 + warpZ * 180,
    P.depositionalFanMeters,
    111.7,
  )) * smoothstep(0.27, 0.76, moisture) * (1 - smoothstep(0.74, 0.94, mineral))
    * (0.46 + alluvium * 0.36 + (1 - aerialRelief) * 0.18);
  const terrace = smoothstep(0.61, 0.90, ridge01(valueNoise2D(
    x - z * 0.28 + secondaryWarp * 120,
    z + x * 0.16 - secondaryWarp * 90,
    P.terraceMeters,
    113.9,
  ))) * smoothstep(0.34, 0.80, weathering) * (1 - wetHollow * 0.54)
    * (0.40 + broadRelief * 0.32 + surfaceCarrier * 0.28);
  const microTerrace = smoothstep(0.64, 0.92, ridge01(valueNoise2D(
    x + z * 0.31 + secondaryWarp * 48,
    z - x * 0.18 - warpZ * 36,
    P.microTerraceMeters,
    117.3,
  ))) * smoothstep(0.38, 0.84, weathering) * (1 - wetHollow * 0.62)
    * (0.34 + terrace * 0.32 + surfaceCarrier * 0.22 + mineral * 0.12);
  const colluvium = smoothstep(0.55, 0.88, valueNoise2D(
    x + z * 0.08 + 310,
    z - x * 0.15 - 220,
    P.colluviumMeters,
    87.1,
  )) * smoothstep(0.43, 0.86, mineral) * smoothstep(0.42, 0.84, weathering)
    * (1 - wetHollow * 0.44);
  const exposedInterfluve = smoothstep(0.56, 0.90, mineral)
    * smoothstep(0.50, 0.87, weathering) * (1 - smoothstep(0.44, 0.80, moisture));
  const stonyPatch = smoothstep(0.56, 0.91, ridge01(
    subMicro * 0.48 + fine * 0.27 + surfaceCarrier * 0.25,
  )) * smoothstep(0.43, 0.86, mineral) * (1 - smoothstep(0.65, 0.90, moisture));
  const fracture = smoothstep(0.72, 0.945, ridge01(valueNoise2D(
    x + z * 0.41 + warpX * 96,
    z - x * 0.27 + warpZ * 84,
    P.fractureMeters,
    53.9,
  ))) * (0.40 + weathering * 0.37 + moisture * 0.23);
  const frostWash = smoothstep(0.50, 0.86, valueNoise2D(
    x - z * 0.22,
    z + x * 0.18,
    P.frostWashMeters,
    61.4,
  )) * smoothstep(0.45, 0.84, mineral) * (1 - smoothstep(0.57, 0.88, moisture))
    * (1 - drainageThread * 0.45);
  const erosionScour = smoothstep(0.68, 0.94, ridge01(valueNoise2D(
    x + z * 0.53 + warpX * 80,
    z - x * 0.08 + warpZ * 60,
    P.erosionMeters,
    71.3,
  ))) * (0.29 + weathering * 0.39 + mineral * 0.24 + aerialRelief * 0.08)
    * (1 - drainageThread * 0.31);
  const heathMosaic = smoothstep(0.42, 0.83, valueNoise2D(
    x - z * 0.21,
    z + x * 0.17,
    P.heathMosaicMeters,
    73.9,
  )) * (1 - smoothstep(0.61, 0.90, moisture));
  const pastureBreak = smoothstep(0.36, 0.72, valueNoise2D(
    x + z * 0.07 + 540,
    z - x * 0.05 - 320,
    P.pastureBreakMeters,
    91.6,
  )) * (1 - smoothstep(0.68, 0.92, mineral)) * (1 - exposedInterfluve * 0.52);
  const dryBench = smoothstep(0.46, 0.82, valueNoise2D(
    x - z * 0.14 + 690,
    z + x * 0.08 - 430,
    P.dryBenchMeters,
    97.2,
  )) * smoothstep(0.38, 0.80, weathering) * (1 - smoothstep(0.48, 0.80, moisture))
    * (1 - drainageThread * 0.60) * (0.42 + broadRelief * 0.34 + aerialRelief * 0.24);

  return {
    continental, broadRelief, macro, meso, fine, micro, subMicro, aerialRelief, surfaceCarrier,
    moisture, mineral, weathering, streak, crust,
    stonyPatch: clamp01(stonyPatch),
    drainageThread: clamp01(drainageThread),
    braidedDrainage: clamp01(braidedDrainage),
    wetHollow: clamp01(wetHollow),
    alluvium: clamp01(alluvium),
    depositionalFan: clamp01(depositionalFan),
    terrace: clamp01(terrace),
    microTerrace: clamp01(microTerrace),
    colluvium: clamp01(colluvium),
    exposedInterfluve: clamp01(exposedInterfluve),
    fracture: clamp01(fracture),
    frostWash: clamp01(frostWash),
    erosionScour: clamp01(erosionScour),
    heathMosaic: clamp01(heathMosaic),
    pastureBreak: clamp01(pastureBreak),
    dryBench: clamp01(dryBench),
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

function soilColor(base, f) {
  const shade = 1
    + (f.broadRelief - 0.5) * 0.220 + (f.continental - 0.5) * 0.070
    + (f.aerialRelief - 0.5) * 0.228 + (f.surfaceCarrier - 0.5) * 0.154
    + (f.macro - 0.5) * 0.154 + (f.meso - 0.5) * 0.138
    + (f.fine - 0.5) * 0.060 + (f.micro - 0.5) * 0.020 + (f.subMicro - 0.5) * 0.012
    - f.drainageThread * 0.132 - f.braidedDrainage * 0.106 - f.wetHollow * 0.112 + f.exposedInterfluve * 0.074
    + f.frostWash * 0.064 + f.colluvium * 0.050 + f.stonyPatch * 0.036
    - f.erosionScour * 0.150 - f.heathMosaic * 0.044 + (f.pastureBreak - 0.5) * 0.040
    + f.dryBench * 0.186 + f.alluvium * 0.038 - f.depositionalFan * 0.082 + f.terrace * 0.136 + f.microTerrace * 0.088;
  shadeColor(base, THREE.MathUtils.clamp(shade, 0.50, 1.50));
  tint(base, COLORS.soilDamp, smoothstep(0.48, 0.83, f.moisture) * 0.252);
  tint(base, COLORS.soilMineral, smoothstep(0.51, 0.86, f.mineral) * 0.228);
  tint(base, COLORS.soilHeath, clamp01(smoothstep(0.56, 0.89, f.weathering) * (1 - f.moisture) * 0.184 + f.heathMosaic * 0.178));
  tint(base, COLORS.soilDrainage, clamp01(f.drainageThread * 0.278 + f.braidedDrainage * 0.224 + f.wetHollow * 0.172));
  tint(base, COLORS.soilAlluvium, clamp01(f.alluvium * 0.166 + f.depositionalFan * 0.214 + f.braidedDrainage * f.alluvium * 0.086));
  tint(base, COLORS.soilOxide, clamp01(f.frostWash * f.exposedInterfluve * 0.216 + f.dryBench * f.mineral * 0.190 + f.terrace * f.mineral * 0.164 + f.microTerrace * f.mineral * 0.104));
  tint(base, COLORS.soilStony, clamp01(f.stonyPatch * 0.188 + f.erosionScour * f.mineral * 0.164 + f.colluvium * 0.112 + f.dryBench * 0.152 + f.terrace * 0.138 + f.microTerrace * 0.092));
  tint(base, COLORS.grassLush, f.pastureBreak * f.moisture * 0.134);
  tint(base, COLORS.grassDry, clamp01(f.pastureBreak * (1 - f.moisture) * 0.116 + f.dryBench * 0.168 + f.terrace * (1 - f.moisture) * 0.142 + f.microTerrace * (1 - f.moisture) * 0.078));
}

function rockColor(base, f) {
  const strata = ridge01((f.streak * 0.74 + f.meso * 0.26) % 1);
  const shade = 1
    + (f.broadRelief - 0.5) * 0.132 + (f.continental - 0.5) * 0.052
    + (f.aerialRelief - 0.5) * 0.150 + (f.surfaceCarrier - 0.5) * 0.096
    + (f.macro - 0.5) * 0.100 + (strata - 0.5) * 0.146
    + (f.fine - 0.5) * 0.056 + (f.micro - 0.5) * 0.026 + (f.subMicro - 0.5) * 0.026
    + f.exposedInterfluve * 0.080 - f.fracture * 0.172 + f.frostWash * 0.088
    + f.colluvium * 0.044 - f.stonyPatch * 0.030 - f.erosionScour * 0.132 + f.dryBench * 0.112
    + f.terrace * 0.078 + f.microTerrace * 0.056 - f.depositionalFan * 0.034 - f.braidedDrainage * 0.036;
  shadeColor(base, THREE.MathUtils.clamp(shade, 0.52, 1.48));
  tint(base, COLORS.rockCool, smoothstep(0.51, 0.85, f.moisture) * 0.172);
  tint(base, COLORS.rockIron, smoothstep(0.53, 0.87, f.mineral) * 0.194);
  tint(base, COLORS.rockLichen, smoothstep(0.60, 0.90, f.weathering) * f.moisture * 0.124);
  tint(base, COLORS.rockExposed, clamp01(f.exposedInterfluve * 0.170 + f.erosionScour * 0.120 + f.dryBench * 0.140 + f.terrace * 0.132 + f.microTerrace * 0.084));
  tint(base, COLORS.rockWetFracture, f.fracture * (0.142 + f.moisture * 0.188));
  tint(base, COLORS.rockTalus, clamp01(f.frostWash * 0.138 + f.colluvium * 0.128));
  tint(base, COLORS.rockScree, f.stonyPatch * (0.160 + f.weathering * 0.092));
}

function snowColor(base, f) {
  const windCrust = smoothstep(0.57, 0.88, f.crust);
  const grit = smoothstep(0.67, 0.93, f.mineral) * (1 - f.moisture);
  const shade = 1
    + (f.macro - 0.5) * 0.026 + (f.meso - 0.5) * 0.032
    + (f.aerialRelief - 0.5) * 0.012 + (f.surfaceCarrier - 0.5) * 0.008
    + (windCrust - 0.5) * 0.038 + (f.subMicro - 0.5) * 0.010
    - grit * 0.025 - f.drainageThread * 0.014 - f.fracture * 0.012
    - f.frostWash * 0.014 - f.stonyPatch * 0.011 - f.erosionScour * 0.009;
  shadeColor(base, THREE.MathUtils.clamp(shade, 0.920, 1.068));
  tint(base, COLORS.snowShadow, smoothstep(0.60, 0.90, f.moisture) * 0.056);
  tint(base, COLORS.snowCrust, windCrust * 0.058);
}

function lakeColor(base, f) {
  const shade = 1
    + (f.macro - 0.5) * 0.026
    + (f.meso - 0.5) * 0.022
    + (f.fine - 0.5) * 0.012;
  shadeColor(base, THREE.MathUtils.clamp(shade, 0.965, 1.035));
  tint(base, COLORS.lakeCold, smoothstep(0.48, 0.82, f.macro) * 0.045);
  tint(base, COLORS.lakeSilt, smoothstep(0.52, 0.88, f.mineral) * 0.030);
}

/**
 * Applies bounded world-space albedo variation to an already-authoritative surface class.
 * Sea is exact-neutral here because westernMarineShelfTone.js owns west-ocean optics.
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