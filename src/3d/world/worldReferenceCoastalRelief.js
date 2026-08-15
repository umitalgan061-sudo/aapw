/**
 * Canonical coast-to-inland physical relief derived from the owner-map water mask.
 *
 * The owner map's immutable 96x64 water raster is deliberately not edited. Instead this module
 * composes it with the already-established run182 seat-safe hydrology contract: canonical kingdom
 * seats receive a smooth 75m protected-land footprint, while ordinary sea/lake cells remain wet.
 * Wet ownership is physically below WATER_LEVEL_METERS; shoreline land starts only slightly above
 * water and rises progressively into interior highlands. The shared terrain height sampler consumes
 * this base, so render geometry, collision, roads, rivers, vegetation and settlements agree.
 *
 * Distance fields are compiled once from the tiny source-derived mask. Per-vertex sampling remains
 * allocation-free apart from the pre-existing frozen hydrology diagnostic object at protected-site
 * resolution; the expensive distance search never occurs in the terrain hot path.
 * @module world/worldReferenceCoastalRelief
 */

import { WORLD_DEFAULTS, WORLD_SCALE } from '../config.js';
import {
	WORLD_REFERENCE_ALIGNMENT,
	mapCanvasToNormalizedReference,
} from './worldReferenceAlignment.js';
import {
	WORLD_REFERENCE_WATER_MASK,
	classifyReferenceWaterCell,
} from './worldReferenceWaterMask.js';
import {
	referenceProtectionRadiiFromMeters,
	sampleProtectedLandWeight,
} from './worldReferenceHydrology.js';

export const WORLD_REFERENCE_COASTAL_RELIEF_POLICY = Object.freeze({
	id: 'owner-map-coastal-relief-2026-08-15-v2-seat-safe',
	waterMaskSha256: WORLD_REFERENCE_WATER_MASK.maskSha256,
	protectedLandRadiusMeters: 75,
	shoreClearanceMeters: 1.25,
	coastRiseMeters: 24,
	coastRiseDistanceMeters: 800,
	interiorRiseMeters: 34,
	interiorRiseStartMeters: 450,
	interiorRiseDistanceMeters: 2600,
	fineDetailMinimumWeight: 0.12,
	fineDetailFullDistanceMeters: 900,
	seaNearshoreDepthMeters: 4,
	seaDeepDepthMeters: 28,
	seaDeepDistanceMeters: 1800,
	lakeDepthMeters: 3.5,
	wetFloorNoiseMeters: 2.2,
	landBlendZero: 0.38,
	landBlendFull: 0.72,
});

/**
 * Low-level copy of the canonical seat anchors used only to protect mandatory land from coarse
 * raster false-water. `scripts/checkWorldReferenceCoastalRelief.mjs` hard-fails if these coordinates
 * ever drift from `settlements.js`, keeping the runtime dependency one-way (terrain must not import
 * the Three.js-heavy settlements module) without silently duplicating geography.
 */
const PROTECTED_SEAT_MAP_ANCHORS = Object.freeze([
	Object.freeze({ id: 'umit', mapX: 3885, mapY: 5370 }),
	Object.freeze({ id: 'berkalp', mapX: 1525, mapY: 1750 }),
	Object.freeze({ id: 'ziya', mapX: 1185, mapY: 4040 }),
	Object.freeze({ id: 'berk', mapX: 1095, mapY: 4040 }),
	Object.freeze({ id: 'olena', mapX: 1145, mapY: 3990 }),
	Object.freeze({ id: 'cersei', mapX: 1750, mapY: 3580 }),
	Object.freeze({ id: 'stannis', mapX: 2100, mapY: 3270 }),
	Object.freeze({ id: 'doran', mapX: 1610, mapY: 4560 }),
	Object.freeze({ id: 'balon', mapX: 920, mapY: 2900 }),
	Object.freeze({ id: 'robin', mapX: 1850, mapY: 2790 }),
	Object.freeze({ id: 'jon', mapX: 1650, mapY: 1060 }),
	Object.freeze({ id: 'twin', mapX: 1050, mapY: 3360 }),
	Object.freeze({ id: 'Xaro', mapX: 6190, mapY: 5140 }),
	Object.freeze({ id: 'Night King', mapX: 1400, mapY: 300 }),
]);

export const WORLD_REFERENCE_COASTAL_PROTECTED_SITES = Object.freeze(PROTECTED_SEAT_MAP_ANCHORS.map((site) => {
	const normalized = mapCanvasToNormalizedReference(site.mapX, site.mapY);
	return Object.freeze({ ...site, x: normalized.x, y: normalized.y });
}));

const PROTECTION_RADII = referenceProtectionRadiiFromMeters(
	WORLD_REFERENCE_COASTAL_RELIEF_POLICY.protectedLandRadiusMeters,
	WORLD_SCALE.METERS_PER_MAP_UNIT,
);

const MASK_WIDTH = WORLD_REFERENCE_WATER_MASK.width;
const MASK_HEIGHT = WORLD_REFERENCE_WATER_MASK.height;
const MAP_WIDTH_METERS = WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits * WORLD_SCALE.METERS_PER_MAP_UNIT;
const MAP_DEPTH_METERS = WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits * WORLD_SCALE.METERS_PER_MAP_UNIT;
const CELL_X_METERS = MAP_WIDTH_METERS / MASK_WIDTH;
const CELL_Z_METERS = MAP_DEPTH_METERS / MASK_HEIGHT;
const CELL_DIAGONAL_METERS = Math.hypot(CELL_X_METERS, CELL_Z_METERS);

function smoothstep(edge0, edge1, value) {
	if (value <= edge0) return 0;
	if (value >= edge1) return 1;
	const t = (value - edge0) / (edge1 - edge0);
	return t * t * (3 - 2 * t);
}

function rowBit(rowHex, x) {
	const nibble = Number.parseInt(rowHex[Math.floor(x / 4)], 16);
	return (nibble >> (3 - (x % 4))) & 1;
}

function rawWaterAtCell(x, y) {
	const clampedX = Math.min(MASK_WIDTH - 1, Math.max(0, x));
	const clampedY = Math.min(MASK_HEIGHT - 1, Math.max(0, y));
	return rowBit(WORLD_REFERENCE_WATER_MASK.rowsHex[clampedY], clampedX) === 1;
}

function dryAtCell(x, y) {
	return rawWaterAtCell(x, y) ? 0 : 1;
}

/** Chamfer distance field in real meters at the immutable 96x64 owner-mask resolution. */
function buildDistanceField(targetPredicate) {
	const field = new Float32Array(MASK_WIDTH * MASK_HEIGHT);
	for (let y = 0; y < MASK_HEIGHT; y += 1) {
		for (let x = 0; x < MASK_WIDTH; x += 1) {
			field[y * MASK_WIDTH + x] = targetPredicate(x, y) ? 0 : Number.POSITIVE_INFINITY;
		}
	}
	const relax = (x, y, nx, ny, cost) => {
		if (nx < 0 || nx >= MASK_WIDTH || ny < 0 || ny >= MASK_HEIGHT) return;
		const index = y * MASK_WIDTH + x;
		const candidate = field[ny * MASK_WIDTH + nx] + cost;
		if (candidate < field[index]) field[index] = candidate;
	};
	for (let pass = 0; pass < 3; pass += 1) {
		for (let y = 0; y < MASK_HEIGHT; y += 1) {
			for (let x = 0; x < MASK_WIDTH; x += 1) {
				relax(x, y, x - 1, y, CELL_X_METERS);
				relax(x, y, x, y - 1, CELL_Z_METERS);
				relax(x, y, x - 1, y - 1, CELL_DIAGONAL_METERS);
				relax(x, y, x + 1, y - 1, CELL_DIAGONAL_METERS);
			}
		}
		for (let y = MASK_HEIGHT - 1; y >= 0; y -= 1) {
			for (let x = MASK_WIDTH - 1; x >= 0; x -= 1) {
				relax(x, y, x + 1, y, CELL_X_METERS);
				relax(x, y, x, y + 1, CELL_Z_METERS);
				relax(x, y, x + 1, y + 1, CELL_DIAGONAL_METERS);
				relax(x, y, x - 1, y + 1, CELL_DIAGONAL_METERS);
			}
		}
	}
	return field;
}

const DISTANCE_TO_WET_METERS = buildDistanceField((x, y) => rawWaterAtCell(x, y));
const DISTANCE_TO_DRY_METERS = buildDistanceField((x, y) => !rawWaterAtCell(x, y));

function bilinearMaskSample(normalizedX, normalizedY, readCell) {
	const fx = normalizedX * MASK_WIDTH - 0.5;
	const fy = normalizedY * MASK_HEIGHT - 0.5;
	const x0 = Math.floor(fx);
	const y0 = Math.floor(fy);
	const tx = smoothstep(0, 1, fx - x0);
	const ty = smoothstep(0, 1, fy - y0);
	const top = readCell(x0, y0) * (1 - tx) + readCell(x0 + 1, y0) * tx;
	const bottom = readCell(x0, y0 + 1) * (1 - tx) + readCell(x0 + 1, y0 + 1) * tx;
	return top * (1 - ty) + bottom * ty;
}

function sampleRawDryLandWeight(normalizedX, normalizedY) {
	return bilinearMaskSample(normalizedX, normalizedY, dryAtCell);
}

function sampleDistanceField(field, normalizedX, normalizedY) {
	return bilinearMaskSample(normalizedX, normalizedY, (x, y) => {
		const clampedX = Math.min(MASK_WIDTH - 1, Math.max(0, x));
		const clampedY = Math.min(MASK_HEIGHT - 1, Math.max(0, y));
		return field[clampedY * MASK_WIDTH + clampedX];
	});
}

function worldToNormalized(worldX, worldZ) {
	const centerMapX = (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5;
	const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
	const mapX = worldX / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapX;
	const mapY = worldZ / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapY;
	if (
		mapX < 0 || mapX > WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits ||
		mapY < 0 || mapY > WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits
	) return null;
	return [
		mapX / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits,
		mapY / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits,
	];
}

function rawSurfaceAtNormalized(normalizedX, normalizedY) {
	const x = Math.min(MASK_WIDTH - 1, Math.max(0, Math.floor(normalizedX * MASK_WIDTH)));
	const y = Math.min(MASK_HEIGHT - 1, Math.max(0, Math.floor(normalizedY * MASK_HEIGHT)));
	return classifyReferenceWaterCell(x, y);
}

function composedOwnership(normalizedX, normalizedY) {
	const rawSurface = rawSurfaceAtNormalized(normalizedX, normalizedY);
	const protectedLandWeight = sampleProtectedLandWeight(
		normalizedX,
		normalizedY,
		WORLD_REFERENCE_COASTAL_PROTECTED_SITES,
		PROTECTION_RADII,
	);
	const rawDryWeight = sampleRawDryLandWeight(normalizedX, normalizedY);
	const dryLandWeight = Math.max(rawDryWeight, protectedLandWeight);
	return {
		rawSurface,
		surface: protectedLandWeight > 0 ? 'land' : rawSurface,
		protectedLandWeight,
		dryLandWeight,
	};
}

/**
 * Fast terrain hot-path sampler. `fineDetailMeters` is the deterministic FBM contribution and
 * `dryMacroReliefMeters` is the legacy hand-authored dome contribution. Both are placed inside the
 * same seat-safe dry-land blend so neither can resurrect a hill above canonical sea/lake ownership.
 */
export function sampleWorldReferenceCoastalBaseMeters(
	worldX,
	worldZ,
	fineDetailMeters,
	maxHeightMeters,
	dryMacroReliefMeters = 0,
) {
	const normalized = worldToNormalized(worldX, worldZ);
	if (!normalized) return fineDetailMeters + dryMacroReliefMeters;
	const normalizedX = normalized[0];
	const normalizedY = normalized[1];
	const ownership = composedOwnership(normalizedX, normalizedY);
	const landDistanceMeters = sampleDistanceField(DISTANCE_TO_WET_METERS, normalizedX, normalizedY);
	const wetDistanceMeters = sampleDistanceField(DISTANCE_TO_DRY_METERS, normalizedX, normalizedY);
	const policy = WORLD_REFERENCE_COASTAL_RELIEF_POLICY;

	const coastRise = policy.coastRiseMeters * smoothstep(0, policy.coastRiseDistanceMeters, landDistanceMeters);
	const interiorRise = policy.interiorRiseMeters * smoothstep(
		policy.interiorRiseStartMeters,
		policy.interiorRiseDistanceMeters,
		landDistanceMeters,
	);
	const detailWeight = policy.fineDetailMinimumWeight +
		(1 - policy.fineDetailMinimumWeight) * smoothstep(0, policy.fineDetailFullDistanceMeters, landDistanceMeters);
	const landHeight = WORLD_DEFAULTS.WATER_LEVEL_METERS + policy.shoreClearanceMeters + coastRise + interiorRise +
		fineDetailMeters * detailWeight + dryMacroReliefMeters;

	const noiseRatio = maxHeightMeters > 0 ? fineDetailMeters / maxHeightMeters : 0.5;
	const centeredWetNoise = (noiseRatio - 0.5) * policy.wetFloorNoiseMeters * 2;
	const wetDepth = ownership.rawSurface === 'lake'
		? policy.lakeDepthMeters
		: policy.seaNearshoreDepthMeters +
			(policy.seaDeepDepthMeters - policy.seaNearshoreDepthMeters) * smoothstep(0, policy.seaDeepDistanceMeters, wetDistanceMeters);
	const wetHeight = WORLD_DEFAULTS.WATER_LEVEL_METERS - wetDepth + centeredWetNoise;
	const landBlend = smoothstep(policy.landBlendZero, policy.landBlendFull, ownership.dryLandWeight);
	return wetHeight + (landHeight - wetHeight) * landBlend;
}

/** Diagnostic sampler for tests/capture tooling; not used in the per-vertex terrain hot path. */
export function sampleWorldReferenceCoastalProfile(worldX, worldZ) {
	const normalized = worldToNormalized(worldX, worldZ);
	if (!normalized) return Object.freeze({ insideReference: false });
	const [normalizedX, normalizedY] = normalized;
	const ownership = composedOwnership(normalizedX, normalizedY);
	return Object.freeze({
		insideReference: true,
		surface: ownership.surface,
		rawSurface: ownership.rawSurface,
		dryLandWeight: ownership.dryLandWeight,
		protectedLandWeight: ownership.protectedLandWeight,
		landDistanceMeters: sampleDistanceField(DISTANCE_TO_WET_METERS, normalizedX, normalizedY),
		wetDistanceMeters: sampleDistanceField(DISTANCE_TO_DRY_METERS, normalizedX, normalizedY),
		normalizedX,
		normalizedY,
	});
}
