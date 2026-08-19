/**
 * Canonical map-aligned mountain and highland relief for the live Three.js height field.
 *
 * map.png remains geography authority. Only its audited mountain chains and elevated biome anchors
 * receive large relief; settlement plains remain usable. Renderer, collider, roads, rivers,
 * vegetation and settlements all consume this same deterministic field through terrain.js.
 * @module world/worldReferenceMountainRelief
 */
import { WORLD_SCALE } from '../config.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';
import {
	REFERENCE_BIOME_ZONES,
	REFERENCE_RELIEF_CHAINS,
	WORLD_REFERENCE_MAP,
	sampleReferenceInfluence,
} from './worldReferenceMap.js';
import { WORLD_REFERENCE_BASE_SURFACE_MASK } from './worldReferenceSurfacePindexes.js';

export const WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY = Object.freeze({
	id: 'owner-map-live-geography-relief-2026-08-19-v4',
	sourceMapSha256: WORLD_REFERENCE_MAP.sha256,
	surfaceMaskSha256: WORLD_REFERENCE_BASE_SURFACE_MASK.maskSha256,
	landGateZero: 0.54,
	landGateFull: 0.84,
	coordinateWarpNormalized: 0.0035,
	summitModulationMinimum: 0.08,
	summitNoiseExponent: 2.15,
	shoulderWidthVariation: Object.freeze({ broadFrequency: 5.5, detailFrequency: 13.5, minimumScale: 0.86, maximumScale: 1.58 }),
	coastalReliefTaper: Object.freeze({ radiusNormalized: 0.012, minimumScale: 0.10 }),
	talusBreakup: Object.freeze({ broadFrequency: 22, detailFrequency: 47, strength: 0.21, shoulderStart: 0.18, shoulderEnd: 0.90 }),
	ridgeNaturalization: Object.freeze({
		primarySharpness: 1.42,
		secondaryCenter: 0.40,
		secondaryCenterJitter: 0.10,
		secondaryWidth: 0.105,
		secondaryStrength: 0.31,
		outerRidgeCenter: 0.68,
		outerRidgeWidth: 0.11,
		outerRidgeStrength: 0.13,
		crestDetailFrequency: 39,
		crestDetailStrength: 0.20,
		valleyFrequency: 8.5,
		valleyStrength: 0.36,
	}),
	// Moderate map-supported uplands only. Reach, Dothraki Sea and other broad plains are excluded.
	highlands: Object.freeze({
		'lands-always-winter': Object.freeze({ baseMeters: 145, ruggedMeters: 190, seed: 71, minimumInfluence: 0.08 }),
		north: Object.freeze({ baseMeters: 52, ruggedMeters: 74, seed: 73, minimumInfluence: 0.12 }),
		westerlands: Object.freeze({ baseMeters: 68, ruggedMeters: 108, seed: 79, minimumInfluence: 0.10 }),
	}),
	habitableSeatProtection: Object.freeze({ innerRadiusNormalized: 0.010, outerRadiusNormalized: 0.045, minimumMultiplier: 0.34 }),
	chains: Object.freeze({
		'vale-chain': Object.freeze({
			peakMeters: 720,
			coreWidthNormalized: 0.0065,
			outerWidthNormalized: 0.056,
			summitFloor: 0.38,
			seed: 11,
			passes: Object.freeze([
				// 0.035 keeps the audited road pass low while preventing a visible zero-height break in the ridge.
				Object.freeze({ id: 'vale-northwest-approach', center: [0.206, 0.399], innerRadiusNormalized: 0.015, outerRadiusNormalized: 0.050, minimumMultiplier: 0.035, corridorVia: [0.1755, 0.3738], corridorEnd: [0.169444, 0.250], corridorInnerRadiusNormalized: 0.012, corridorOuterRadiusNormalized: 0.030 }),
				Object.freeze({ id: 'vale-south-approach', center: [0.233, 0.467], innerRadiusNormalized: 0.018, outerRadiusNormalized: 0.055, minimumMultiplier: 0.02 }),
			]),
		}),
		'red-mountains': Object.freeze({
			peakMeters: 650,
			coreWidthNormalized: 0.007,
			outerWidthNormalized: 0.055,
			summitFloor: 0.34,
			seed: 23,
			passes: Object.freeze([
				Object.freeze({ id: 'red-west-approach', center: [0.145, 0.610], innerRadiusNormalized: 0.014, outerRadiusNormalized: 0.045, minimumMultiplier: 0.08 }),
				Object.freeze({ id: 'red-central-approach', center: [0.179, 0.651], innerRadiusNormalized: 0.016, outerRadiusNormalized: 0.055, minimumMultiplier: 0.08, corridorEnd: [0.139, 0.587], corridorInnerRadiusNormalized: 0.009, corridorOuterRadiusNormalized: 0.024 }),
				Object.freeze({ id: 'red-east-approach', center: [0.225, 0.640], innerRadiusNormalized: 0.014, outerRadiusNormalized: 0.050, minimumMultiplier: 0.08 }),
			]),
		}),
		'bone-mountains': Object.freeze({ peakMeters: 1580, coreWidthNormalized: 0.0065, outerWidthNormalized: 0.064, summitFloor: 0.26, seed: 37 }),
		'eastern-chain': Object.freeze({ peakMeters: 1480, coreWidthNormalized: 0.006, outerWidthNormalized: 0.060, summitFloor: 0.28, seed: 53 }),
	}),
});

const MAP_ASPECT = WORLD_REFERENCE_MAP.pixelWidth / WORLD_REFERENCE_MAP.pixelHeight;
const SEA_CODE = WORLD_REFERENCE_BASE_SURFACE_MASK.codes.sea;
const LAKE_CODE = WORLD_REFERENCE_BASE_SURFACE_MASK.codes.lake;
const HABITABLE_SEAT_MAP_POINTS = Object.freeze([
	[3885, 5370], [1525, 1750], [1185, 4040], [1095, 4040], [1145, 3990], [1750, 3580], [2100, 3270],
	[1610, 4560], [920, 2900], [1850, 2790], [1650, 1060], [1050, 3360], [6190, 5140], [1400, 300],
]);
const HABITABLE_SEATS = Object.freeze(HABITABLE_SEAT_MAP_POINTS.map(([mapX, mapY]) => Object.freeze([
	mapX / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits,
	mapY / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits,
])));

function smoothstep(edge0, edge1, value) {
	if (value <= edge0) return 0;
	if (value >= edge1) return 1;
	const t = (value - edge0) / (edge1 - edge0);
	return t * t * (3 - 2 * t);
}
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function gaussian(value, center, width) {
	const normalized = (value - center) / Math.max(width, 1e-9);
	return Math.exp(-0.5 * normalized * normalized);
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
	return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
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
	const cx = Math.min(width - 1, Math.max(0, x));
	const cy = Math.min(height - 1, Math.max(0, y));
	const code = DECODED_SURFACE_MASK[cy * width + cx];
	return code === SEA_CODE || code === LAKE_CODE ? 0 : 1;
}

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
	const p = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.coastalReliefTaper;
	const radiusY = p.radiusNormalized;
	const radiusX = radiusY / MAP_ASPECT;
	const clearance = Math.min(
		centerDryWeight,
		sampleReferenceDryLandWeight(clamp(normalizedX - radiusX, 0, 1), normalizedY),
		sampleReferenceDryLandWeight(clamp(normalizedX + radiusX, 0, 1), normalizedY),
		sampleReferenceDryLandWeight(normalizedX, clamp(normalizedY - radiusY, 0, 1)),
		sampleReferenceDryLandWeight(normalizedX, clamp(normalizedY + radiusY, 0, 1)),
	);
	return p.minimumScale + (1 - p.minimumScale) * smoothstep(0.18, WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull, clearance);
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
		const distance = Math.hypot((normalizedX - pass.center[0]) * MAP_ASPECT, normalizedY - pass.center[1]);
		const centerInfluence = distance >= pass.outerRadiusNormalized ? 0 : 1 - smoothstep(pass.innerRadiusNormalized, pass.outerRadiusNormalized, distance);
		let corridorInfluence = 0;
		if (pass.corridorEnd) {
			const via = pass.corridorVia ?? pass.center;
			const corridorDistance = Math.min(
				pointSegmentDistance(normalizedX * MAP_ASPECT, normalizedY, pass.center[0] * MAP_ASPECT, pass.center[1], via[0] * MAP_ASPECT, via[1]),
				pointSegmentDistance(normalizedX * MAP_ASPECT, normalizedY, via[0] * MAP_ASPECT, via[1], pass.corridorEnd[0] * MAP_ASPECT, pass.corridorEnd[1]),
			);
			corridorInfluence = corridorDistance >= pass.corridorOuterRadiusNormalized ? 0 : 1 - smoothstep(pass.corridorInnerRadiusNormalized, pass.corridorOuterRadiusNormalized, corridorDistance);
		}
		const influence = Math.max(centerInfluence, corridorInfluence);
		if (influence > 0) multiplier = Math.min(multiplier, 1 - influence * (1 - pass.minimumMultiplier));
	}
	return multiplier;
}
function sampleHabitableSeatMultiplier(normalizedX, normalizedY) {
	const p = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.habitableSeatProtection;
	let multiplier = 1;
	for (const seat of HABITABLE_SEATS) {
		const distance = Math.hypot((normalizedX - seat[0]) * MAP_ASPECT, normalizedY - seat[1]);
		if (distance >= p.outerRadiusNormalized) continue;
		const blend = smoothstep(p.innerRadiusNormalized, p.outerRadiusNormalized, distance);
		multiplier = Math.min(multiplier, p.minimumMultiplier + (1 - p.minimumMultiplier) * blend);
	}
	return multiplier;
}
function sampleShoulderWidthScale(normalizedX, normalizedY, seed) {
	const p = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.shoulderWidthVariation;
	const broad = valueNoise2D(normalizedX * p.broadFrequency, normalizedY * p.broadFrequency, seed + 307);
	const detail = valueNoise2D(normalizedX * p.detailFrequency + 17, normalizedY * p.detailFrequency - 29, seed + 409);
	return p.minimumScale + (p.maximumScale - p.minimumScale) * (broad * 0.72 + detail * 0.28);
}
function sampleTalusBreakup(normalizedX, normalizedY, normalizedDistance, seed) {
	const p = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.talusBreakup;
	const shoulderWeight = smoothstep(p.shoulderStart, p.shoulderEnd, normalizedDistance) * (1 - smoothstep(p.shoulderEnd, 1, normalizedDistance));
	if (shoulderWeight <= 0) return 1;
	const broad = valueNoise2D(normalizedX * p.broadFrequency + seed, normalizedY * p.broadFrequency - seed, seed + 503);
	const detail = valueNoise2D(normalizedX * p.detailFrequency - 11, normalizedY * p.detailFrequency + 23, seed + 601);
	return 1 + (broad * 0.62 + detail * 0.38 - 0.5) * 2 * p.strength * shoulderWeight;
}
function sampleNaturalizedRidgeShape(normalizedX, normalizedY, normalizedDistance, coreRatio, seed) {
	const p = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.ridgeNaturalization;
	const ridgeExponent = (1.10 + coreRatio * 2.0) * p.primarySharpness;
	const primary = Math.pow(Math.cos(normalizedDistance * Math.PI * 0.5), ridgeExponent);
	const centerJitter = (valueNoise2D(normalizedX * 11 + 7, normalizedY * 11 - 5, seed + 701) - 0.5) * 2 * p.secondaryCenterJitter;
	const secondary = gaussian(normalizedDistance, p.secondaryCenter + centerJitter, p.secondaryWidth) * p.secondaryStrength;
	const outer = gaussian(normalizedDistance, p.outerRidgeCenter - centerJitter * 0.45, p.outerRidgeWidth) * p.outerRidgeStrength;
	const crestDetail = 1 + (valueNoise2D(normalizedX * p.crestDetailFrequency + seed, normalizedY * p.crestDetailFrequency - seed, seed + 809) - 0.5)
		* 2 * p.crestDetailStrength * (1 - smoothstep(0.15, 0.88, normalizedDistance));
	const valleyNoise = valueNoise2D(normalizedX * p.valleyFrequency + seed * 0.13, normalizedY * p.valleyFrequency - seed * 0.17, seed + 907);
	const valley = smoothstep(0.64, 0.90, valleyNoise) * (1 - smoothstep(0.78, 0.98, normalizedDistance));
	return Math.max(0, (primary + secondary + outer) * crestDetail * (1 - valley * p.valleyStrength));
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
const COMPILED_HIGHLANDS = Object.freeze(Object.entries(WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.highlands).map(([zoneId, profile]) => {
	const zone = REFERENCE_BIOME_ZONES.find((candidate) => candidate.id === zoneId);
	if (!zone) throw new Error(`missing canonical biome zone for highland ${zoneId}`);
	return Object.freeze({ zone, profile });
}));
function sampleMappedHighlandMeters(normalizedX, normalizedY) {
	let strongestMeters = 0;
	for (const { zone, profile } of COMPILED_HIGHLANDS) {
		const influence = sampleReferenceInfluence(normalizedX, normalizedY, zone);
		if (influence <= profile.minimumInfluence) continue;
		const weight = smoothstep(profile.minimumInfluence, 1, influence);
		const macro = valueNoise2D(normalizedX * 6.5 + profile.seed, normalizedY * 6.5 - profile.seed, profile.seed + 1009);
		const ridgeNoise = valueNoise2D(normalizedX * 17 - profile.seed, normalizedY * 13 + profile.seed, profile.seed + 1103);
		const rugged = Math.pow(Math.abs(ridgeNoise - 0.5) * 2, 1.35);
		strongestMeters = Math.max(strongestMeters, weight * (profile.baseMeters * (0.72 + macro * 0.45) + profile.ruggedMeters * rugged));
	}
	return strongestMeters;
}

export function sampleNormalizedReferenceMountainReliefMeters(normalizedX, normalizedY) {
	if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
	if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) throw new RangeError('normalized coordinates must be in [0,1]');
	let strongestMeters = 0;
	for (const chain of COMPILED_CHAINS) {
		const unwarpedX = normalizedX * MAP_ASPECT;
		const unwarpedY = normalizedY;
		const paddingX = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.coordinateWarpNormalized * MAP_ASPECT * 0.5;
		const paddingY = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.coordinateWarpNormalized * 0.5;
		if (unwarpedX < chain.minX - paddingX || unwarpedX > chain.maxX + paddingX || unwarpedY < chain.minY - paddingY || unwarpedY > chain.maxY + paddingY) continue;

		const warpFrequency = 18;
		const px = unwarpedX + (valueNoise2D(normalizedX * warpFrequency, normalizedY * warpFrequency, chain.profile.seed) - 0.5)
			* WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.coordinateWarpNormalized * MAP_ASPECT;
		const py = unwarpedY + (valueNoise2D(normalizedX * warpFrequency + 31, normalizedY * warpFrequency - 17, chain.profile.seed) - 0.5)
			* WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.coordinateWarpNormalized;
		if (px < chain.minX || px > chain.maxX || py < chain.minY || py > chain.maxY) continue;

		let distance = Infinity;
		for (let index = 0; index < chain.points.length - 1; index += 1) {
			const a = chain.points[index];
			const b = chain.points[index + 1];
			distance = Math.min(distance, pointSegmentDistance(px, py, a[0], a[1], b[0], b[1]));
		}
		const widthScale = sampleShoulderWidthScale(normalizedX, normalizedY, chain.profile.seed);
		const coreWidth = chain.profile.coreWidthNormalized * clamp(widthScale * 0.92, 0.76, 1.20);
		const outerWidth = chain.profile.outerWidthNormalized * widthScale;
		if (distance >= outerWidth) continue;
		const normalizedDistance = clamp(distance / Math.max(outerWidth, 1e-9), 0, 1);
		const coreRatio = clamp(coreWidth / Math.max(outerWidth, 1e-9), 0.05, 0.22);
		const ridge = sampleNaturalizedRidgeShape(normalizedX, normalizedY, normalizedDistance, coreRatio, chain.profile.seed);
		const summitNoise = valueNoise2D(normalizedX * 8, normalizedY * 8, chain.profile.seed + 101) * 0.58
			+ valueNoise2D(normalizedX * 17, normalizedY * 17, chain.profile.seed + 211) * 0.27
			+ valueNoise2D(normalizedX * 31, normalizedY * 31, chain.profile.seed + 313) * 0.15;
		const summitFloor = chain.profile.summitFloor ?? WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.summitModulationMinimum;
		const modulation = summitFloor + (1 - summitFloor) * Math.pow(summitNoise, WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.summitNoiseExponent);
		const talusBreakup = sampleTalusBreakup(normalizedX, normalizedY, normalizedDistance, chain.profile.seed);
		const passMultiplier = samplePassMultiplier(normalizedX, normalizedY, chain.profile.passes);
		strongestMeters = Math.max(strongestMeters, chain.profile.peakMeters * ridge * modulation * talusBreakup * passMultiplier);
	}

	strongestMeters = Math.max(strongestMeters, sampleMappedHighlandMeters(normalizedX, normalizedY));
	if (strongestMeters === 0) return 0;
	const dryLandWeight = sampleReferenceDryLandWeight(normalizedX, normalizedY);
	const landGate = smoothstep(WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero, WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull, dryLandWeight);
	if (landGate === 0) return 0;
	const seatMultiplier = sampleHabitableSeatMultiplier(normalizedX, normalizedY);
	return strongestMeters * landGate * sampleCoastalReliefScale(normalizedX, normalizedY, dryLandWeight) * seatMultiplier;
}

export function sampleWorldReferenceMountainReliefMeters(worldX, worldZ) {
	if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) throw new TypeError('world coordinates must be finite');
	const metersPerMapUnit = WORLD_SCALE.METERS_PER_MAP_UNIT;
	const centerMapX = (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5;
	const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
	const mapX = worldX / metersPerMapUnit + centerMapX;
	const mapY = worldZ / metersPerMapUnit + centerMapY;
	if (mapX < 0 || mapX > WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits || mapY < 0 || mapY > WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits) return 0;
	return sampleNormalizedReferenceMountainReliefMeters(
		mapX / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits,
		mapY / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits,
	);
}
