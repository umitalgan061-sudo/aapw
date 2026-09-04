/**
 * Gives every tree its own foliage colour instead of two greens for the whole world.
 *
 * **The defect.** `world/vegetation.js` builds one `MeshStandardMaterial` per species with a single
 * flat colour — `0x2f5c26` for the pine, `0x4a7a2e` for the round-crown — and neither `vertexColors`
 * nor any per-instance colour. So across thousands of instances there are exactly **two** foliage
 * colours in the world, identical in the northern uplands and in the Reach, and a distant wood reads
 * as a stamped repeat of one tree rather than as a stand of many. It is the same flatness run 449
 * measured and fixed for grass, in the layer that covers far more of the screen.
 *
 * **The trap this module exists to document.** `InstancedMesh` carries `instanceColor`, and three.js
 * looks like it will apply it for free. It will not. In the vendored r160, `color_vertex` folds
 * `instanceColor` into `vColor` under `USE_INSTANCING_COLOR`, but `color_fragment` reads:
 *
 *     #if defined( USE_COLOR_ALPHA )   diffuseColor *= vColor;
 *     #elif defined( USE_COLOR )       diffuseColor.rgb *= vColor;
 *
 * — `USE_INSTANCING_COLOR` is absent. On a material with `vertexColors: false` the varying is computed
 * and then never read, so `setColorAt` is a silent no-op that costs a buffer and changes nothing.
 * (Grass escapes this only because `world/windGrass.js` already sets `vertexColors: true` and carries
 * its own colour attribute.) `prepareFoliageForTinting` closes it by giving the geometry a constant
 * white colour attribute and turning `vertexColors` on, so `USE_COLOR` is defined and `vColor` —
 * white times the instance colour — actually reaches `diffuseColor`.
 *
 * The material's own colour is left exactly as it was, because the instance colour is a multiplier
 * centred on 1 and `scripts/checkVegetationVisualContract.js` pins those base colours.
 */

import * as THREE from 'three';
import { normalizedMapPoint } from './worldPropScatter.js';
import { sampleMapGroundColor } from './worldReferenceGroundColorField.js';
import { TERRAIN_BIOME_SHADING_POLICY } from './terrainBiomeShading.js';

export const FOLIAGE_TINT_POLICY = Object.freeze({
	/**
	 * How far foliage is bent toward what makes its region's ground *different from the average*.
	 *
	 * Only chroma moves, for the same reason `terrainBiomeShading.js` transfers the map's colour that
	 * way: foliage is far darker than any ground colour, so pulling toward the ground's raw value would
	 * brighten a dark pine into tan rather than tint it.
	 *
	 * **Measured against the map mean, not against the ground directly.** The first cut of this pulled
	 * toward the luminance-normalised ground colour, and measurement showed it was mostly doing the
	 * wrong thing: across the fourteen seats it differentiated regions by only 0.0067 of green-excess
	 * while desaturating *every* tree in the world by 0.0102 — the unintended global shift was larger
	 * than the regional character it bought. Foliage is far more saturated than any ground, so pulling
	 * toward "ground hue" at all is mostly a pull toward grey.
	 *
	 * Expressing the ground as a ratio to `mapGroundColorLandMean` fixes it, and is exactly the trick
	 * `terrainBiomeShading.js` documents for the same problem: an average region now yields a
	 * multiplier of 1 and its trees are left alone, while only a genuinely distinctive region — Dorne's
	 * khaki, the north's grey — bends its trees at all. That also keeps the shift off the far side of
	 * the 220 m near-detail ring, where `vegetationNearDetail.js` hides the primitive and draws a GLB
	 * model this tint cannot reach.
	 */
	regionalStrength: 0.18,
	/** Per-tree luminance jitter, plus or minus. A stand of one exact green is the thing being fixed. */
	perTreeJitter: 0.12,
	/** Clamp on the final multiplier, so no region or draw can bleach or black out a tree. */
	multiplierRange: Object.freeze({ min: 0.75, max: 1.3 }),
});

/**
 * A deterministic value in `[0, 1)` from a world position — the per-tree variation must not come from
 * the scatter's RNG stream, because consuming a draw there would shift every tree placed afterwards
 * and move the whole forest (GOVERNANCE §8.9 determinism, and the placement the vegetation contract
 * pins).
 * @param {number} x
 * @param {number} z
 * @param {number} salt
 * @returns {number}
 */
function positionHash01(x, z, salt) {
	const value = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
	return value - Math.floor(value);
}

/**
 * Turns a species' foliage geometry and material into something `setColorAt` actually shows. Call once
 * per species, before any instance colour is written. See the module doc for why this is required.
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.Material} material
 */
export function prepareFoliageForTinting(geometry, material) {
	if (!geometry.getAttribute('color')) {
		const white = new Float32Array(geometry.getAttribute('position').count * 3).fill(1);
		geometry.setAttribute('color', new THREE.BufferAttribute(white, 3));
	}
	material.vertexColors = true;
	material.needsUpdate = true;
}

/**
 * The instance colour for a tree standing at `x, z` — a multiplier applied to whatever species colour
 * the material carries. It is deliberately independent of that colour: the regional term is a *hue
 * deviation from the map's average land*, so it bends a pine and a round-crown by the same factor and
 * neither species drifts away from the base colour the vegetation contract pins.
 *
 * Pure in position, so two builds of the same world produce the same forest.
 *
 * Returns a module-scratch colour rather than allocating: `InstancedMesh.setColorAt` copies the value
 * out immediately, so one buffer can serve every tree in the scatter loop.
 *
 * @param {number} x
 * @param {number} z
 * @returns {THREE.Color}
 */
const scratch = new THREE.Color();
export function foliageTintAt(x, z) {
	const P = FOLIAGE_TINT_POLICY;
	const target = scratch;
	const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
	const { nx, ny } = normalizedMapPoint(x, z);
	sampleMapGroundColor(target, nx, ny);
	const groundLuminance = Math.max(1e-4, luminance(target.r, target.g, target.b));
	const mean = TERRAIN_BIOME_SHADING_POLICY.mapGroundColorLandMean;
	const meanLuminance = Math.max(1e-4, luminance(mean.r, mean.g, mean.b));
	const jitter = 1 + (positionHash01(x, z, 1) - 0.5) * 2 * P.perTreeJitter;
	const channel = (groundChannel, meanChannel) => {
		// Both sides normalised by their own luminance, so this is "how does this region's hue differ
		// from the map's average land hue" — 1 for an average region, and only deviation survives.
		const deviation = (groundChannel / groundLuminance) / (meanChannel / meanLuminance);
		const regional = 1 + (deviation - 1) * P.regionalStrength;
		return Math.min(P.multiplierRange.max, Math.max(P.multiplierRange.min, regional * jitter));
	};
	target.setRGB(
		channel(target.r, mean.r),
		channel(target.g, mean.g),
		channel(target.b, mean.b),
	);
	return target;
}
