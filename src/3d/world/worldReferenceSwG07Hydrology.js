/**
 * Günbatımı Ustası — SW GeoCell G07 coast/hydrology refinement.
 *
 * G07 owns source pixels x=0..192, y=896..1024. The immutable 96x64 canonical
 * surface mask remains the semantic source of truth. This module does not alter
 * terrain height, colliders, roads, settlements, or the raw mask. It only exposes
 * a continuous water-confidence field between canonical mask-cell centres so a
 * later visual pass can avoid 16px stair-step transitions without changing any
 * centre classification.
 */
import {
	WORLD_REFERENCE_BASE_SURFACE_MASK,
	classifyReferenceBaseSurface,
} from './worldReferenceSurfacePindexes.js';

export const SW_G07_HYDROLOGY = Object.freeze({
	id: 'sw-g07-hydrology-confidence-2026-08-12-v1',
	geoCell: 'G07',
	gx: 0,
	gy: 7,
	pixelBounds: Object.freeze({ xMin: 0, xMax: 192, yMin: 896, yMax: 1024 }),
	maskBounds: Object.freeze({ xMin: 0, xMax: 11, yMin: 56, yMax: 63 }),
	sourceMapSha256: WORLD_REFERENCE_BASE_SURFACE_MASK.sourceMapSha256,
	maskSha256: WORLD_REFERENCE_BASE_SURFACE_MASK.maskSha256,
});

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function waterFlagAtMaskCell(x, y) {
	const width = WORLD_REFERENCE_BASE_SURFACE_MASK.width;
	const height = WORLD_REFERENCE_BASE_SURFACE_MASK.height;
	const cx = clamp(x, 0, width - 1);
	const cy = clamp(y, 0, height - 1);
	const normalizedX = (cx + 0.5) / width;
	const normalizedY = (cy + 0.5) / height;
	const surface = classifyReferenceBaseSurface(normalizedX, normalizedY);
	return surface === 'sea' || surface === 'lake' ? 1 : 0;
}

/**
 * Continuous water confidence in [0,1] over the canonical map.
 * At every canonical mask-cell centre the value is exactly 0 or 1 and therefore
 * preserves the immutable source classification. Between centres it is bilinear.
 */
export function sampleSwG07WaterConfidence(normalizedX, normalizedY) {
	if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
		throw new TypeError('normalized coordinates must be finite');
	}
	const { width, height } = WORLD_REFERENCE_BASE_SURFACE_MASK;
	const x = clamp(normalizedX, 0, 1) * width - 0.5;
	const y = clamp(normalizedY, 0, 1) * height - 0.5;
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const x1 = x0 + 1;
	const y1 = y0 + 1;
	const tx = x - x0;
	const ty = y - y0;
	const a = waterFlagAtMaskCell(x0, y0);
	const b = waterFlagAtMaskCell(x1, y0);
	const c = waterFlagAtMaskCell(x0, y1);
	const d = waterFlagAtMaskCell(x1, y1);
	const top = a + (b - a) * tx;
	const bottom = c + (d - c) * tx;
	return top + (bottom - top) * ty;
}

export function isInsideSwG07(normalizedX, normalizedY) {
	return normalizedX >= 0 && normalizedX <= 0.125 && normalizedY >= 0.875 && normalizedY <= 1;
}
