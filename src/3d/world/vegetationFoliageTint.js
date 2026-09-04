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

export const FOLIAGE_TINT_POLICY = Object.freeze({
	/**
	 * How far foliage is pulled toward the *hue* of its region's ground, with luminance preserved.
	 *
	 * Only chroma moves, for the same reason `terrainBiomeShading.js` transfers the map's colour that
	 * way: foliage is far darker than any ground colour, so pulling toward the ground's raw value would
	 * brighten a dark pine into tan rather than tint it. Luminance-normalising the ground first turns
	 * "0.73, 0.73, 0.60 khaki" into a direction rather than a brightness, and a dry region then bends
	 * its trees toward olive while a green one leaves them green.
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
 * The instance colour for a tree standing at `x, z` — a multiplier on its species colour.
 *
 * Pure in position and species colour, so two builds of the same world produce the same forest.
 *
 * Returns a module-scratch colour rather than allocating: `InstancedMesh.setColorAt` copies the value
 * out immediately, so one buffer can serve every tree in the scatter loop.
 *
 * @param {number} x
 * @param {number} z
 * @param {THREE.Color} speciesColor The material colour the multiplier will be applied to.
 * @returns {THREE.Color}
 */
const scratch = new THREE.Color();
export function foliageTintAt(x, z, speciesColor) {
	const P = FOLIAGE_TINT_POLICY;
	const target = scratch;
	const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
	const { nx, ny } = normalizedMapPoint(x, z);
	sampleMapGroundColor(target, nx, ny);
	const groundLuminance = Math.max(1e-4, luminance(target.r, target.g, target.b));
	const foliageLuminance = Math.max(1e-4, luminance(speciesColor.r, speciesColor.g, speciesColor.b));
	// Same luminance as the species colour, but the region's hue direction.
	const jitter = 1 + (positionHash01(x, z, 1) - 0.5) * 2 * P.perTreeJitter;
	const channel = (groundChannel, speciesChannel) => {
		const wanted = foliageLuminance * (groundChannel / groundLuminance);
		const ratio = speciesChannel > 1e-4 ? wanted / speciesChannel : 1;
		const regional = 1 + (ratio - 1) * P.regionalStrength;
		return Math.min(P.multiplierRange.max, Math.max(P.multiplierRange.min, regional * jitter));
	};
	target.setRGB(
		channel(target.r, speciesColor.r),
		channel(target.g, speciesColor.g),
		channel(target.b, speciesColor.b),
	);
	return target;
}
