/**
 * Latitude-dependent water optics (run 392).
 *
 * `world/water.js` derives water colour from a Beer-Lambert extinction coefficient and a
 * shallow/deep colour pair. Those were global, so every sea in the world was the same water: the
 * Lands of Always Winter rendered the same Caribbean turquoise as Dorne, against snow, which run
 * 389's real-world capture at (-4800, -4600) showed plainly.
 *
 * Two quantities have to move with latitude, and the second one is the one that matters most:
 *
 * 1. **Extinction.** A polar sea carries far more suspended sediment and plankton, so it absorbs
 *    harder on every channel and loses its blue transmission disproportionately.
 * 2. **The shallow endpoint.** Extinction alone was measured and was not enough — an A/B render
 *    moved the mean pixel by only 4.2/255. The reason is structural: `mix(deep, shallow, T)` means
 *    that as depth goes to zero every sea converges on the shallow colour whatever its coefficient.
 *    A cold sea's shallows are grey-green at one metre, not turquoise. Moving the endpoint too took
 *    the same measurement to 22.2/255, with the hue going flat (blue and green converge) rather than
 *    merely darker — which is what reads as cold water rather than as dim tropical water.
 * @module world/waterLatitude
 */

import * as THREE from 'three';
import { WORLD_SCALE } from '../config.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';

/**
 * Formats a number as a GLSL float literal. A whole number interpolated straight into GLSL emits an
 * int literal (`7000`, not `7000.0`), and float/int is a type error in GLSL ES 1.00, so the shader
 * fails to compile and the water renders nothing at all rather than rendering wrongly. That happened
 * on this very change: the map canvas height is 7000 and the latitude centre 3500. Only the swell
 * gate's GPU read-back caught it (0.00% of pixels changed); every source-level contract passed.
 */
export const glslFloat = (value) => (Number.isFinite(value) ? value.toFixed(6) : '0.0');

/**
 * Where the far north begins, in normalized owner-map latitude. Deliberately the same numbers as
 * `world/terrain.js`'s `NORTHERN_SNOW`: the snow line and the cold-water line must agree about where
 * the north starts, or the shore would carry ice with tropical water lapping at it.
 * `scripts/checkWaterSurfVisualContract.mjs` asserts the two stay equal.
 */
export const POLAR_FULL_NY = 0.15;
export const POLAR_FADE_NY = 0.30;

/** World Z to normalized map latitude — the projection `terrainBiomeShading.js` documents. */
export const MAP_LATITUDE_METERS_PER_UNIT = WORLD_SCALE.METERS_PER_MAP_UNIT;
export const MAP_LATITUDE_CENTER_Y = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
export const MAP_LATITUDE_CANVAS_H = WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;

/**
 * Polar extinction, per metre, per channel. Against the temperate (0.46, 0.115, 0.052): at 3 m
 * transmittance goes from (0.25, 0.71, 0.86) to (0.16, 0.41, 0.49); at 20 m polar water is
 * essentially black where temperate water still carries a third of its blue. Surface opacity follows
 * for free, because alpha is derived from the same transmittance — cold water turns opaque sooner.
 */
export const POLAR_EXTINCTION_PER_METER = new THREE.Vector3(0.62, 0.30, 0.24);

/** The far north's shallow-water endpoint: a desaturated cold teal rather than a tropical turquoise. */
export const POLAR_SHALLOW_COLOR = new THREE.Color(0x5f7f79);
