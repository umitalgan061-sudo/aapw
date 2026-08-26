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
  id: 'western-marine-shelf-tone-2026-08-26-v4-domain-warped-sediment-fabric',
  renderOnly: true,
  canonicalSeaOnly: true,
  geographyAuthorityUnchanged: true,
  fullStrengthNormalizedX: 0.04,
  fadeEndNormalizedX: 0.34,
  maxBlend: 0.78,
  macroVariation: 0.10,
  mesoVariation: 0.065,
  fineVariation: 0.030,
  domainWarpNormalized: 0.012,
  sedimentBandVariation: 0.10,
  currentScourVariation: 0.075,
  turbidityVariation: 0.065,
  targetColorHex: 0x162f3b,
  coolPatchColorHex: 0x193744,
  mineralPatchColorHex: 0x213840,
  siltPatchColorHex: 0x263b3d,
  deepPatchColorHex: 0x102933,
});

const TARGET_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.targetColorHex);
const COOL_PATCH_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.coolPatchColorHex);
const MINERAL_PATCH_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.mineralPatchColorHex);
const SILT_PATCH_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.siltPatchColorHex);
const DEEP_PATCH_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.deepPatchColorHex);

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
  // A low-frequency owner-map-space warp prevents all subordinate layers from sharing straight
  // axes. Because the warp itself is global owner-map space, Pindex boundaries cannot reset it.
  const warpX = valueNoise2D(normalizedX * 2.7 + 5.1, normalizedY * 3.3 - 2.8, 13.7) - 0.5;
  const warpY = valueNoise2D(normalizedX * 3.7 - 4.4, normalizedY * 2.9 + 6.2, 17.9) - 0.5;
  const warpedX = normalizedX + warpX * WESTERN_MARINE_SHELF_TONE_POLICY.domainWarpNormalized;
  const warpedY = normalizedY + warpY * WESTERN_MARINE_SHELF_TONE_POLICY.domainWarpNormalized;

  // Incommensurate scales provide shelf-wide mineral provinces, meso sediment patches and fine bed
  // mottling without the diagonal sine banding of the first implementation.
  const macro = valueNoise2D(warpedX * 3.1 + 0.7, warpedY * 4.3 - 1.4, 1.7);
  const meso = valueNoise2D(warpedX * 8.7 - 2.1, warpedY * 11.9 + 0.8, 5.3);
  const fine = valueNoise2D(warpedX * 21.1 + 4.2, warpedY * 17.3 - 3.6, 9.1);

  // Sediment ribbons loosely follow the continental shelf rather than a fixed image-space axis.
  // Two differently oriented terms are warped by macro/meso noise so they read as deposited beds,
  // not mathematical contour stripes.
  const sedimentPhaseA = warpedX * 14.7 + warpedY * 4.9 + macro * 1.85 - meso * 0.72;
  const sedimentPhaseB = warpedX * 6.2 - warpedY * 12.8 + meso * 1.34 + fine * 0.41;
  const sedimentBands = clamp01(
    ridge01(valueNoise2D(sedimentPhaseA, sedimentPhaseB, 23.4)) * 0.66
      + ridge01(valueNoise2D(sedimentPhaseB * 0.71, sedimentPhaseA * 0.53, 29.2)) * 0.34,
  );

  // Current scour is intentionally sparse: only the higher ridge tail contributes strongly, so the
  // shelf does not become uniformly streaked. Turbidity is broader and favors quieter macro basins.
  const scourBase = ridge01(valueNoise2D(warpedX * 16.3 + meso * 1.8, warpedY * 7.1 - macro * 1.2, 31.7));
  const currentScour = smoothstep(0.64, 0.91, scourBase) * (0.42 + fine * 0.58);
  const turbidity = smoothstep(0.52, 0.86, (1 - macro) * 0.56 + meso * 0.28 + sedimentBands * 0.16);

  return { macro, meso, fine, sedimentBands, currentScour, turbidity };
}

/**
 * Returns the bounded optical tint weight for one canonical surface classification.
 * Non-sea surfaces are exact-neutral, including lakes inside the western Pindexes.
 */
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
    + (fabric.sedimentBands - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.sedimentBandVariation * 0.30
    - fabric.currentScour * WESTERN_MARINE_SHELF_TONE_POLICY.currentScourVariation * 0.18;
  return clamp01(WESTERN_MARINE_SHELF_TONE_POLICY.maxBlend * westWeight * Math.max(0.72, modulation + 0.12));
}

/** Applies the marine-only tone directly to an existing terrain colour attribute. */
export function applyWesternMarineShelfToneToColorAttribute(color, index, classification) {
  const weight = westernMarineShelfToneWeight(classification);
  if (weight <= 0) return 0;

  const x = Number.isFinite(classification?.normalizedX) ? classification.normalizedX : 1;
  const y = Number.isFinite(classification?.normalizedY) ? classification.normalizedY : 0.5;
  const fabric = shelfFabric(x, y);

  const coolWeight = smoothstep(0.58, 0.88, fabric.macro) * 0.30;
  const mineralWeight = smoothstep(0.60, 0.90, fabric.meso) * (0.16 + fabric.sedimentBands * 0.12);
  const siltWeight = fabric.turbidity * WESTERN_MARINE_SHELF_TONE_POLICY.turbidityVariation * 1.65;
  const scourWeight = fabric.currentScour * WESTERN_MARINE_SHELF_TONE_POLICY.currentScourVariation * 1.55;

  const target = TARGET_COLOR.clone()
    .lerp(COOL_PATCH_COLOR, coolWeight)
    .lerp(MINERAL_PATCH_COLOR, mineralWeight)
    .lerp(SILT_PATCH_COLOR, clamp01(siltWeight))
    .lerp(DEEP_PATCH_COLOR, clamp01(scourWeight));

  // Fine sediment flecks modulate value only a few percent; they should survive full-world mip/read
  // without turning the sea floor into TV-noise at close range.
  const fineValue = 0.965 + (fabric.fine - 0.5) * 0.07 + (fabric.sedimentBands - 0.5) * 0.045;
  target.multiplyScalar(fineValue);

  color.setXYZ(
    index,
    lerp(color.getX(index), target.r, weight),
    lerp(color.getY(index), target.g, weight),
    lerp(color.getZ(index), target.b, weight),
  );
  return weight;
}
