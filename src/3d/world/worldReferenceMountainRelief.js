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
	id: 'owner-map-live-mountain-relief-2026-08-14-v1',
	sourceMapSha256: WORLD_REFERENCE_MAP.sha256,
	surfaceMaskSha256: WORLD_REFERENCE_BASE_SURFACE_MASK.maskSha256,
	landGateZero: 0.54,
	landGateFull: 0.84,
	coordinateWarpNormalized: 0.003,
	summitModulationMinimum: 0.08,
	summitNoiseExponent: 2,
	// Western chains overlap shipped kingdom roads, so their audited map-space approaches are
	// lowered into traversable passes instead of flattening/removing the surrounding mountains.
	// Bone/eastern chains need no authored pass yet because no current live road crosses them.
	chains: Object.freeze({
		'vale-chain': Object.freeze({
			peakMeters: 430,
			coreWidthNormalized: 0.007,
			outerWidthNormalized: 0.052,
			summitFloor: 0.65,
			seed: 11,
			passes: Object.freeze([
				Object.freeze({ id: 'vale-northwest-approach', center: [0.206, 0.399], innerRadiusNormalized: 0.015, outerRadiusNormalized: 0.050, minimumMultiplier: 0.02 }),
				Object.freeze({ id: 'vale-south-approach', center: [0.233, 0.467], innerRadiusNormalized: 0.018, outerRadiusNormalized: 0.055, minimumMultiplier: 0.02 }),
			]),
		}),
		'red-mountains': Object.freeze({
			peakMeters: 380,
			coreWidthNormalized: 0.008,
			outerWidthNormalized: 0.050,
			summitFloor: 0.55,
			seed: 23,
			passes: Object.freeze([
				Object.freeze({ id: 'red-west-approach', center: [0.145, 0.610], innerRadiusNormalized: 0.014, outerRadiusNormalized: 0.045, minimumMultiplier: 0.08 }),
				Object.freeze({ id: 'red-central-approach', center: [0.179, 0.651], innerRadiusNormalized: 0.016, outerRadiusNormalized: 0.055, minimumMultiplier: 0.08 }),
				Object.freeze({ id: 'red-east-approach', center: [0.225, 0.640], innerRadiusNormalized: 0.014, outerRadiusNormalized: 0.050, minimumMultiplier: 0.08 }),
			]),
		}),
		'bone-mountains': Object.freeze({ peakMeters: 1100, coreWidthNormalized: 0.008, outerWidthNormalized: 0.060, seed: 37 }),
		'eastern-chain': Object.freeze({ peakMeters: 1000, coreWidthNormalized: 0.007, outerWidthNormalized: 0.055, seed: 53 }),
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
		if (distance >= pass.outerRadiusNormalized) continue;
		const influence = 1 - smoothstep(pass.innerRadiusNormalized, pass.outerRadiusNormalized, distance);
		multiplier = Math.min(
			multiplier,
			1 - influence * (1 - pass.minimumMultiplier),
		);
	}
	return multiplier;
}

const COMPILED_CHAINS = Object.freeze(REFERENCE_RELIEF_CHAINS.map((chain) => {
	const profile = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains[chain.id];
	if (!profile) throw new Error(`missing live mountain profile for ${chain.id}`);
	const points = Object.freeze(chain.points.map(([x, y]) => Object.freeze([x * MAP_ASPECT, y])));
	const xs = points.map((point) => point[0]);
	const ys = points.map((point) => point[1]);
	return Object.freeze({
		id: chain.id,
		points,
		profile,
		minX: Math.min(...xs) - profile.outerWidthNormalized,
		maxX: Math.max(...xs) + profile.outerWidthNormalized,
		minY: Math.min(...ys) - profile.outerWidthNormalized,
		maxY: Math.max(...ys) + profile.outerWidthNormalized,
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
		if (distance >= chain.profile.outerWidthNormalized) continue;
		const ridge = 1 - smoothstep(chain.profile.coreWidthNormalized, chain.profile.outerWidthNormalized, distance);
		const summitNoise = (
			valueNoise2D(normalizedX * 8, normalizedY * 8, chain.profile.seed + 101) * 0.75 +
			valueNoise2D(normalizedX * 17, normalizedY * 17, chain.profile.seed + 211) * 0.25
		);
		const summitFloor = chain.profile.summitFloor ?? WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.summitModulationMinimum;
		const modulation = summitFloor +
			(1 - summitFloor) *
				Math.pow(summitNoise, WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.summitNoiseExponent);
		const passMultiplier = samplePassMultiplier(normalizedX, normalizedY, chain.profile.passes);
		strongestMeters = Math.max(
			strongestMeters,
			chain.profile.peakMeters * Math.pow(ridge, 1.12) * modulation * passMultiplier,
		);
	}
	if (strongestMeters === 0) return 0;

	const dryLandWeight = sampleReferenceDryLandWeight(normalizedX, normalizedY);
	const landGate = smoothstep(
		WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero,
		WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull,
		dryLandWeight,
	);
	return strongestMeters * landGate;
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
