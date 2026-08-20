/**
 * Ground realism — the cues that make real terrain read as real, applied over the biome colour.
 *
 * **Why this exists.** `world/terrainBiomeShading.js` answers "what *kind* of country is this?" from
 * altitude, slope and the owner map's biome zones: grass, dry upland, forest, sand, rock, snow. That is
 * the right question and it is answered well, but it is not enough to make ground look like ground. A
 * §8.5 capture in run 366 showed why: with the grass fixed, the soil underneath it was still a single
 * flat mustard wash across a whole hillside. Every band was correct and the result still read as a
 * coloured surface rather than as earth.
 *
 * What real ground has that a biome band does not is **water and sun history**. Photograph any hillside
 * and the strongest signals in the image are not "this is grassland" — they are:
 *
 *   1. **Drainage.** Water runs downhill and collects in hollows. Concave ground is wetter, so it grows
 *      more and darker; convex shoulders and ridge lines shed water, so soil is thin and pale there. On
 *      a real hillside this paints the entire drainage network — every gully, bench and spur — without
 *      anyone drawing one. It is computed here from local curvature, which is the mean of the four
 *      neighbouring heights minus this one: positive is a hollow, negative is a ridge. The caller
 *      already has those four neighbours (it computes slope from them), so this costs nothing.
 *   2. **Aspect.** Which way a slope faces decides how much sun it takes. Sun-facing ground dries out
 *      and pales; shaded ground stays damp and dark. This is why a real mountain is visibly two-toned
 *      along its ridge line, and it is the cue that makes relief legible at a distance.
 *   3. **Scale hierarchy.** Real ground varies at several scales at once — metres, tens of metres,
 *      hundreds. The existing per-vertex mottle is a single cell size, so it adds grain but no
 *      structure. Three octaves of smooth noise add the structure.
 *
 * **This is render-only and additive.** Nothing here is consulted by the height sampler, the collider,
 * road grading or any gameplay query — it multiplies and lerps an albedo that has already been decided.
 * Terrain geometry, physics and determinism are untouched, which is what GOVERNANCE.md §8.4 requires of
 * a change in this area.
 *
 * **Determinism.** Curvature and aspect are pure functions of heights the caller already sampled; the
 * mottle is `signedFbmNoise` of world metres. No `Math.random()`, no state, no frame dependence — the
 * same coordinate resolves to the same colour every time, so two chunks in the *same* LOD band agree
 * exactly along their shared edge.
 *
 * Across *different* LOD bands the agreement is close but not exact, and it is worth being precise
 * about why. Curvature depends on the stencil it is measured over, and a coarse chunk's stencil is
 * genuinely wider, so `curvatureMetersFromNeighbours` normalises by stencil width to remove the
 * systematic part of that difference — measured, it takes the p95 near-vs-far disagreement from 2.479 m
 * to 0.637 m. What is left is the detail a 15.63 m stencil physically cannot see, which is inherent to
 * having LOD at all rather than a defect here. `scripts/checkTerrainGroundRealism.js` holds that
 * residual below `drainageFullMeters`, i.e. below one full-strength colour step.
 *
 * @module world/terrainGroundRealism
 */

import * as THREE from 'three';
import { signedFbmNoise } from './terrainReliefDetail.js';

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

function smoothstep(edge0, edge1, value) {
	if (edge0 === edge1) return value >= edge1 ? 1 : 0;
	const t = clamp01((value - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
}

export const TERRAIN_GROUND_REALISM_POLICY = Object.freeze({
	id: 'terrain-ground-realism-2026-08-20-v1',
	renderOnly: true,
	heightAuthorityUnchanged: true,

	/**
	 * Curvature, in metres, that counts as a fully developed hollow or ridge.
	 *
	 * Curvature here is `mean(neighbour heights) - own height` at the chunk's own vertex spacing (3.91 m
	 * on the near LOD band). **Measured, not guessed** — 5219 dry samples over a 1200 m radius of the live
	 * field give p01 -1.167, p05 -0.638, p25 -0.193, p50 0.009, p75 0.231, p95 0.625, p99 1.013 m. The
	 * first version of this module guessed 3.5 m on the reasoning that "real gullies reach 3-5 m", which
	 * is true of a landscape but not of this field at this spacing: at 3.5 m even a 99th-percentile
	 * hollow got `smoothstep(0, 3.5, 1.01)` = 0.21 of the effect and median ground got 0.01, so the whole
	 * pass moved the render by a mean of 2 RGB levels and was invisible. Calibrated to 1.0 m, the p99
	 * hollow saturates, p95 reads clearly and p50 stays nearly untouched — which is the intended shape.
	 */
	drainageFullMeters: 1,
	/**
	 * The stencil, in metres, curvature is always measured on — **regardless of the chunk's LOD**.
	 *
	 * Curvature grows with the stencil it is measured over: a 15.6 m arm spans more relief than a 3.91 m
	 * one, so reusing each chunk's own vertex spacing would give the same patch of ground a different
	 * curvature, and therefore a different colour, in each LOD band. That would draw a visible colour
	 * seam along every band boundary — and band boundaries move as the player walks, so it would shimmer.
	 * The reference stencil every measurement is normalised back to is the near band's own spacing,
	 * which is what `drainageFullMeters` is calibrated against.
	 *
	 * Re-sampling the height field on a fixed stencil would have been the obvious fix and was tried: it
	 * cost four extra height samples per vertex and, with 529 chunks built synchronously at boot, hung
	 * the page past a 60 s load timeout. So the normalisation is analytic instead, and it is exact
	 * because curvature on this terrain scales **linearly** with stencil size — measured, not assumed:
	 * p90 |curvature| is 0.6301 m at 3.91 m, 1.3362 m at 7.81 m and 2.5818 m at 15.63 m, i.e. ratios
	 * 2.121x and 4.098x against stencil ratios of 2x and 4x, for fitted exponents of 1.085 and 1.017.
	 * Multiplying by `reference / stencil` therefore lands every LOD band on the same value to within a
	 * couple of percent, at zero sampling cost.
	 */
	curvatureStencilMeters: 500 / 128,
	/** How far a full hollow moves toward the wet tone. */
	wetHollowStrength: 0.42,
	/** How far a full ridge moves toward the dry tone. Deliberately weaker than the hollow: a wet gully
	 * is a much stronger visual signal in real terrain than a dry crest. */
	dryRidgeStrength: 0.3,

	/** How far the sunniest slope moves toward dry relative to the shadiest. */
	aspectStrength: 0.2,
	/** Aspect means nothing on flat ground — a level field faces the sky, not a compass point — so it
	 * fades in with slope. */
	aspectSlopeStartDegrees: 5,
	aspectSlopeFullDegrees: 24,

	/** Mottle octaves as (wavelength in metres, amplitude). Three scales, so a hillside carries metre-
	 * scale grain, tens-of-metres patchiness and a slow hundred-metre drift at the same time. */
	mottleWavelengthsMeters: Object.freeze([5, 27, 140]),
	mottleAmplitudes: Object.freeze([0.06, 0.05, 0.035]),

	/** Below this depth the ground is seabed and none of this applies — bathymetry has no drainage,
	 * aspect or soil. */
	submergedFadeMeters: 4,
});

/** Damp, dark, richly vegetated hollow floor. */
const WET_HOLLOW = new THREE.Color(0x334a25);
/** Thin, pale, sun-bleached soil on a shedding ridge. */
const DRY_RIDGE = new THREE.Color(0xb0a67c);

/**
 * Local curvature from the four neighbouring heights the caller already sampled, **normalised to the
 * reference stencil** so every LOD band agrees.
 *
 * Positive is concave (a hollow — neighbours sit higher), negative is convex (a ridge or shoulder).
 * The raw value is the discrete Laplacian, whose magnitude grows with the stencil it is measured over;
 * passing `stencilMeters` scales it back to `curvatureStencilMeters`, which is what
 * `drainageFullMeters` is calibrated in. Callers must pass their real vertex spacing — omitting it
 * silently assumes the near band and would tint coarse chunks four times too strongly.
 *
 * @param {number} heightWest
 * @param {number} heightEast
 * @param {number} heightNorth
 * @param {number} heightSouth
 * @param {number} ownHeight
 * @param {number} [stencilMeters] Spacing the four neighbours were taken at.
 * @returns {number} Metres at the reference stencil. Positive = hollow, negative = ridge.
 */
export function curvatureMetersFromNeighbours(heightWest, heightEast, heightNorth, heightSouth, ownHeight, stencilMeters = TERRAIN_GROUND_REALISM_POLICY.curvatureStencilMeters) {
	const raw = (heightWest + heightEast + heightNorth + heightSouth) * 0.25 - ownHeight;
	return raw * (TERRAIN_GROUND_REALISM_POLICY.curvatureStencilMeters / stencilMeters);
}

/**
 * How sun-exposed a slope is, in [0, 1], from four heights around a point.
 *
 * 1 is fully sun-facing, 0 fully shaded, 0.5 flat or facing across the sun. In this world +Z is south
 * (the owner map's y runs north to south, and `worldReferenceAlignment.js` maps it straight through),
 * so a slope whose downhill direction points toward +Z takes the most sun.
 *
 * Unlike curvature this is a *direction*, normalised by its own magnitude, so it is already scale-free
 * and the caller's own neighbours are fine.
 *
 * @returns {number} 0..1.
 */
export function sunExposure01FromNeighbours(heightWest, heightEast, heightNorth, heightSouth) {
	// Uphill gradient; downhill is its negation.
	const gradientX = heightEast - heightWest;
	const gradientZ = heightSouth - heightNorth;
	const magnitude = Math.hypot(gradientX, gradientZ);
	if (magnitude < 1e-6) return 0.5;
	// Downhill Z component, normalised: +1 means the slope falls away to the south.
	return clamp01(0.5 + 0.5 * (-gradientZ / magnitude));
}

/**
 * Applies drainage, aspect and multi-scale mottling to an already-resolved biome albedo.
 *
 * @param {THREE.Color} target Mutated in place and returned.
 * @param {object} sample
 * @param {number} sample.curvatureMeters From `curvatureMetersFromNeighbours`.
 * @param {number} sample.sunExposure01 From `sunExposure01FromNeighbours`.
 * @param {number} sample.slopeDegrees Local ground slope.
 * @param {number} sample.heightAboveSeaMeters Signed; negative is submerged.
 * @param {number} sample.worldX
 * @param {number} sample.worldZ
 * @param {number} [sample.soilCoverage01] How much of this spot is soil rather than bare rock, snow or
 *   sand — those surfaces have no drainage colour, so the effect is scaled by this. 1 by default.
 * @returns {THREE.Color} `target`.
 */
export function applyGroundRealism(target, {
	curvatureMeters,
	sunExposure01,
	slopeDegrees,
	heightAboveSeaMeters,
	worldX,
	worldZ,
	soilCoverage01 = 1,
}) {
	const P = TERRAIN_GROUND_REALISM_POLICY;
	// Underwater ground is bathymetry: no soil, no sun, no drainage.
	const dryLand = smoothstep(-P.submergedFadeMeters, 0, heightAboveSeaMeters);
	const soil = clamp01(soilCoverage01) * dryLand;
	if (soil <= 0) return target;

	// 1. Drainage. Hollows collect water and grow; ridges shed it and go thin and pale.
	const hollow = smoothstep(0, P.drainageFullMeters, curvatureMeters);
	const ridge = smoothstep(0, P.drainageFullMeters, -curvatureMeters);
	if (hollow > 0) target.lerp(WET_HOLLOW, hollow * P.wetHollowStrength * soil);
	if (ridge > 0) target.lerp(DRY_RIDGE, ridge * P.dryRidgeStrength * soil);

	// 2. Aspect. Only meaningful once the ground actually tilts.
	const tilt = smoothstep(P.aspectSlopeStartDegrees, P.aspectSlopeFullDegrees, slopeDegrees);
	if (tilt > 0) {
		const sunDryness = (clamp01(sunExposure01) - 0.5) * 2; // -1 shaded .. +1 sun-facing
		const amount = tilt * P.aspectStrength * soil;
		if (sunDryness > 0) target.lerp(DRY_RIDGE, sunDryness * amount);
		else if (sunDryness < 0) target.lerp(WET_HOLLOW, -sunDryness * amount);
	}

	// 3. Scale hierarchy. Three octaves of smooth noise, multiplied so it modulates whatever colour the
	// bands above produced rather than tinting it.
	let mottle = 1;
	for (let i = 0; i < P.mottleWavelengthsMeters.length; i += 1) {
		const frequency = 1 / P.mottleWavelengthsMeters[i];
		mottle += signedFbmNoise(worldX * frequency + i * 19.7, worldZ * frequency - i * 11.3, 2)
			* P.mottleAmplitudes[i] * soil;
	}
	target.setRGB(
		clamp01(target.r * mottle),
		clamp01(target.g * mottle),
		clamp01(target.b * mottle),
	);
	return target;
}
