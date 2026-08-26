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
  id: 'western-marine-shelf-tone-2026-08-26-v3-multiscale-shelf-fabric',
  renderOnly: true,
  canonicalSeaOnly: true,
  geographyAuthorityUnchanged: true,
  fullStrengthNormalizedX: 0.04,
  fadeEndNormalizedX: 0.34,
  maxBlend: 0.78,
  macroVariation: 0.11,
  mesoVariation: 0.07,
  fineVariation: 0.035,
  targetColorHex: 0x162f3b,
  coolPatchColorHex: 0x193744,
  mineralPatchColorHex: 0x213840,
});

const TARGET_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.targetColorHex);
const COOL_PATCH_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.coolPatchColorHex);
const MINERAL_PATCH_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.mineralPatchColorHex);

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

function shelfFabric(normalizedX, normalizedY) {
  // Three deliberately incommensurate scales avoid the obvious diagonal sine banding the earlier
  // pass produced. Inputs stay in owner-map space, so Pindex boundaries cannot reset the pattern.
  const macro = valueNoise2D(normalizedX * 3.1 + 0.7, normalizedY * 4.3 - 1.4, 1.7);
  const meso = valueNoise2D(normalizedX * 8.7 - 2.1, normalizedY * 11.9 + 0.8, 5.3);
  const fine = valueNoise2D(normalizedX * 21.1 + 4.2, normalizedY * 17.3 - 3.6, 9.1);
  return { macro, meso, fine };
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
    + (fabric.fine - 0.5) * WESTERN_MARINE_SHELF_TONE_POLICY.fineVariation;
  return clamp01(WESTERN_MARINE_SHELF_TONE_POLICY.maxBlend * westWeight * Math.max(0.72, modulation + 0.12));
}

/** Applies the marine-only tone directly to an existing terrain colour attribute. */
export function applyWesternMarineShelfToneToColorAttribute(color, index, classification) {
  const weight = westernMarineShelfToneWeight(classification);
  if (weight <= 0) return 0;

  const x = Number.isFinite(classification?.normalizedX) ? classification.normalizedX : 1;
  const y = Number.isFinite(classification?.normalizedY) ? classification.normalizedY : 0.5;
  const fabric = shelfFabric(x, y);
  const target = TARGET_COLOR.clone()
    .lerp(COOL_PATCH_COLOR, smoothstep(0.58, 0.88, fabric.macro) * 0.34)
    .lerp(MINERAL_PATCH_COLOR, smoothstep(0.62, 0.92, fabric.meso) * 0.22);

  color.setXYZ(
    index,
    lerp(color.getX(index), target.r, weight),
    lerp(color.getY(index), target.g, weight),
    lerp(color.getZ(index), target.b, weight),
  );
  return weight;
}
