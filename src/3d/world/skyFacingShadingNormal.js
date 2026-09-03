/**
 * Keeps a thin, ground-hugging, double-sided ribbon lit by the sky from whichever side you see it.
 *
 * **The failure this exists to stop.** Three separate systems in this world draw a nearly flat strip
 * laid on the terrain — the river ribbon, the grass cards, the road network — and all three set
 * `side: THREE.DoubleSide`, because you must be able to see them from either side. three.js shades a
 * back face by flipping its normal to point at the viewer. For a solid that is exactly right. For a
 * strip lying on the ground it is not: catch one at a grazing angle, which is what every ridge crest
 * and every distant reach is, and the flipped normal points at the *ground*. Diffuse irradiance goes
 * to zero and a lit surface renders as an unlit black stroke across the landscape.
 *
 * It has now been measured three times, independently, in the same world:
 *
 *   * **Run 428, the rivers.** Hiding one system at a time raised mean luminance along the offending
 *     line from 32.1 to 117.9 only when the river group went. Raycasts through it returned world
 *     normals of (0.25,-0.95,-0.20), (0.29,-0.96,-0.03) and (0.11,-0.99,-0.01) — all three pointing
 *     at the ground.
 *   * **Run 429, the grass.** The mid-distance sward read at luminance 22 against 64 for the bare
 *     terrain beside it — the same field, three times darker where it happened to be grassy.
 *   * **Run 432, the roads.** A two-pixel black bar below a village: darkest pixel 1.0, and 49 pixels
 *     under luminance 40. Hide the roads and it is 83.3 and zero. Skirts, water, rivers, villages and
 *     shadows all left it exactly where it was.
 *
 * **The correction.** None of these surfaces has a side the sky does not reach. Water is bright when
 * you look up through it; a blade of grass is lit from above whichever face you catch; the underside
 * of a road is not a second, darker road. Forcing the shading normal's vertical component upward
 * leaves every front face untouched — `normal.y` is already positive there, so it is a no-op — and
 * only ever repairs a face the double-sided flip turned over. Every horizontal wobble a flow patch or
 * a normal map put there survives it.
 *
 * Render-only: no vertex moves, no attribute is added, no material property changes. In particular
 * none of the five `scripts/checkRoadVisualContract.js` pins (type, vertexColors, roughness,
 * metalness, side) is touched — the point is precisely that `DoubleSide` can stay.
 *
 * @module world/skyFacingShadingNormal
 */

/**
 * Program-cache tag for the road network's use of this correction (run 432). Both road tiers take it:
 * the footpath ribbon is built by the same code with the same material settings, so it has the same
 * defect, and the run-177 medieval-surface wrapper only ever sees `group.children[0]`.
 */
export const ROAD_SKY_FACING_NORMAL_KEY = 'run432-road-sky-facing-normal-v1';

/**
 * Chains the correction onto a material's shader.
 *
 * Anchored on `#include <normal_fragment_maps>` so `normal` is the finished shading normal: after the
 * double-sided flip, after any normal map, and before the lighting that reads it. Chains rather than
 * replaces `onBeforeCompile`, and extends `customProgramCacheKey` rather than overwriting it, so a
 * material that is already patched keeps both patches and its own distinct compiled program.
 *
 * @param {import('three').Material} material The material, mutated in place.
 * @param {string} cacheKey A tag unique to the calling system, appended to the program cache key.
 * @returns {import('three').Material} the same material.
 */
export function applySkyFacingShadingNormal(material, cacheKey) {
	const previousOnBeforeCompile = material.onBeforeCompile?.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		if (previousOnBeforeCompile) previousOnBeforeCompile(shader, renderer);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <normal_fragment_maps>',
			'#include <normal_fragment_maps>\nnormal.y = abs(normal.y);',
		);
	};
	// A material whose program is patched must say so, or three.js hands a patched and an unpatched
	// material the same cached program and one of them renders as the other.
	const previousCacheKey = material.customProgramCacheKey?.bind(material);
	material.customProgramCacheKey = () => `${previousCacheKey ? previousCacheKey() : ''}|${cacheKey}`;
	material.userData.skyFacingShadingNormal = Object.freeze({
		key: cacheKey,
		extraDrawCalls: 0,
		renderOnly: true,
	});
	material.needsUpdate = true;
	return material;
}
