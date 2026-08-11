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
