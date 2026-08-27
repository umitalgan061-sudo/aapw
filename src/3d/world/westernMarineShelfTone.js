/**
 * Render-only west-ocean seabed tone shared by Pindex 01-03 runtime detail passes.
 *
 * The canonical surface classifier remains the authority: only vertices already classified as
 * `sea` may receive this correction. The weight is expressed in global owner-map normalized X,
 * not in local Pindex coordinates, so it crosses the 01/02 and 02/03 boundaries continuously and
 * fades to exact zero before the western shelf treatment reaches the interior sea.
 * @module world/westernMarineShelfTone
 */
import * as THREE from 'three';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;

export const WESTERN_MARINE_SHELF_TONE_POLICY = Object.freeze({
  id: 'western-marine-shelf-tone-2026-08-27-v10-mudflow-shell-pavement',
  renderOnly: true,
  canonicalSeaOnly: true,
  geographyAuthorityUnchanged: true,
  fullStrengthNormalizedX: 0.035,
  fadeEndNormalizedX: 0.40,
  maxBlend: 0.74,
  fabricGainMin: 0.78,
  fabricGainMax: 0.99,
  macroVariation: 0.115,
  mesoVariation: 0.078,
  fineVariation: 0.034,
  domainWarpNormalized: 0.014,
  sedimentBandVariation: 0.115,
  currentScourVariation: 0.092,
  turbidityVariation: 0.078,
  fanVariation: 0.085,
  bedformVariation: 0.062,
  mineralRidgeVariation: 0.070,
  currentShearVariation: 0.055,
  sedimentPocketVariation: 0.065,
  shelfBreakVariation: 0.050,
  channelScarVariation: 0.052,
  gravelLagVariation: 0.046,
  anoxicSiltVariation: 0.050,
  mudflowVariation: 0.052,
  shellPavementVariation: 0.044,
  targetColorHex: 0x162f3b,
  coolPatchColorHex: 0x183945,
  mineralPatchColorHex: 0x243a40,
  siltPatchColorHex: 0x2a3e3d,
  deepPatchColorHex: 0x0f2832,
  sandPatchColorHex: 0x334745,
  ironPatchColorHex: 0x3b4140,
  gravelPatchColorHex: 0x4a504b,
  anoxicPatchColorHex: 0x132a2b,
  mudflowPatchColorHex: 0x263b3b,
  shellPatchColorHex: 0x56605a,
});

const TARGET_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.targetColorHex);
const COOL_PATCH_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.coolPatchColorHex);
const MINERAL_PATCH_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.mineralPatchColorHex);
const SILT_PATCH_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.siltPatchColorHex);
const DEEP_PATCH_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.deepPatchColorHex);
const SAND_PATCH_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.sandPatchColorHex);
const IRON_PATCH_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.ironPatchColorHex);
const GRAVEL_PATCH_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.gravelPatchColorHex);
const ANOXIC_PATCH_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.anoxicPatchColorHex);
const MUDFLOW_PATCH_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.mudflowPatchColorHex);
const SHELL_PATCH_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.shellPatchColorHex);

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hash01(ix, iy, seed) {
  const value = Math.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise2D(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash01(x0, y0, seed);
  const n10 = hash01(x0 + 1, y0, seed);
  const n01 = hash01(x0, y0 + 1, seed);
  const n11 = hash01(x0 + 1, y0 + 1, seed);
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

function ridge01(value) {
  return 1 - Math.abs(value * 2 - 1);
}

function shelfFabric(normalizedX, normalizedY) {
  const warpX = valueNoise2D(normalizedX * 2.7 + 5.1, normalizedY * 3.3 - 2.8, 13.7) - 0.5;
  const warpY = valueNoise2D(normalizedX * 3.7 - 4.4, normalizedY * 2.9 + 6.2, 17.9) - 0.5;
  const warpedX = normalizedX + warpX * WESTERN_MARINE_SHELF_TONE_POLICY.domainWarpNormalized;
  const warpedY = normalizedY + warpY * WESTERN_MARINE_SHELF_TONE_POLICY.domainWarpNormalized;

  const macro = valueNoise2D(warpedX * 3.1 + 0.7, warpedY * 4.3 - 1.4, 1.7);
  const meso = valueNoise2D(warpedX * 8.7 - 2.1, warpedY * 11.9 + 0.8, 5.3);
  const fine = valueNoise2D(warpedX * 21.1 + 4.2, warpedY * 17.3 - 3.6, 9.1);
  const basin = valueNoise2D(warpedX * 2.15 - 6.8, warpedY * 2.65 + 8.1, 42.6);

  const sedimentPhaseA = warpedX * 14.7 + warpedY * 4.9 + macro * 1.85 - meso * 0.72;
  const sedimentPhaseB = warpedX * 6.2 - warpedY * 12.8 + meso * 1.34 + fine * 0.41;
  const sedimentBands = clamp01(
    ridge01(valueNoise2D(sedimentPhaseA, sedimentPhaseB, 23.4)) * 0.66
      + ridge01(valueNoise2D(sedimentPhaseB * 0.71, sedimentPhaseA * 0.53, 29.2)) * 0.34,
  );

  const fanFieldA = ridge01(valueNoise2D(warpedX * 5.3 + basin * 1.4, warpedY * 3.9 - macro * 0.9, 47.2));
  const fanFieldB = valueNoise2D(warpedX * 6.8 - meso * 1.1, warpedY * 5.1 + basin * 1.7, 53.9);
  const depositionalFan = smoothstep(0.52, 0.87, fanFieldA * 0.62 + fanFieldB * 0.38)
    * smoothstep(0.36, 0.78, basin * 0.58 + (1 - macro) * 0.42);

  const scourBase = ridge01(valueNoise2D(warpedX * 16.3 + meso * 1.8, warpedY * 7.1 - macro * 1.2, 31.7));
  const currentScour = smoothstep(0.64, 0.91, scourBase) * (0.42 + fine * 0.58);
  const bedformBase = ridge01(valueNoise2D(
    warpedX * 24.7 + warpedY * 7.4 + basin * 2.1,
    warpedY * 18.6 - warpedX * 5.8 + meso * 1.3,
    61.4,
  ));
  const bedforms = smoothstep(0.70, 0.94, bedformBase) * (0.30 + sedimentBands * 0.70);

  const mineralRidge = smoothstep(
    0.63,
    0.89,
    ridge01(valueNoise2D(warpedX * 9.4 + basin, warpedY * 6.7 - macro * 0.8, 67.8)),
  ) * (0.44 + meso * 0.56);
  const turbidity = smoothstep(
    0.50,
    0.87,
    (1 - macro) * 0.40 + meso * 0.20 + sedimentBands * 0.13 + depositionalFan * 0.27,
  ) * (1 - currentScour * 0.42);

  const shearA = ridge01(valueNoise2D(
    warpedX * 11.8 + warpedY * 4.1 + basin * 1.2,
    warpedY * 5.6 - warpedX * 2.7 + meso * 0.9,
    73.6,
  ));
  const shearB = ridge01(valueNoise2D(
    warpedX * 5.2 - warpedY * 10.4 - macro * 0.8,
    warpedY * 12.6 + warpedX * 3.3 + fine * 0.7,
    79.3,
  ));
  const currentShear = clamp01(shearA * 0.57 + shearB * 0.43);

  const pocketField = valueNoise2D(
    warpedX * 7.6 + currentShear * 1.1,
    warpedY * 8.9 - basin * 1.4,
    83.1,
  );
  const sedimentPocket = smoothstep(0.58, 0.88, pocketField * 0.58 + (1 - currentScour) * 0.24 + basin * 0.18);

  const shelfBreakBase = ridge01(valueNoise2D(
    warpedX * 10.2 + warpedY * 2.9 + macro * 0.75,
    warpedY * 4.4 - warpedX * 8.1 + basin * 0.95,
    89.7,
  ));
  const shelfBreakStreak = smoothstep(0.68, 0.94, shelfBreakBase) * (0.32 + basin * 0.68);

  const channelAxis = valueNoise2D(
    warpedX * 8.2 + warpedY * 2.4 + basin * 1.6,
    warpedY * 5.4 - warpedX * 3.1 + currentShear * 0.9,
    97.3,
  );
  const channelCross = ridge01(valueNoise2D(
    warpedX * 17.8 + channelAxis * 1.5,
    warpedY * 6.4 - macro * 0.7 + meso * 0.6,
    101.9,
  ));
  const channelScar = smoothstep(0.78, 0.96, channelCross)
    * smoothstep(0.30, 0.82, currentShear * 0.56 + currentScour * 0.44);

  const gravelBase = valueNoise2D(
    warpedX * 18.6 + mineralRidge * 1.7,
    warpedY * 16.2 - currentScour * 1.2,
    107.4,
  );
  const gravelLag = smoothstep(0.68, 0.93, gravelBase * 0.50 + mineralRidge * 0.28 + currentScour * 0.22)
    * (0.38 + bedforms * 0.62);

  const anoxicBase = valueNoise2D(
    warpedX * 6.1 - sedimentPocket * 0.8,
    warpedY * 7.3 + basin * 1.2,
    113.8,
  );
  const anoxicSilt = smoothstep(0.62, 0.90, anoxicBase * 0.48 + basin * 0.30 + sedimentPocket * 0.22)
    * (1 - currentScour * 0.62)
    * (1 - gravelLag * 0.38);

  // Broad mass-transport lobes sit in sheltered basin lows, with unrelated warp/scale to the
  // existing fan and channel fields. They are purely tonal and cannot change bathymetry.
  const mudflowBase = valueNoise2D(
    warpedX * 4.7 + basin * 1.9 - currentShear * 0.6,
    warpedY * 5.9 - macro * 1.1 + sedimentPocket * 0.8,
    121.6,
  );
  const mudflowLobe = smoothstep(0.59, 0.90, mudflowBase * 0.50 + basin * 0.30 + sedimentPocket * 0.20)
    * (1 - currentScour * 0.46)
    * (1 - gravelLag * 0.24);

  // Sparse shell pavement appears on winnowed shoulders where scour and bedforms overlap. The
  // independent high-frequency field prevents gravel and shell highlights from repeating together.
  const shellBase = valueNoise2D(
    warpedX * 27.4 - currentShear * 1.3 + 2.7,
    warpedY * 23.1 + mineralRidge * 1.1 - 4.2,
    127.9,
  );
  const shellPavement = smoothstep(0.76, 0.96, shellBase * 0.52 + currentScour * 0.25 + bedforms * 0.23)
    * (0.34 + mineralRidge * 0.66)
    * (1 - anoxicSilt * 0.58);

  return {
    macro,
    meso,
    fine,
    basin,
    sedimentBands,
    currentScour,
    depositionalFan,
    bedforms,
    mineralRidge,
    turbidity,
    currentShear,
    sedimentPocket,
    shelfBreakStreak,
    channelScar,
    gravelLag,
    anoxicSilt,
    mudflowLobe,
    shellPavement,
  };
}

export function westernMarineShelfToneWeight({ surface, normalizedX, normalizedY }) {
  if (surface !== 'sea') return 0;
  const x = Number.isFinite(normalizedX) ? normalizedX : 1;
  const y = Number.isFinite(normalizedY) ? normalizedY : 0.5;
  const westWeight = 1 - smoothstep(
    WESTERN_MARINE_SHELF_TONE_POLICY.fullStrengthNormalizedX,
    WESTERN_MARINE_SHELF_TONE_POLICY.fadeEndNormalizedX,
    x,
  );
  if (westWeight <= 0) return 0;

  const fabric = shelfFabric(x, y);
  const modulation = 1
    - WESTERN_MARINE_SHELF_TONE_POLICY.macroVariation * 0.5
    - WESTERN_MARINE_SHELF_TONE_POLICY.mesoVariation * 0.5
    - WESTERN_MARINE_SHELF_TONE_POLICY.fineVariation * 0.5
    + (fabric.macro - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.macroVariation
    + (fabric.meso - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.mesoVariation
    + (fabric.fine - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.fineVariation
    + (fabric.sedimentBands - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.sedimentBandVariation * 0.32
    + (fabric.depositionalFan - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.fanVariation * 0.22
    + (fabric.mineralRidge - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.mineralRidgeVariation * 0.18
    + (fabric.currentShear - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.currentShearVariation * 0.14
    + (fabric.sedimentPocket - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.sedimentPocketVariation * 0.12
    + (fabric.shelfBreakStreak - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.shelfBreakVariation * 0.10
    + (fabric.channelScar - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.channelScarVariation * 0.08
    + (fabric.gravelLag - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.gravelLagVariation * 0.06
    + (fabric.mudflowLobe - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.mudflowVariation * 0.07
    + (fabric.shellPavement - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.shellPavementVariation * 0.05
    - fabric.currentScour * WESTERN_MARINE_SHELF_TONE_POLICY.currentScourVariation * 0.19
    - fabric.anoxicSilt * WESTERN_MARINE_SHELF_TONE_POLICY.anoxicSiltVariation * 0.04;

  const fabricGain = THREE.MathUtils.clamp(
    modulation + 0.14,
    WESTERN_MARINE_SHELF_TONE_POLICY.fabricGainMin,
    WESTERN_MARINE_SHELF_TONE_POLICY.fabricGainMax,
  );
  return clamp01(WESTERN_MARINE_SHELF_TONE_POLICY.maxBlend * westWeight * fabricGain);
}

export function applyWesternMarineShelfToneToColorAttribute(color, index, classification) {
  const weight = westernMarineShelfToneWeight(classification);
  if (weight <= 0) return 0;

  const x = Number.isFinite(classification?.normalizedX) ? classification.normalizedX : 1;
  const y = Number.isFinite(classification?.normalizedY) ? classification.normalizedY : 0.5;
  const fabric = shelfFabric(x, y);

  const coolWeight = smoothstep(0.56, 0.88, fabric.macro) * 0.33;
  const mineralWeight = smoothstep(0.58, 0.90, fabric.meso) * (0.17 + fabric.sedimentBands * 0.13);
  const siltWeight = fabric.turbidity * WESTERN_MARINE_SHELF_TONE_POLICY.turbidityVariation * 1.75;
  const scourWeight = fabric.currentScour * WESTERN_MARINE_SHELF_TONE_POLICY.currentScourVariation * 1.68;
  const fanWeight = fabric.depositionalFan * WESTERN_MARINE_SHELF_TONE_POLICY.fanVariation * 1.45;
  const ironWeight = fabric.mineralRidge * WESTERN_MARINE_SHELF_TONE_POLICY.mineralRidgeVariation * 1.30;
  const pocketWeight = fabric.sedimentPocket * WESTERN_MARINE_SHELF_TONE_POLICY.sedimentPocketVariation * 1.28;
  const shearWeight = fabric.currentShear * WESTERN_MARINE_SHELF_TONE_POLICY.currentShearVariation * 0.72;
  const shelfBreakWeight = fabric.shelfBreakStreak * WESTERN_MARINE_SHELF_TONE_POLICY.shelfBreakVariation * 0.82;
  const channelWeight = fabric.channelScar * WESTERN_MARINE_SHELF_TONE_POLICY.channelScarVariation * 1.32;
  const gravelWeight = fabric.gravelLag * WESTERN_MARINE_SHELF_TONE_POLICY.gravelLagVariation * 1.18;
  const anoxicWeight = fabric.anoxicSilt * WESTERN_MARINE_SHELF_TONE_POLICY.anoxicSiltVariation * 1.20;
  const mudflowWeight = fabric.mudflowLobe * WESTERN_MARINE_SHELF_TONE_POLICY.mudflowVariation * 1.20;
  const shellWeight = fabric.shellPavement * WESTERN_MARINE_SHELF_TONE_POLICY.shellPavementVariation * 1.22;

  const target = TARGET_COLOR.clone()
    .lerp(COOL_PATCH_COLOR, coolWeight)
    .lerp(MINERAL_PATCH_COLOR, mineralWeight)
    .lerp(SILT_PATCH_COLOR, clamp01(siltWeight + pocketWeight * 0.46))
    .lerp(SAND_PATCH_COLOR, clamp01(fanWeight + pocketWeight * 0.54))
    .lerp(IRON_PATCH_COLOR, clamp01(ironWeight + shelfBreakWeight * 0.42))
    .lerp(MUDFLOW_PATCH_COLOR, clamp01(mudflowWeight))
    .lerp(GRAVEL_PATCH_COLOR, clamp01(gravelWeight))
    .lerp(SHELL_PATCH_COLOR, clamp01(shellWeight))
    .lerp(DEEP_PATCH_COLOR, clamp01(scourWeight + shearWeight * 0.33 + channelWeight * 0.46))
    .lerp(ANOXIC_PATCH_COLOR, clamp01(anoxicWeight));

  const fineValue = 0.958
    + (fabric.fine - 0.5) * 0.078
    + (fabric.sedimentBands - 0.5) * 0.050
    + (fabric.bedforms - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.bedformVariation * 0.34
    + (fabric.currentShear - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.currentShearVariation * 0.16
    + (fabric.shelfBreakStreak - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.shelfBreakVariation * 0.12
    + (fabric.gravelLag - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.gravelLagVariation * 0.10
    + (fabric.shellPavement - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.shellPavementVariation * 0.08
    - fabric.channelScar * WESTERN_MARINE_SHELF_TONE_POLICY.channelScarVariation * 0.08
    - fabric.mudflowLobe * WESTERN_MARINE_SHELF_TONE_POLICY.mudflowVariation * 0.06
    + (fabric.basin - 0.5) * 0.026;
  target.multiplyScalar(fineValue);

  color.setXYZ(
    index,
    lerp(color.getX(index), target.r, weight),
    lerp(color.getY(index), target.g, weight),
    lerp(color.getZ(index), target.b, weight),
  );
  return weight;
}