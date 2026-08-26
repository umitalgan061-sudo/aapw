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

const TAU = Math.PI * 2;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;

export const WESTERN_MARINE_SHELF_TONE_POLICY = Object.freeze({
  id: 'western-marine-shelf-tone-2026-08-26-v2-stronger-depth-read',
  renderOnly: true,
  canonicalSeaOnly: true,
  geographyAuthorityUnchanged: true,
  fullStrengthNormalizedX: 0.04,
  fadeEndNormalizedX: 0.34,
  maxBlend: 0.78,
  regionalVariation: 0.08,
  targetColorHex: 0x162f3b,
});

const TARGET_COLOR = new THREE.Color(WESTERN_MARINE_SHELF_TONE_POLICY.targetColorHex);

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
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
  const regional = Math.sin(TAU * (x * 2.73 + y * 1.91) + 0.63) * 0.5 + 0.5;
  const modulation = 1 - WESTERN_MARINE_SHELF_TONE_POLICY.regionalVariation
    + regional * WESTERN_MARINE_SHELF_TONE_POLICY.regionalVariation;
  return clamp01(WESTERN_MARINE_SHELF_TONE_POLICY.maxBlend * westWeight * modulation);
}

/** Applies the marine-only tone directly to an existing terrain colour attribute. */
export function applyWesternMarineShelfToneToColorAttribute(color, index, classification) {
  const weight = westernMarineShelfToneWeight(classification);
  if (weight <= 0) return 0;
  color.setXYZ(
    index,
    lerp(color.getX(index), TARGET_COLOR.r, weight),
    lerp(color.getY(index), TARGET_COLOR.g, weight),
    lerp(color.getZ(index), TARGET_COLOR.b, weight),
  );
  return weight;
}
