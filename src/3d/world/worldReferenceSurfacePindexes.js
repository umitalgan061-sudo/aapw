/**
 * Canonical owner-map surface contract, partitioned into 10 west->east pindexes.
 *
 * Source of truth: the owner-supplied 1536x1024 map.png whose SHA-256 is
 * 20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1.
 *
 * The 96x64 base mask is an offline, deterministic derivative. Runtime never performs OCR,
 * color-thresholding, or image decoding. Each cell stores one 3-bit base ground class:
 * soil=0, rock=1, snow=2, sea=3, lake=4. Roads are intentionally an overlay because the
 * canonical bridge-aware route system owns road geometry; `composeReferenceSurface` allows
 * a route consumer to promote a dry ground cell (or a bridge deck) to `road` without
 * erasing the underlying hydrology contract.
 *
 * Pindex convention: exactly 10 equal normalized X strips, west->east. This is an inspection
 * partition only; it does not change the exact 27x21 canonical chunk ownership grid.
 *
 * @module world/worldReferenceSurfacePindexes
 */

export const WORLD_REFERENCE_SURFACE_TYPES = Object.freeze([
	'sea',
	'lake',
	'soil',
	'road',
	'rock',
	'snow',
]);

export const WORLD_REFERENCE_BASE_SURFACE_MASK = Object.freeze({
	id: 'owner-world-map-surface-mask-2026-08-11-v1',
	sourceMapId: 'owner-world-map-2026-08-08',
	sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
	sourcePixelWidth: 1536,
	sourcePixelHeight: 1024,
	width: 96,
	height: 64,
	bitsPerCell: 3,
	maskSha256: 'afe62a77fcc9b15887540b49b3b60b199e416f5e033aefb987a192411c25ae44',
	codes: Object.freeze({ soil: 0, rock: 1, snow: 2, sea: 3, lake: 4 }),
	cellCounts: Object.freeze({
		sea: 4046,
		lake: 6,
		soil: 1638,
		rock: 323,
		snow: 131,
	}),
	rowsHex: Object.freeze([
		'6db6000000000000db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db',
		'6db6d80124924006db6db6db6db6db0db6db6db6db6db6db6db6db6db6db6db6db6db6db',
		'6db6d809249369b6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db',
		'6db6d84924db49b6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db',
		'6db6db49249b6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db',
		'6db6db49249b69b6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db',
		'6db6db6924926db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db',
		'6db6db6924936db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db',
		'6db6db6924924d36db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db',
		'6db6db6d24d24d36db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db',
		'6db6db6da6da4926c36db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db',
		'6db6db6db6da4926db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db',
		'6db6db6db6da8900db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db',
		'6db6db6db6d24000006db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db',
		'6db6db6db0000000036db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db',
		'6db6db6c000000001b6db6db6db6db6db6db6db6db6db6d86db6db6db6db6db6db6db6db',
		'6db6db6c00000000db6db6db6db6db6db6db6db6db6db6006db6db6db6db6db6db6db6db',
		'6db6db6000000000db6db6db6db6db6db6db6db6db6d80006db6db6db6db6db6db6db6db',
		'6db6db00000000001b6db6db6db6db6db6db6db6db6d80036db6db6db6db6db6db6db6db',
		'6db6db6000000000db6db6db6db6db6db6db6db6db6d80db6db6db6db6db6db6db6db6db',
		'6db6db6000000006db6db6db6db6db6db6db6db6db6db6db6d86db6db6db6db6db6db6db',
		'6db6db6c00000db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db',
		'6db6db6000000db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db',
		'6db6db0030000d925b6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db',
		'6db6db6db60000924b6db0db6db6db6db6db6db6db6db6006db6db6db6db6db6db6db6db',
		'6db6db6db6000092896db01b6db6db6db0db6db6db0d80002526db6db6db6db6db6db6db',
		'6db6db6db6c00092536db0030036db6c001b61b6db00000029244361b6036db6db6db600',
		'6db6db6db6480012536db0000000db60001b0030c00000002924800db6c06db6db6db000',
		'6db6db6d924900125b6d90000000c00000000000000000002928480db6000db6db6d8000',
		'6db6db6c924920148b6d900000000000000000000000000149290800360001b6d8000000',
		'6db6db65124920025b6c80000000000000000000000000012929080000000036d8000000',
		'6db6db6c92492000db6c8000000000000000000000000001492449000000000000000000',
		'6db6db6492492406db6d8000000000000000000000000001491249000000000000000000',
		'6db6db64924920001b6db000000000000000000000000001289249000000000000000000',
		'6db6db6492492000036db000000000000000000000000001489249000000000000000000',
		'6db6db64924920001b6d8000000000000000000000000001491249000000000000000000',
		'6db6db6c92490000db6db000000000000000000000000001489249000000000000000000',
		'6db6db6c00000000036db6c0000000000000000000000001491248000000000000000000',
		'6db6db60124925b65b6c0000000000000000000000000001449248000000000000000000',
		'6db6db0492492db6db6c800000000000000000000000000024a249000000000000000000',
		'6db6db6492492516db6db0000000000000000db000000000249249000000000000000000',
		'6db6db64924924924a6db60000000000001b6d8000000000049449000000000000001000',
		'6db6db6db0000000036db6db6000000006db6d8000000000009248000000000000049240',
		'6db6db6db6db6db6db6db6db6d86db0036db6d8000000000001240000000000000049248',
		'6db6db6db6db6db6db6db6db6db6db0006db000000000000000000000000000000049248',
		'6db6db6db6db6db6db6db6db6db6db0006db600000000000000000000000000000249248',
		'6db6db6db6db6db6db6db6db6db6db0006db6c0000000000000000000000000000249248',
		'6db6db6db6db6db6db6db6db6db6db6006db6c00000d86d80000d8000000000000249248',
		'6db6db6db6db6db6db6db6db6db6db6db6db6d80036db6db6c06db000000000000249240',
		'6db6db6db6db6db6db6db6db6db6db61b6db6db6036db6db6000db6000000c0000249240',
		'6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6000db6c00036db000249240',
		'6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6000db6d80c301b600249240',
		'6db6db6db6db6db6db61b6db6db6db6db6db6db6db6db6db6000db6db6db01b6c0249240',
		'6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6c00db6db6db61b6d8249240',
		'6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6c00db6db6db01b6d8249240',
		'6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db6d86d80db6db6db6db6d82492d8',
		'6db6db6db6db6db6db6db6db6db6db6db6db6db6db6db0db6d80db6db6db6db6d824b6db',
		'6db6db6db6db6db6db6db6db6db6db6db6db61b6db6d801b6db6db6db6db6db6d825b6c3',
		'6db6db6db6db6db6db6db6036db6db6db6db60000000001b6db6db6db6db6db6c02db6db',
		'6db6db6db6db6db6db6c00036db6db6db61b0000000000c06db6db6db6db6db6c36db600',
		'6db6db6db6db6db6db6c06d86db6db6db0000000000006db6db6db6db6db6db6db6db000',
		'6db6db6db6db6db6db6c06db6db6db6db6000000000006db6db6db6db6db6db6c0000000',
		'6db6db6db6db6db6db6c36db6db6db6db6000000000000db6db6db6db6db6db600000000',
		'6db6db6db6db6db6db6db6db6db6db6db6c00000000000db6db6db6db6db6d8000000000',
	]),
});

export const WORLD_REFERENCE_PINDEXES = Object.freeze([
	Object.freeze({ id: 'pindex-01', index: 1, normalizedXMin: 0.0, normalizedXMax: 0.1, pixelXMin: 0.0, pixelXMax: 153.6, baseCellCounts: Object.freeze({ sea: 601, lake: 0, soil: 21, rock: 8, snow: 10 }), roadMode: 'canonical-route-overlay' }),
	Object.freeze({ id: 'pindex-02', index: 2, normalizedXMin: 0.1, normalizedXMax: 0.2, pixelXMin: 153.6, pixelXMax: 307.2, baseCellCounts: Object.freeze({ sea: 261, lake: 1, soil: 148, rock: 96, snow: 70 }), roadMode: 'canonical-route-overlay' }),
	Object.freeze({ id: 'pindex-03', index: 3, normalizedXMin: 0.2, normalizedXMax: 0.3, pixelXMin: 307.2, pixelXMax: 460.8, baseCellCounts: Object.freeze({ sea: 513, lake: 0, soil: 84, rock: 35, snow: 8 }), roadMode: 'canonical-route-overlay' }),
	Object.freeze({ id: 'pindex-04', index: 4, normalizedXMin: 0.3, normalizedXMax: 0.4, pixelXMin: 460.8, pixelXMax: 614.4, baseCellCounts: Object.freeze({ sea: 427, lake: 0, soil: 149, rock: 0, snow: 0 }), roadMode: 'canonical-route-overlay' }),
	Object.freeze({ id: 'pindex-05', index: 5, normalizedXMin: 0.4, normalizedXMax: 0.5, pixelXMin: 614.4, pixelXMax: 768.0, baseCellCounts: Object.freeze({ sea: 453, lake: 0, soil: 187, rock: 0, snow: 0 }), roadMode: 'canonical-route-overlay' }),
	Object.freeze({ id: 'pindex-06', index: 6, normalizedXMin: 0.5, normalizedXMax: 0.6, pixelXMin: 768.0, pixelXMax: 921.6, baseCellCounts: Object.freeze({ sea: 380, lake: 0, soil: 260, rock: 0, snow: 0 }), roadMode: 'canonical-route-overlay' }),
	Object.freeze({ id: 'pindex-07', index: 7, normalizedXMin: 0.6, normalizedXMax: 0.7, pixelXMin: 921.6, pixelXMax: 1075.2, baseCellCounts: Object.freeze({ sea: 321, lake: 0, soil: 194, rock: 31, snow: 30 }), roadMode: 'canonical-route-overlay' }),
	Object.freeze({ id: 'pindex-08', index: 8, normalizedXMin: 0.7, normalizedXMax: 0.8, pixelXMin: 1075.2, pixelXMax: 1228.8, baseCellCounts: Object.freeze({ sea: 404, lake: 5, soil: 157, rock: 61, snow: 13 }), roadMode: 'canonical-route-overlay' }),
	Object.freeze({ id: 'pindex-09', index: 9, normalizedXMin: 0.8, normalizedXMax: 0.9, pixelXMin: 1228.8, pixelXMax: 1382.4, baseCellCounts: Object.freeze({ sea: 370, lake: 0, soil: 206, rock: 0, snow: 0 }), roadMode: 'canonical-route-overlay' }),
	Object.freeze({ id: 'pindex-10', index: 10, normalizedXMin: 0.9, normalizedXMax: 1.0, pixelXMin: 1382.4, pixelXMax: 1536.0, baseCellCounts: Object.freeze({ sea: 316, lake: 0, soil: 232, rock: 92, snow: 0 }), roadMode: 'canonical-route-overlay' }),
]);

const BASE_SURFACE_BY_CODE = Object.freeze(['soil', 'rock', 'snow', 'sea', 'lake']);

function clampNormalized(value, label) {
	if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
	return Math.min(1, Math.max(0, value));
}

function baseMaskCell(normalizedX, normalizedY) {
	const x = Math.min(
		WORLD_REFERENCE_BASE_SURFACE_MASK.width - 1,
		Math.floor(clampNormalized(normalizedX, 'normalizedX') * WORLD_REFERENCE_BASE_SURFACE_MASK.width),
	);
	const y = Math.min(
		WORLD_REFERENCE_BASE_SURFACE_MASK.height - 1,
		Math.floor(clampNormalized(normalizedY, 'normalizedY') * WORLD_REFERENCE_BASE_SURFACE_MASK.height),
	);
	return Object.freeze({ x, y });
}

function readBaseCode(rowHex, x) {
	const bitOffset = x * WORLD_REFERENCE_BASE_SURFACE_MASK.bitsPerCell;
	const bits = BigInt(`0x${rowHex}`);
	const totalBits = BigInt(WORLD_REFERENCE_BASE_SURFACE_MASK.width * WORLD_REFERENCE_BASE_SURFACE_MASK.bitsPerCell);
	const shift = totalBits - BigInt(bitOffset + WORLD_REFERENCE_BASE_SURFACE_MASK.bitsPerCell);
	return Number((bits >> shift) & 0b111n);
}

/** @returns {'soil'|'rock'|'snow'|'sea'|'lake'} */
export function classifyReferenceBaseSurface(normalizedX, normalizedY) {
	const { x, y } = baseMaskCell(normalizedX, normalizedY);
	const code = readBaseCode(WORLD_REFERENCE_BASE_SURFACE_MASK.rowsHex[y], x);
	const surface = BASE_SURFACE_BY_CODE[code];
	if (!surface) throw new RangeError(`unsupported reference surface code ${code}`);
	return surface;
}

/**
 * Composes route/bridge ownership over the immutable base mask.
 * A normal road can only cover dry land; water remains sea/lake unless the route point is a
 * validated bridge deck. This mirrors the standing canonical bridge-aware road policy.
 * @returns {'sea'|'lake'|'soil'|'road'|'rock'|'snow'}
 */
export function composeReferenceSurface(normalizedX, normalizedY, { road = false, bridgeDeck = false } = {}) {
	const base = classifyReferenceBaseSurface(normalizedX, normalizedY);
	if (bridgeDeck && road) return 'road';
	if (road && base !== 'sea' && base !== 'lake') return 'road';
	return base;
}

export function referencePindexFromNormalizedX(normalizedX) {
	const x = clampNormalized(normalizedX, 'normalizedX');
	return Math.min(10, Math.floor(x * 10) + 1);
}

export function referencePindexFromPixelX(pixelX) {
	if (!Number.isFinite(pixelX)) throw new TypeError('pixelX must be finite');
	if (pixelX < 0 || pixelX > WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelWidth) {
		throw new RangeError('pixelX outside canonical map bounds');
	}
	return referencePindexFromNormalizedX(pixelX / WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelWidth);
}

export function getReferencePindexSummary(index) {
	if (!Number.isInteger(index) || index < 1 || index > WORLD_REFERENCE_PINDEXES.length) {
		throw new RangeError('pindex must be an integer in [1,10]');
	}
	return WORLD_REFERENCE_PINDEXES[index - 1];
}

// Pindex Quality V2 — continuous sub-cell reconstruction over the immutable 96x64 source-derived mask.
// The raw mask and historical classifiers above remain intact. This layer removes nearest-cell
// stair-stepping without inventing source pixels and composes the repo's audited biome/relief data.
import { REFERENCE_BIOME_ZONES, REFERENCE_RELIEF_CHAINS, sampleReferenceInfluence } from './worldReferenceMap.js';

export const REFERENCE_PINDEX_QUALITY_V2_POLICY = Object.freeze({
	id: 'owner-map-pindex-quality-v2-2026-08-12-v1',
	sourceMapSha256: WORLD_REFERENCE_BASE_SURFACE_MASK.sourceMapSha256,
	maskSha256: WORLD_REFERENCE_BASE_SURFACE_MASK.maskSha256,
	pindexProfiles: Object.freeze([
		Object.freeze({ pindex: 1, microAmplitude: 0.034, biomeGain: 1.02, warpCells: 0.16 }),
		Object.freeze({ pindex: 2, microAmplitude: 0.042, biomeGain: 1.08, warpCells: 0.19 }),
		Object.freeze({ pindex: 3, microAmplitude: 0.038, biomeGain: 1.04, warpCells: 0.18 }),
		Object.freeze({ pindex: 4, microAmplitude: 0.030, biomeGain: 0.98, warpCells: 0.15 }),
		Object.freeze({ pindex: 5, microAmplitude: 0.030, biomeGain: 1.00, warpCells: 0.15 }),
		Object.freeze({ pindex: 6, microAmplitude: 0.032, biomeGain: 1.05, warpCells: 0.16 }),
		Object.freeze({ pindex: 7, microAmplitude: 0.040, biomeGain: 1.08, warpCells: 0.18 }),
		Object.freeze({ pindex: 8, microAmplitude: 0.044, biomeGain: 1.10, warpCells: 0.19 }),
		Object.freeze({ pindex: 9, microAmplitude: 0.036, biomeGain: 1.02, warpCells: 0.17 }),
		Object.freeze({ pindex: 10, microAmplitude: 0.040, biomeGain: 1.06, warpCells: 0.18 }),
	]),
});

const PINDEX_QUALITY_SURFACES = Object.freeze(['soil', 'rock', 'snow', 'sea', 'lake']);
const PINDEX_QUALITY_MASK_CODES = (() => {
	const { width, height, bitsPerCell, rowsHex } = WORLD_REFERENCE_BASE_SURFACE_MASK;
	const result = new Uint8Array(width * height);
	const totalBits = BigInt(width * bitsPerCell);
	const codeMask = (1n << BigInt(bitsPerCell)) - 1n;
	for (let y = 0; y < height; y += 1) {
		const bits = BigInt(`0x${rowsHex[y]}`);
		for (let x = 0; x < width; x += 1) {
			const shift = totalBits - BigInt((x + 1) * bitsPerCell);
			result[y * width + x] = Number((bits >> shift) & codeMask);
		}
	}
	return result;
})();

const PINDEX_QUALITY_BIOMES_BY_STRIP = Object.freeze(Array.from({ length: 10 }, (_, stripIndex) => {
	const minX = stripIndex / 10;
	const maxX = (stripIndex + 1) / 10;
	return Object.freeze(REFERENCE_BIOME_ZONES.filter((zone) => {
		const radiusX = zone.radius?.[0] ?? 0;
		return zone.center[0] + radiusX >= minX && zone.center[0] - radiusX <= maxX;
	}));
}));

function pindexQualitySmoothstep(edge0, edge1, value) {
	if (edge0 === edge1) return value >= edge1 ? 1 : 0;
	const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

function pindexQualityProfile(normalizedX) {
	const stripPosition = Math.min(0.999999999, Math.max(0, normalizedX)) * 10;
	const index0 = Math.min(9, Math.floor(stripPosition));
	const index1 = Math.min(9, index0 + 1);
	const t = pindexQualitySmoothstep(0, 1, stripPosition - index0);
	const a = REFERENCE_PINDEX_QUALITY_V2_POLICY.pindexProfiles[index0];
	const b = REFERENCE_PINDEX_QUALITY_V2_POLICY.pindexProfiles[index1];
	return Object.freeze({
		microAmplitude: a.microAmplitude + (b.microAmplitude - a.microAmplitude) * t,
		biomeGain: a.biomeGain + (b.biomeGain - a.biomeGain) * t,
		warpCells: a.warpCells + (b.warpCells - a.warpCells) * t,
	});
}

function pindexQualityMaskCode(x, y) {
	const width = WORLD_REFERENCE_BASE_SURFACE_MASK.width;
	const height = WORLD_REFERENCE_BASE_SURFACE_MASK.height;
	const clampedX = Math.min(width - 1, Math.max(0, x));
	const clampedY = Math.min(height - 1, Math.max(0, y));
	return PINDEX_QUALITY_MASK_CODES[clampedY * width + clampedX];
}

function pindexQualitySurfaceWeights(normalizedX, normalizedY, warpCells) {
	const width = WORLD_REFERENCE_BASE_SURFACE_MASK.width;
	const height = WORLD_REFERENCE_BASE_SURFACE_MASK.height;
	const warpX = (
		Math.sin(normalizedY * 51.17 + Math.sin(normalizedX * 29.31) * 0.9) * 0.62 +
		Math.sin(normalizedX * 19.43 - normalizedY * 37.73) * 0.38
	) * warpCells;
	const warpY = (
		Math.sin(normalizedX * 47.11 + Math.sin(normalizedY * 31.07) * 0.8) * 0.58 +
		Math.sin(normalizedY * 23.87 - normalizedX * 41.29) * 0.42
	) * warpCells;
	const fx = Math.min(1, Math.max(0, normalizedX)) * width - 0.5 + warpX;
	const fy = Math.min(1, Math.max(0, normalizedY)) * height - 0.5 + warpY;
	const x0 = Math.floor(fx);
	const y0 = Math.floor(fy);
	const tx = pindexQualitySmoothstep(0, 1, fx - x0);
	const ty = pindexQualitySmoothstep(0, 1, fy - y0);
	const weights = new Float32Array(PINDEX_QUALITY_SURFACES.length);
	const add = (x, y, weight) => { weights[pindexQualityMaskCode(x, y)] += weight; };
	add(x0, y0, (1 - tx) * (1 - ty));
	add(x0 + 1, y0, tx * (1 - ty));
	add(x0, y0 + 1, (1 - tx) * ty);
	add(x0 + 1, y0 + 1, tx * ty);
	return weights;
}

function pindexQualityBiomeSample(normalizedX, normalizedY, pindex, gain) {
	const zones = PINDEX_QUALITY_BIOMES_BY_STRIP[Math.max(0, Math.min(9, pindex - 1))];
	let totalWeight = 0;
	let strongestKind = null;
	let strongestWeight = 0;
	const kindWeights = {};
	for (const zone of zones) {
		const baseInfluence = sampleReferenceInfluence(normalizedX, normalizedY, zone);
		if (baseInfluence <= 0) continue;
		const influence = baseInfluence * gain;
		totalWeight += influence;
		kindWeights[zone.kind] = (kindWeights[zone.kind] ?? 0) + influence;
		if (influence > strongestWeight) {
			strongestWeight = influence;
			strongestKind = zone.kind;
		}
	}
	return Object.freeze({
		influence: Math.min(1, Math.max(0, totalWeight)),
		strongestKind,
		kindWeights: Object.freeze({ ...kindWeights }),
	});
}

function pindexQualityPointSegmentDistance(px, py, ax, ay, bx, by) {
	const abx = bx - ax;
	const aby = by - ay;
	const lengthSquared = abx * abx + aby * aby;
	if (lengthSquared <= 1e-12) return Math.hypot(px - ax, py - ay);
	const t = Math.min(1, Math.max(0, ((px - ax) * abx + (py - ay) * aby) / lengthSquared));
	return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/** Distances, in aspect-corrected normalized units, over which a ridge's influence falls to nothing. */
const RELIEF_INFLUENCE_INNER = 0.012;
const RELIEF_INFLUENCE_OUTER = 0.048;

/**
 * The relief chains, pre-scaled into the aspect-corrected space and each carrying the box a query
 * point must fall inside for the chain to be able to contribute anything at all (run 396).
 *
 * `pindexQualityReliefInfluence` measured as **the single most expensive function in the whole boot**:
 * a CPU profile of `createScene` on a mobile viewport put 3.08 s of 10.5 s — 29.6% — inside it, with
 * its module at 48.2% of the total. The reason is that it walked **all 98 segments of all 19 chains,
 * with a `Math.hypot` each**, for every sample, however far from any ridge the sample was.
 *
 * Skipping the ones that cannot matter is exact, not approximate, and that is the point: past
 * `RELIEF_INFLUENCE_OUTER` the smoothstep saturates and the term is `1 - 1`, i.e. **precisely zero**,
 * into a maximum that starts at zero. A chain's whole polyline lies inside its own bounding box, so a
 * point outside that box grown by `RELIEF_INFLUENCE_OUTER` is further than the falloff from every
 * segment in it. Dropping those contributes the same zero, so every returned value is bit-identical to
 * what the exhaustive loop produced — this buys speed without moving the ground by one micrometre,
 * which is the only kind of terrain change that needs no §8.4 re-verification.
 */
const RELIEF_CHAIN_INDEX = (() => {
	const aspect = WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelWidth / WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelHeight;
	const chains = REFERENCE_RELIEF_CHAINS.map((chain) => {
		const points = chain.points.map((point) => [point[0] * aspect, point[1]]);
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const [x, y] of points) {
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
		return Object.freeze({
			points: Object.freeze(points),
			minX: minX - RELIEF_INFLUENCE_OUTER,
			maxX: maxX + RELIEF_INFLUENCE_OUTER,
			minY: minY - RELIEF_INFLUENCE_OUTER,
			maxY: maxY + RELIEF_INFLUENCE_OUTER,
		});
	});
	return Object.freeze({ aspect, chains: Object.freeze(chains) });
})();

function pindexQualityReliefInfluence(normalizedX, normalizedY) {
	const px = normalizedX * RELIEF_CHAIN_INDEX.aspect;
	const py = normalizedY;
	let strongest = 0;
	for (const chain of RELIEF_CHAIN_INDEX.chains) {
		if (px < chain.minX || px > chain.maxX || py < chain.minY || py > chain.maxY) continue;
		const { points } = chain;
		for (let index = 0; index < points.length - 1; index += 1) {
			const a = points[index];
			const b = points[index + 1];
			const distance = pindexQualityPointSegmentDistance(px, py, a[0], a[1], b[0], b[1]);
			// Same exactness argument as the box test, applied per segment.
			if (distance >= RELIEF_INFLUENCE_OUTER) continue;
			strongest = Math.max(strongest, 1 - pindexQualitySmoothstep(RELIEF_INFLUENCE_INNER, RELIEF_INFLUENCE_OUTER, distance));
		}
	}
	return strongest;
}

/** High-fidelity continuous canonical sample; all weights are deterministic and source anchored. */
export function sampleReferencePindexQualityV2(normalizedX, normalizedY) {
	if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
	if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) throw new RangeError('normalized coordinates must be in [0,1]');
	const pindex = referencePindexFromNormalizedX(normalizedX);
	const profile = pindexQualityProfile(normalizedX);
	const weightsArray = pindexQualitySurfaceWeights(normalizedX, normalizedY, profile.warpCells);
	const surfaceWeights = Object.freeze(Object.fromEntries(PINDEX_QUALITY_SURFACES.map((surface, code) => [surface, weightsArray[code]])));
	const dominantSurface = PINDEX_QUALITY_SURFACES.reduce(
		(best, surface) => surfaceWeights[surface] > surfaceWeights[best] ? surface : best,
		'soil',
	);
	const biome = pindexQualityBiomeSample(normalizedX, normalizedY, pindex, profile.biomeGain);
	const maxSurfaceWeight = Math.max(...Object.values(surfaceWeights));
	return Object.freeze({
		policyId: REFERENCE_PINDEX_QUALITY_V2_POLICY.id,
		pindex,
		dominantSurface,
		surfaceWeights,
		boundaryBlend: 1 - maxSurfaceWeight,
		biomeInfluence: biome.influence,
		strongestBiomeKind: biome.strongestKind,
		biomeKindWeights: biome.kindWeights,
		reliefInfluence: pindexQualityReliefInfluence(normalizedX, normalizedY),
		microAmplitude: profile.microAmplitude,
	});
}
