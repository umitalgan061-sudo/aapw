/**
 * Canonical map-aligned mountain relief for the live Three.js height field.
 *
 * The owner reference map already defines connected mountain polylines and a source-derived
 * 96x64 land/water mask. This module turns those two contracts into real-meter relief without
 * allocating objects in the per-vertex hot path. Terrain geometry, collision, roads, rivers,
 * vegetation and settlements all consume the result through terrain.js's one shared sampler.
 * @module world/worldReferenceMountainRelief
 */

import { WORLD_SCALE } from '../config.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';
import {
	REFERENCE_RELIEF_CHAINS,
	WORLD_REFERENCE_MAP,
} from './worldReferenceMap.js';
import { WORLD_REFERENCE_BASE_SURFACE_MASK } from './worldReferenceSurfacePindexes.js';

export const WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY = Object.freeze({
	id: 'owner-map-live-mountain-relief-2026-08-17-v3',
	sourceMapSha256: WORLD_REFERENCE_MAP.sha256,
	surfaceMaskSha256: WORLD_REFERENCE_BASE_SURFACE_MASK.maskSha256,
	landGateZero: 0.54,
	landGateFull: 0.84,
	coordinateWarpNormalized: 0.003,
	summitModulationMinimum: 0.08,
	summitNoiseExponent: 2,
	shoulderWidthVariation: Object.freeze({
		broadFrequency: 5.5,
		detailFrequency: 13.5,
		minimumScale: 0.88,
		maximumScale: 1.62,
	}),
	coastalReliefTaper: Object.freeze({
		radiusNormalized: 0.012,
		minimumScale: 0.12,
	}),
	talusBreakup: Object.freeze({
		broadFrequency: 22,
		detailFrequency: 47,
		strength: 0.18,
		shoulderStart: 0.20,
		shoulderEnd: 0.90,
	}),
	// Western chains overlap shipped kingdom roads, so their audited map-space approaches are
	// lowered into traversable passes instead of flattening/removing the surrounding mountains.
	// Bone/eastern chains need no authored pass yet because no current live road crosses them.
	chains: Object.freeze({
		'vale-chain': Object.freeze({
			// The Vale holds the Eyrie and the Mountains of the Moon — the most vertical country in
			// Westeros — and measured 323 m against a Bone Mountains massif at 774 m. Westeros had no peak
			// in the world's highest fourteen; every one of them was the same Essos blob.
			peakMeters: 560,
			coreWidthNormalized: 0.007,
			outerWidthNormalized: 0.052,
			// **0.65 was why the Vale looked like a moor.** A floor that high pins the crest between 65%
			// and 100% of its peak everywhere along the chain — a uniform embankment by construction, no
			// matter what the summit noise does above it. Sharp peaks need room to fall between them.
			summitFloor: 0.22,
			seed: 11,
			passes: Object.freeze([
				Object.freeze({ id: 'vale-northwest-approach', center: [0.206, 0.399], innerRadiusNormalized: 0.011, outerRadiusNormalized: 0.034, minimumMultiplier: 0.02, corridorVia: [0.1755, 0.3738], corridorEnd: [0.169444, 0.250], corridorInnerRadiusNormalized: 0.012, corridorOuterRadiusNormalized: 0.030 }),
				Object.freeze({ id: 'vale-south-approach', center: [0.233, 0.467], innerRadiusNormalized: 0.013, outerRadiusNormalized: 0.037, minimumMultiplier: 0.02 }),
			]),
		}),
		'red-mountains': Object.freeze({
			// The Red Mountains wall Dorne off from the Reach; they were the second-weakest chain.
			//
			// 470 m with a 0.20 summit floor put the `doran -> ziya` road at **40.7 degrees** against a
			// 20-degree ceiling: a sharper cross-section makes steeper flanks by construction, and this is
			// the one range a live road crosses. 430 m with a slightly higher floor keeps the range a
			// range and keeps Dorne reachable — measured, not guessed, and the pass radii below were
			// widened in the same pass so the corridor eases into the ridge instead of hitting a wall.
			peakMeters: 430,
			coreWidthNormalized: 0.008,
			outerWidthNormalized: 0.050,
			// Same reason as the Vale's floor above, held a little higher because of the road.
			summitFloor: 0.34,
			seed: 23,
			passes: Object.freeze([
				Object.freeze({ id: 'red-west-approach', center: [0.145, 0.610], innerRadiusNormalized: 0.018, outerRadiusNormalized: 0.064, minimumMultiplier: 0.08 }),
				Object.freeze({ id: 'red-central-approach', center: [0.179, 0.651], innerRadiusNormalized: 0.021, outerRadiusNormalized: 0.078, minimumMultiplier: 0.08, corridorEnd: [0.139, 0.587], corridorInnerRadiusNormalized: 0.009, corridorOuterRadiusNormalized: 0.024 }),
				Object.freeze({ id: 'red-east-approach', center: [0.225, 0.640], innerRadiusNormalized: 0.018, outerRadiusNormalized: 0.070, minimumMultiplier: 0.08 }),
			]),
		}),
		// **`summitFloor` here is the difference between a range and a wall.** Both of these chains left it
		// unset, so they took the global 0.08 floor — but with no authored passes and a 1100 m peak, the
		// Bones still measured 51.7% of their area above 300 m: a continuous rampart rather than summits
		// with country between them. An explicit low floor lets the saddles drop properly, and the peak
		// comes down because the point was never that Essos should tower over Westeros by 350 m — it was
		// that the Bones are the tallest range in the known world, which 950 m still says.
		'bone-mountains': Object.freeze({ peakMeters: 950, coreWidthNormalized: 0.008, outerWidthNormalized: 0.042, summitFloor: 0.05, seed: 37 }),
		'eastern-chain': Object.freeze({ peakMeters: 950, coreWidthNormalized: 0.007, outerWidthNormalized: 0.040, summitFloor: 0.05, seed: 53 }),

		// Profiles for the twenty ridges read off map.png — see `REFERENCE_RELIEF_CHAINS`. Narrow
		// (`outerWidthNormalized` 0.026, about 350 m of shoulder) because these are individual drawn
		// ridges rather than continental spines, and peaked between 300 m and 520 m by how large the mark
		// is on the map. Narrow and separate is the whole point: twenty of these read as mountain country,
		// where one wide chain of the same total mass reads as a hill.
		'map-ridge-02': Object.freeze({ peakMeters: 384, coreWidthNormalized: 0.006, outerWidthNormalized: 0.026, summitFloor: 0.06, seed: 114 }),
		'map-ridge-03': Object.freeze({ peakMeters: 363, coreWidthNormalized: 0.006, outerWidthNormalized: 0.026, summitFloor: 0.06, seed: 127 }),
		'map-ridge-04': Object.freeze({ peakMeters: 358, coreWidthNormalized: 0.006, outerWidthNormalized: 0.026, summitFloor: 0.06, seed: 140 }),
		'map-ridge-05': Object.freeze({ peakMeters: 347, coreWidthNormalized: 0.006, outerWidthNormalized: 0.026, summitFloor: 0.06, seed: 153 }),
		'map-ridge-07': Object.freeze({ peakMeters: 345, coreWidthNormalized: 0.006, outerWidthNormalized: 0.026, summitFloor: 0.06, seed: 179 }),
		'map-ridge-08': Object.freeze({ peakMeters: 344, coreWidthNormalized: 0.006, outerWidthNormalized: 0.026, summitFloor: 0.06, seed: 192 }),
		'map-ridge-09': Object.freeze({ peakMeters: 341, coreWidthNormalized: 0.006, outerWidthNormalized: 0.026, summitFloor: 0.06, seed: 205 }),
		'map-ridge-10': Object.freeze({ peakMeters: 335, coreWidthNormalized: 0.006, outerWidthNormalized: 0.026, summitFloor: 0.06, seed: 218 }),
		'map-ridge-11': Object.freeze({ peakMeters: 331, coreWidthNormalized: 0.006, outerWidthNormalized: 0.026, summitFloor: 0.06, seed: 231 }),
		'map-ridge-12': Object.freeze({ peakMeters: 331, coreWidthNormalized: 0.006, outerWidthNormalized: 0.026, summitFloor: 0.06, seed: 244 }),
		'map-ridge-14': Object.freeze({ peakMeters: 328, coreWidthNormalized: 0.006, outerWidthNormalized: 0.026, summitFloor: 0.06, seed: 270 }),
		'map-ridge-16': Object.freeze({ peakMeters: 319, coreWidthNormalized: 0.006, outerWidthNormalized: 0.026, summitFloor: 0.06, seed: 296 }),
		'map-ridge-17': Object.freeze({ peakMeters: 317, coreWidthNormalized: 0.006, outerWidthNormalized: 0.026, summitFloor: 0.06, seed: 309 }),
		'map-ridge-19': Object.freeze({ peakMeters: 317, coreWidthNormalized: 0.006, outerWidthNormalized: 0.026, summitFloor: 0.06, seed: 335 }),
		'map-ridge-20': Object.freeze({ peakMeters: 315, coreWidthNormalized: 0.006, outerWidthNormalized: 0.026, summitFloor: 0.06, seed: 348 }),
	}),
});

const MAP_ASPECT = WORLD_REFERENCE_MAP.pixelWidth / WORLD_REFERENCE_MAP.pixelHeight;
const SEA_CODE = WORLD_REFERENCE_BASE_SURFACE_MASK.codes.sea;
const LAKE_CODE = WORLD_REFERENCE_BASE_SURFACE_MASK.codes.lake;

function smoothstep(edge0, edge1, value) {
	if (value <= edge0) return 0;
	if (value >= edge1) return 1;
	const t = (value - edge0) / (edge1 - edge0);
	return t * t * (3 - 2 * t);
}

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function hash2D(x, y, seed) {
	let value = Math.imul(x ^ seed, 0x27d4eb2d) ^ Math.imul(y + seed, 0x165667b1);
	value ^= value >>> 15;
	value = Math.imul(value, 0x85ebca6b);
	value ^= value >>> 13;
	return (value >>> 0) / 0x100000000;
}

function valueNoise2D(x, y, seed) {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const tx = smoothstep(0, 1, x - x0);
	const ty = smoothstep(0, 1, y - y0);
	const a = hash2D(x0, y0, seed);
	const b = hash2D(x0 + 1, y0, seed);
	const c = hash2D(x0, y0 + 1, seed);
	const d = hash2D(x0 + 1, y0 + 1, seed);
	const top = a + (b - a) * tx;
	const bottom = c + (d - c) * tx;
	return top + (bottom - top) * ty;
}

function decodeSurfaceMask() {
	const { width, height, bitsPerCell, rowsHex } = WORLD_REFERENCE_BASE_SURFACE_MASK;
	const decoded = new Uint8Array(width * height);
	const totalBits = BigInt(width * bitsPerCell);
	const codeMask = (1n << BigInt(bitsPerCell)) - 1n;
	for (let y = 0; y < height; y += 1) {
		const row = BigInt(`0x${rowsHex[y]}`);
		for (let x = 0; x < width; x += 1) {
			const shift = totalBits - BigInt((x + 1) * bitsPerCell);
			decoded[y * width + x] = Number((row >> shift) & codeMask);
		}
	}
	return decoded;
}

const DECODED_SURFACE_MASK = decodeSurfaceMask();

function dryLandAtCell(x, y) {
	const { width, height } = WORLD_REFERENCE_BASE_SURFACE_MASK;
	const clampedX = Math.min(width - 1, Math.max(0, x));
	const clampedY = Math.min(height - 1, Math.max(0, y));
	const code = DECODED_SURFACE_MASK[clampedY * width + clampedX];
	return code === SEA_CODE || code === LAKE_CODE ? 0 : 1;
}

/**
 * Bilinear dry-land ownership from the immutable source-derived surface mask.
 * Returning a number rather than a semantic object keeps terrain vertex generation allocation-free.
 */
export function sampleReferenceDryLandWeight(normalizedX, normalizedY) {
	if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
	if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) throw new RangeError('normalized coordinates must be in [0,1]');
	const { width, height } = WORLD_REFERENCE_BASE_SURFACE_MASK;
	const fx = normalizedX * width - 0.5;
	const fy = normalizedY * height - 0.5;
	const x0 = Math.floor(fx);
	const y0 = Math.floor(fy);
	const tx = smoothstep(0, 1, fx - x0);
	const ty = smoothstep(0, 1, fy - y0);
	const top = dryLandAtCell(x0, y0) * (1 - tx) + dryLandAtCell(x0 + 1, y0) * tx;
	const bottom = dryLandAtCell(x0, y0 + 1) * (1 - tx) + dryLandAtCell(x0 + 1, y0 + 1) * tx;
	return top * (1 - ty) + bottom * ty;
}

function sampleCoastalReliefScale(normalizedX, normalizedY, centerDryWeight) {
	const policy = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.coastalReliefTaper;
	const radiusY = policy.radiusNormalized;
	const radiusX = radiusY / MAP_ASPECT;
	const clearance = Math.min(
		centerDryWeight,
		sampleReferenceDryLandWeight(clamp(normalizedX - radiusX, 0, 1), normalizedY),
		sampleReferenceDryLandWeight(clamp(normalizedX + radiusX, 0, 1), normalizedY),
		sampleReferenceDryLandWeight(normalizedX, clamp(normalizedY - radiusY, 0, 1)),
		sampleReferenceDryLandWeight(normalizedX, clamp(normalizedY + radiusY, 0, 1)),
	);
	return policy.minimumScale + (1 - policy.minimumScale) * smoothstep(0.18, WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull, clearance);
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
	const dx = bx - ax;
	const dy = by - ay;
	const lengthSquared = dx * dx + dy * dy;
	if (lengthSquared <= 1e-12) return Math.hypot(px - ax, py - ay);
	const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
	return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function samplePassMultiplier(normalizedX, normalizedY, passes = []) {
	let multiplier = 1;
	for (const pass of passes) {
		const distance = Math.hypot(
			(normalizedX - pass.center[0]) * MAP_ASPECT,
			normalizedY - pass.center[1],
		);
		const centerInfluence = distance >= pass.outerRadiusNormalized
			? 0
			: 1 - smoothstep(pass.innerRadiusNormalized, pass.outerRadiusNormalized, distance);
		let corridorInfluence = 0;
		if (pass.corridorEnd) {
			const corridorVia = pass.corridorVia ?? pass.center;
			const corridorDistance = Math.min(
				pointSegmentDistance(
					normalizedX * MAP_ASPECT,
					normalizedY,
					pass.center[0] * MAP_ASPECT,
					pass.center[1],
					corridorVia[0] * MAP_ASPECT,
					corridorVia[1],
				),
				pointSegmentDistance(
					normalizedX * MAP_ASPECT,
					normalizedY,
					corridorVia[0] * MAP_ASPECT,
					corridorVia[1],
					pass.corridorEnd[0] * MAP_ASPECT,
					pass.corridorEnd[1],
				),
			);
			corridorInfluence = corridorDistance >= pass.corridorOuterRadiusNormalized
				? 0
				: 1 - smoothstep(pass.corridorInnerRadiusNormalized, pass.corridorOuterRadiusNormalized, corridorDistance);
		}
		const influence = Math.max(centerInfluence, corridorInfluence);
		if (influence <= 0) continue;
		multiplier = Math.min(
			multiplier,
			1 - influence * (1 - pass.minimumMultiplier),
		);
	}
	return multiplier;
}

function sampleShoulderWidthScale(normalizedX, normalizedY, seed) {
	const policy = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.shoulderWidthVariation;
	const broad = valueNoise2D(
		normalizedX * policy.broadFrequency,
		normalizedY * policy.broadFrequency,
		seed + 307,
	);
	const detail = valueNoise2D(
		normalizedX * policy.detailFrequency + 17,
		normalizedY * policy.detailFrequency - 29,
		seed + 409,
	);
	const blend = broad * 0.72 + detail * 0.28;
	return policy.minimumScale + (policy.maximumScale - policy.minimumScale) * blend;
}

function sampleTalusBreakup(normalizedX, normalizedY, normalizedDistance, seed) {
	const policy = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.talusBreakup;
	const shoulderWeight = smoothstep(policy.shoulderStart, policy.shoulderEnd, normalizedDistance)
		* (1 - smoothstep(policy.shoulderEnd, 1, normalizedDistance));
	if (shoulderWeight <= 0) return 1;
	const broad = valueNoise2D(
		normalizedX * policy.broadFrequency + seed,
		normalizedY * policy.broadFrequency - seed,
		seed + 503,
	);
	const detail = valueNoise2D(
		normalizedX * policy.detailFrequency - 11,
		normalizedY * policy.detailFrequency + 23,
		seed + 601,
	);
	const centered = (broad * 0.62 + detail * 0.38 - 0.5) * 2;
	return 1 + centered * policy.strength * shoulderWeight;
}

const COMPILED_CHAINS = Object.freeze(REFERENCE_RELIEF_CHAINS.map((chain) => {
	const profile = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains[chain.id];
	if (!profile) throw new Error(`missing live mountain profile for ${chain.id}`);
	const points = Object.freeze(chain.points.map(([x, y]) => Object.freeze([x * MAP_ASPECT, y])));
	const xs = points.map((point) => point[0]);
	const ys = points.map((point) => point[1]);
	const maximumWidthScale = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.shoulderWidthVariation.maximumScale;
	return Object.freeze({
		id: chain.id,
		points,
		profile,
		minX: Math.min(...xs) - profile.outerWidthNormalized * maximumWidthScale,
		maxX: Math.max(...xs) + profile.outerWidthNormalized * maximumWidthScale,
		minY: Math.min(...ys) - profile.outerWidthNormalized * maximumWidthScale,
		maxY: Math.max(...ys) + profile.outerWidthNormalized * maximumWidthScale,
	});
}));

/**
 * Samples canonical relief directly in normalized owner-map coordinates.
 * Heights are real meters and exactly zero outside mapped chain shoulders or over water.
 */
export function sampleNormalizedReferenceMountainReliefMeters(normalizedX, normalizedY) {
	if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
	if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) throw new RangeError('normalized coordinates must be in [0,1]');

	let strongestMeters = 0;
	for (const chain of COMPILED_CHAINS) {
		const unwarpedX = normalizedX * MAP_ASPECT;
		const unwarpedY = normalizedY;
		const warpPaddingX = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.coordinateWarpNormalized * MAP_ASPECT * 0.5;
		const warpPaddingY = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.coordinateWarpNormalized * 0.5;
		if (
			unwarpedX < chain.minX - warpPaddingX ||
			unwarpedX > chain.maxX + warpPaddingX ||
			unwarpedY < chain.minY - warpPaddingY ||
			unwarpedY > chain.maxY + warpPaddingY
		) continue;

		const warpFrequency = 18;
		const warpX = (valueNoise2D(normalizedX * warpFrequency, normalizedY * warpFrequency, chain.profile.seed) - 0.5)
			* WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.coordinateWarpNormalized * MAP_ASPECT;
		const warpY = (valueNoise2D(normalizedX * warpFrequency + 31, normalizedY * warpFrequency - 17, chain.profile.seed) - 0.5)
			* WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.coordinateWarpNormalized;
		const px = unwarpedX + warpX;
		const py = unwarpedY + warpY;
		if (px < chain.minX || px > chain.maxX || py < chain.minY || py > chain.maxY) continue;

		let distance = Infinity;
		for (let index = 0; index < chain.points.length - 1; index += 1) {
			const a = chain.points[index];
			const b = chain.points[index + 1];
			distance = Math.min(distance, pointSegmentDistance(px, py, a[0], a[1], b[0], b[1]));
		}

		const widthScale = sampleShoulderWidthScale(normalizedX, normalizedY, chain.profile.seed);
		const coreWidth = chain.profile.coreWidthNormalized * clamp(widthScale * 0.92, 0.78, 1.22);
		const outerWidth = chain.profile.outerWidthNormalized * widthScale;
		if (distance >= outerWidth) continue;
		const normalizedDistance = clamp(distance / Math.max(outerWidth, 1e-9), 0, 1);
		const coreRatio = clamp(coreWidth / Math.max(outerWidth, 1e-9), 0.06, 0.24);
		// **Sharper, on the owner's instruction: "daha sivri".** This was `1.10 + coreRatio * 2.0`, an
		// exponent of 1.22-1.58, and `cos^1.3` is a *dome*: it falls away from the crest so gently that a
		// chain reads as one smooth whale-back rather than as mountains. The render of the Bone Mountains
		// made it unmistakable — a single continuous loaf several kilometres long. At `cos^2.6` the flanks
		// drop away fast enough for a crest to read as a peak.
		const ridgeExponent = 2.20 + coreRatio * 4.0;
		const ridge = Math.pow(Math.cos(normalizedDistance * Math.PI * 0.5), ridgeExponent);
		// **A series of summits, not one swell: "sıra dağ grupları".**
		//
		// The first attempt at this simply added two finer octaves to the weighted sum, and it made the
		// range *smoother*. Averaging more noise fields pulls their sum toward the middle — four octaves
		// averaged land near 0.5 almost everywhere, so the crest height barely varied along its length and
		// the chain stayed the single whale-back it had been. More detail, less shape.
		//
		// Summits come from a **product**, not an average. `broad` sets where the range rises at all;
		// `fine` cuts the saddles between individual peaks. Multiplying them means either one being low
		// drops the crest, which is exactly the peak-and-col rhythm a real range has. The fine term is
		// remapped to 0.45..1 rather than 0..1 so the spine stays a spine: a range is high ground with
		// summits on it, not a row of detached cones.
		const broad = (
			valueNoise2D(normalizedX * 8, normalizedY * 8, chain.profile.seed + 101) * 0.60 +
			valueNoise2D(normalizedX * 17, normalizedY * 17, chain.profile.seed + 211) * 0.40
		);
		const fine = (
			valueNoise2D(normalizedX * 34, normalizedY * 34, chain.profile.seed + 307) * 0.60 +
			valueNoise2D(normalizedX * 61, normalizedY * 61, chain.profile.seed + 419) * 0.40
		);
		// The gain is what makes the peaks *sharp* rather than merely uneven. A product of two noise
		// fields is rarely high — it needs both terms high at once — so shaping the crest this way gave
		// the right rhythm but shaved the summits: the world's tallest point fell from 759 m to 636 m
		// while the saddles behaved. Multiplying by 1.55 and clamping lets the genuinely good spots
		// saturate into real summits while the cols stay where the product put them, which is the
		// difference between a bumpy ridge and a range with peaks on it.
		const summitNoise = Math.min(1, Math.pow(broad, 1.0) * (0.40 + 0.60 * Math.pow(fine, 1.5)) * 1.55);
		const summitFloor = chain.profile.summitFloor ?? WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.summitModulationMinimum;
		// `summitNoise` already carries its own shaping exponents above, so the global
		// `summitNoiseExponent` is deliberately not applied a second time here — squaring the product
		// again would collapse the range back toward its floor.
		const modulation = summitFloor + (1 - summitFloor) * summitNoise;
		const talusBreakup = sampleTalusBreakup(normalizedX, normalizedY, normalizedDistance, chain.profile.seed);
		const passMultiplier = samplePassMultiplier(normalizedX, normalizedY, chain.profile.passes);
		strongestMeters = Math.max(
			strongestMeters,
			chain.profile.peakMeters * ridge * modulation * talusBreakup * passMultiplier,
		);
	}
	if (strongestMeters === 0) return 0;

	const dryLandWeight = sampleReferenceDryLandWeight(normalizedX, normalizedY);
	const landGate = smoothstep(
		WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero,
		WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull,
		dryLandWeight,
	);
	if (landGate === 0) return 0;
	return strongestMeters * landGate * sampleCoastalReliefScale(normalizedX, normalizedY, dryLandWeight);
}

/**
 * Live world-space wrapper. Samples outside the canonical 9000x7000 map canvas return zero instead
 * of throwing, preserving the legacy height sampler's safe behavior beyond the intended world edge.
 */
export function sampleWorldReferenceMountainReliefMeters(worldX, worldZ) {
	if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) throw new TypeError('world coordinates must be finite');
	const metersPerMapUnit = WORLD_SCALE.METERS_PER_MAP_UNIT;
	const centerMapX = (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5;
	const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
	const mapX = worldX / metersPerMapUnit + centerMapX;
	const mapY = worldZ / metersPerMapUnit + centerMapY;
	if (
		mapX < 0 || mapX > WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits ||
		mapY < 0 || mapY > WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits
	) return 0;
	return sampleNormalizedReferenceMountainReliefMeters(
		mapX / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits,
		mapY / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits,
	);
}