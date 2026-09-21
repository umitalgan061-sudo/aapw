/**
 * Continental uplift — the large-scale "inland is higher than the coast" term that gives the world a
 * realistic vertical range without moving a single metre of coastline.
 *
 * **Why this exists.** Probing the live height field showed this world is, geologically speaking, a
 * flat coastal shelf: land has a median height of 5.24 m above sea and 80% of it sits under 17.7 m,
 * with the only real elevation coming from a handful of authored mountain chains (several of which are
 * themselves flattened by road-pass corridors). Every relief layer in `world/terrainReliefDetail.js`
 * scales its amplitude with local elevation — which is correct, and which meant they had almost
 * nothing to scale against. No amount of noise tuning fixes a continent that is 5 m tall.
 *
 * **What it does.** A deterministic distance-to-water field is precomputed once over the canonical
 * 96x64 surface mask, smoothed, and sampled bilinearly: the further a point is from open water, the
 * more it is lifted, up to `maxUpliftMeters` deep inland. Because uplift is exactly zero at the
 * waterline and grows smoothly inland, the land/sea boundary the owner map defines is untouched — the
 * coastline, every island and every inlet keep their canonical shape. What changes is that the
 * interior of a landmass now stands hundreds of metres above its shore, the way a real continent does,
 * and every existing relief layer finally has real elevation to scale against.
 *
 * **Why it is road-safe.** Uplift is a *large-scale* term: it climbs over kilometres, not over metres,
 * so its own contribution to local slope is on the order of a couple of degrees — far cheaper per
 * metre of elevation gained than any short-wavelength layer. That is the whole reason this is the
 * right lever for adding elevation rather than raising noise amplitudes further, which
 * `scripts/roadNetworkSafetyCheck.js` already rejected at 22.7 deg in ADR-0297.
 *
 * **Determinism.** The field is derived once from the immutable canonical mask by a fixed algorithm.
 * No `Math.random()`, no state, no per-call allocation.
 * @module world/terrainContinentalUplift
 */

import { WORLD_REFERENCE_BASE_SURFACE_MASK } from './worldReferenceSurfacePindexes.js';

const MASK_WIDTH = WORLD_REFERENCE_BASE_SURFACE_MASK.width;
const MASK_HEIGHT = WORLD_REFERENCE_BASE_SURFACE_MASK.height;
const SEA_CODE = WORLD_REFERENCE_BASE_SURFACE_MASK.codes.sea;
const LAKE_CODE = WORLD_REFERENCE_BASE_SURFACE_MASK.codes.lake;

export const TERRAIN_CONTINENTAL_UPLIFT_POLICY = Object.freeze({
	id: 'terrain-continental-uplift-2026-08-19-v1',
	sourceMaskSha256: WORLD_REFERENCE_BASE_SURFACE_MASK.maskSha256,
	/**
	 * Peak uplift, reached where a point is `fullUpliftCells` or more from any water cell.
	 *
	 * 780 m is the measured ceiling, found by bisection against
	 * `scripts/roadNetworkSafetyCheck.js`: 780 passes, 850 fails on three edges (21.4 / 23.5 / 20.3
	 * deg). It is not a taste value — it is the most elevation this world can carry while a horse-cart
	 * road can still be routed across it.
	 *
	 * The previous ceiling was 265 m. What moved it was not a bigger number here but
	 * `ROAD_MAX_GRADE_DEGREES` in `world/roadPathfinder.js`: A* was minimising a route's *total* cost
	 * while the safety check asserts its *maximum* grade, so a short route with one over-limit pitch
	 * kept winning. Once a hard per-step cap made those steps near-prohibitive, every edge's max grade
	 * fell sharply on the *same* terrain (`robin -> berkalp` 18.5 -> 10.5 deg at unchanged network
	 * length), and the elevation budget nearly tripled.
	 */
	maxUpliftMeters: 780,
	/**
	 * Distance to water, in mask cells, at which uplift reaches full strength. One cell is ~138 x
	 * ~162 m, so 20 cells is roughly 2.8 km.
	 *
	 * Widened from 9 after measurement: peak height and *gradient* are independent, and it is the
	 * gradient that roads pay for. At 9 cells the same 340 m climb happened over ~1.3 km, which took
	 * three seat-to-seat edges past the 20 deg ceiling — including `cersei -> stannis`, only 0.72 km
	 * long, where there is simply no room to route around anything. Spreading the identical peak over
	 * twice the distance halves the slope it costs while keeping every metre of the elevation gain.
	 */
	fullUpliftCells: 20,
	/** Exponent on the normalised distance. Above 1 it keeps the immediate coast low and pushes the
	 * climb inland, which reads as a plain giving way to highlands rather than a dome. */
	upliftExponent: 1.45,
	/** Box-blur passes over the distance field before sampling. The mask is only 96x64, so without
	 * smoothing a 210 m uplift stepping across one cell edge would be a visible terrace. */
	smoothingPasses: 4,
	/** Vertical cell size relative to horizontal, so distance is measured in comparable metres on both
	 * axes (the canonical mask's cells are ~138 m wide and ~162 m tall). */
	cellAspect: (WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelHeight / MASK_HEIGHT)
		/ (WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelWidth / MASK_WIDTH),
});

/** Decoded ground-class codes for the whole canonical mask. */
const MASK_CODES = (() => {
	const { width, height, bitsPerCell, rowsHex } = WORLD_REFERENCE_BASE_SURFACE_MASK;
	const codes = new Uint8Array(width * height);
	const totalBits = BigInt(width * bitsPerCell);
	const codeMask = (1n << BigInt(bitsPerCell)) - 1n;
	for (let y = 0; y < height; y += 1) {
		const row = BigInt(`0x${rowsHex[y]}`);
		for (let x = 0; x < width; x += 1) {
			const shift = totalBits - BigInt((x + 1) * bitsPerCell);
			codes[y * width + x] = Number((row >> shift) & codeMask);
		}
	}
	return codes;
})();

/**
 * Normalised inland-ness in [0, 1] per mask cell: 0 at and in water, rising with distance from the
 * nearest water cell and saturating at `fullUpliftCells`.
 *
 * Built with a two-pass chamfer distance transform (forward then backward), which is exact enough for
 * a term that is then blurred four times, and then smoothed so the 96x64 grid cannot surface as
 * terracing in the final height.
 */
const INLANDNESS = (() => {
	const { fullUpliftCells, smoothingPasses, cellAspect } = TERRAIN_CONTINENTAL_UPLIFT_POLICY;
	const size = MASK_WIDTH * MASK_HEIGHT;
	const distance = new Float32Array(size);
	const LARGE = 1e6;
	const diagonal = Math.hypot(1, cellAspect);

	for (let index = 0; index < size; index += 1) {
		const code = MASK_CODES[index];
		distance[index] = code === SEA_CODE || code === LAKE_CODE ? 0 : LARGE;
	}
	const at = (x, y) => (x < 0 || y < 0 || x >= MASK_WIDTH || y >= MASK_HEIGHT ? 0 : distance[y * MASK_WIDTH + x]);
	// Outside the map is open ocean, so `at()` returning 0 beyond the edge is correct, not a clamp
	// artefact — it keeps map-edge land from being treated as deep interior.
	for (let y = 0; y < MASK_HEIGHT; y += 1) {
		for (let x = 0; x < MASK_WIDTH; x += 1) {
			const index = y * MASK_WIDTH + x;
			if (distance[index] === 0) continue;
			distance[index] = Math.min(
				distance[index],
				at(x - 1, y) + 1, at(x, y - 1) + cellAspect,
				at(x - 1, y - 1) + diagonal, at(x + 1, y - 1) + diagonal,
			);
		}
	}
	for (let y = MASK_HEIGHT - 1; y >= 0; y -= 1) {
		for (let x = MASK_WIDTH - 1; x >= 0; x -= 1) {
			const index = y * MASK_WIDTH + x;
			if (distance[index] === 0) continue;
			distance[index] = Math.min(
				distance[index],
				at(x + 1, y) + 1, at(x, y + 1) + cellAspect,
				at(x + 1, y + 1) + diagonal, at(x - 1, y + 1) + diagonal,
			);
		}
	}

	let field = new Float32Array(size);
	for (let index = 0; index < size; index += 1) {
		field[index] = Math.min(1, distance[index] / fullUpliftCells);
	}
	// Separable-ish box blur, clamped at the edges. Water stays pinned near 0 because its neighbours
	// are water too, so the coastline keeps a genuine zero-uplift band after smoothing.
	for (let pass = 0; pass < smoothingPasses; pass += 1) {
		const blurred = new Float32Array(size);
		for (let y = 0; y < MASK_HEIGHT; y += 1) {
			for (let x = 0; x < MASK_WIDTH; x += 1) {
				let total = 0;
				let count = 0;
				for (let dy = -1; dy <= 1; dy += 1) {
					for (let dx = -1; dx <= 1; dx += 1) {
						const sx = x + dx;
						const sy = y + dy;
						if (sx < 0 || sy < 0 || sx >= MASK_WIDTH || sy >= MASK_HEIGHT) continue;
						total += field[sy * MASK_WIDTH + sx];
						count += 1;
					}
				}
				blurred[y * MASK_WIDTH + x] = total / count;
			}
		}
		field = blurred;
	}
	return field;
})();

function inlandnessAtCell(x, y) {
	if (x < 0 || y < 0 || x >= MASK_WIDTH || y >= MASK_HEIGHT) return 0;
	return INLANDNESS[y * MASK_WIDTH + x];
}

/**
 * Continental uplift in metres at a normalised owner-map coordinate.
 *
 * Zero at and near the waterline by construction, so the canonical coastline is never displaced.
 *
 * @param {number} normalizedX
 * @param {number} normalizedY
 * @returns {number} Metres to add to canonical land height (always >= 0).
 */
export function continentalUpliftMeters(normalizedX, normalizedY) {
	const fx = normalizedX * MASK_WIDTH - 0.5;
	const fy = normalizedY * MASK_HEIGHT - 0.5;
	const x0 = Math.floor(fx);
	const y0 = Math.floor(fy);
	const tx = fx - x0;
	const ty = fy - y0;
	const top = inlandnessAtCell(x0, y0) * (1 - tx) + inlandnessAtCell(x0 + 1, y0) * tx;
	const bottom = inlandnessAtCell(x0, y0 + 1) * (1 - tx) + inlandnessAtCell(x0 + 1, y0 + 1) * tx;
	const inlandness = top * (1 - ty) + bottom * ty;
	if (inlandness <= 0) return 0;
	const { upliftExponent, maxUpliftMeters } = TERRAIN_CONTINENTAL_UPLIFT_POLICY;
	return Math.pow(inlandness, upliftExponent) * maxUpliftMeters;
}
