/**
 * Canonical coast-to-inland relief derived from the owner map's immutable 96x64 surface mask.
 *
 * This is the missing physical counterpart to the map-aligned surface shader: sea/lake ownership
 * now influences the shared height field itself. Wet cells sit below WATER_LEVEL_METERS, shoreline
 * land starts only slightly above the water, and dry ground rises progressively toward the interior.
 * Mountains remain a separate additive layer in terrain.js, so the owner-map mountain chains keep
 * their audited real-meter peaks while inheriting a believable foothill/base elevation.
 *
 * The distance fields are compiled once at module load from the tiny source-derived mask. Sampling
 * is allocation-free in the terrain hot path: two bilinear distance lookups + one dry-land weight.
 * @module world/worldReferenceCoastalRelief
 */

import { WORLD_DEFAULTS, WORLD_SCALE } from '../config.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';
import { WORLD_REFERENCE_BASE_SURFACE_MASK } from './worldReferenceSurfacePindexes.js';

export const WORLD_REFERENCE_COASTAL_RELIEF_POLICY = Object.freeze({
	id: 'owner-map-coastal-relief-2026-08-15-v1',
	surfaceMaskSha256: WORLD_REFERENCE_BASE_SURFACE_MASK.maskSha256,
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

const { width: MASK_WIDTH, height: MASK_HEIGHT, bitsPerCell: MASK_BITS } = WORLD_REFERENCE_BASE_SURFACE_MASK;
const SEA_CODE = WORLD_REFERENCE_BASE_SURFACE_MASK.codes.sea;
const LAKE_CODE = WORLD_REFERENCE_BASE_SURFACE_MASK.codes.lake;
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

function decodeSurfaceMask() {
	const decoded = new Uint8Array(MASK_WIDTH * MASK_HEIGHT);
	const totalBits = BigInt(MASK_WIDTH * MASK_BITS);
	const codeMask = (1n << BigInt(MASK_BITS)) - 1n;
	for (let y = 0; y < MASK_HEIGHT; y += 1) {
		const row = BigInt(`0x${WORLD_REFERENCE_BASE_SURFACE_MASK.rowsHex[y]}`);
		for (let x = 0; x < MASK_WIDTH; x += 1) {
			const shift = totalBits - BigInt((x + 1) * MASK_BITS);
			decoded[y * MASK_WIDTH + x] = Number((row >> shift) & codeMask);
		}
	}
	return decoded;
}

const DECODED_MASK = decodeSurfaceMask();

function isWetCode(code) {
	return code === SEA_CODE || code === LAKE_CODE;
}

function maskCodeAtCell(x, y) {
	const clampedX = Math.min(MASK_WIDTH - 1, Math.max(0, x));
	const clampedY = Math.min(MASK_HEIGHT - 1, Math.max(0, y));
	return DECODED_MASK[clampedY * MASK_WIDTH + clampedX];
}

function dryAtCell(x, y) {
	return isWetCode(maskCodeAtCell(x, y)) ? 0 : 1;
}

/** Chamfer distance field in real meters; sufficient at the 96x64 ownership-mask resolution. */
function buildDistanceField(targetPredicate) {
	const field = new Float32Array(MASK_WIDTH * MASK_HEIGHT);
	for (let y = 0; y < MASK_HEIGHT; y += 1) {
		for (let x = 0; x < MASK_WIDTH; x += 1) {
			field[y * MASK_WIDTH + x] = targetPredicate(maskCodeAtCell(x, y)) ? 0 : Number.POSITIVE_INFINITY;
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

const DISTANCE_TO_WET_METERS = buildDistanceField((code) => isWetCode(code));
const DISTANCE_TO_DRY_METERS = buildDistanceField((code) => !isWetCode(code));

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

function sampleDryLandWeight(normalizedX, normalizedY) {
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

function surfaceAtNormalized(normalizedX, normalizedY) {
	const x = Math.min(MASK_WIDTH - 1, Math.max(0, Math.floor(normalizedX * MASK_WIDTH)));
	const y = Math.min(MASK_HEIGHT - 1, Math.max(0, Math.floor(normalizedY * MASK_HEIGHT)));
	const code = maskCodeAtCell(x, y);
	if (code === SEA_CODE) return 'sea';
	if (code === LAKE_CODE) return 'lake';
	return 'land';
}

/**
 * Fast terrain hot-path sampler. `fineDetailMeters` is the deterministic FBM contribution and
 * `dryMacroReliefMeters` is the legacy hand-authored dome contribution. Both are placed inside the
 * same dry-land blend so neither can resurrect a hill above canonical sea/lake ownership.
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
	const dryWeight = sampleDryLandWeight(normalizedX, normalizedY);
	const landDistanceMeters = sampleDistanceField(DISTANCE_TO_WET_METERS, normalizedX, normalizedY);
	const wetDistanceMeters = sampleDistanceField(DISTANCE_TO_DRY_METERS, normalizedX, normalizedY);
	const surface = surfaceAtNormalized(normalizedX, normalizedY);
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
	const wetDepth = surface === 'lake'
		? policy.lakeDepthMeters
		: policy.seaNearshoreDepthMeters +
			(policy.seaDeepDepthMeters - policy.seaNearshoreDepthMeters) * smoothstep(0, policy.seaDeepDistanceMeters, wetDistanceMeters);
	const wetHeight = WORLD_DEFAULTS.WATER_LEVEL_METERS - wetDepth + centeredWetNoise;
	const landBlend = smoothstep(policy.landBlendZero, policy.landBlendFull, dryWeight);
	return wetHeight + (landHeight - wetHeight) * landBlend;
}

/** Diagnostic sampler for tests/capture tooling; not used in the per-vertex terrain hot path. */
export function sampleWorldReferenceCoastalProfile(worldX, worldZ) {
	const normalized = worldToNormalized(worldX, worldZ);
	if (!normalized) return Object.freeze({ insideReference: false });
	const [normalizedX, normalizedY] = normalized;
	return Object.freeze({
		insideReference: true,
		surface: surfaceAtNormalized(normalizedX, normalizedY),
		dryLandWeight: sampleDryLandWeight(normalizedX, normalizedY),
		landDistanceMeters: sampleDistanceField(DISTANCE_TO_WET_METERS, normalizedX, normalizedY),
		wetDistanceMeters: sampleDistanceField(DISTANCE_TO_DRY_METERS, normalizedX, normalizedY),
		normalizedX,
		normalizedY,
	});
}
