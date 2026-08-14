/**
 * Pattern painters for built surfaces — masonry, timber, roofing, cloth, leather, metal and roads.
 *
 * Every painter takes `(context, size, palette, seed)` and fills the canvas. They share a house
 * style: a per-pixel base pass built from `textureCore`'s noise (so the surface is never flat), then
 * vector detail drawn on top, then shading so crevices darken and raised detail catches light. That
 * order is what makes a 256px tile still read as a material rather than coloured mush.
 * @module materials/structurePatterns
 */

import {
	createFbm,
	createRandom,
	fillPixels,
	hexToRgb,
	mixRgb,
	rgbToCss,
	shadeRgb,
} from './textureCore.js';

import { paintMottledBase } from './creaturePatterns.js';
import { paintDirt } from './terrainPatterns.js';

/** Draws a running-bond masonry/brick grid; shared by brick, castle block and cobble. */
function paintMasonry(context, size, palette, seed, { rows, jitter, mortarRatio, irregular }) {
	const mortar = hexToRgb(palette.dark);
	context.fillStyle = rgbToCss(mortar);
	context.fillRect(0, 0, size, size);
	const random = createRandom(seed ^ 0x8c4d);
	const rowHeight = size / rows;
	const mortarGap = rowHeight * mortarRatio;
	const base = hexToRgb(palette.base);
	const light = hexToRgb(palette.light);
	const dark = hexToRgb(palette.dark);
	for (let row = 0; row < rows; row += 1) {
		const offset = (row % 2) * rowHeight * 0.5;
		const columns = Math.max(2, Math.round(rows * (irregular ? 0.85 + random() * 0.4 : 1)));
		const columnWidth = size / columns;
		for (let column = -1; column <= columns; column += 1) {
			const x = column * columnWidth + offset + mortarGap * 0.5;
			const y = row * rowHeight + mortarGap * 0.5;
			const w = columnWidth - mortarGap;
			const h = rowHeight - mortarGap;
			const tone = mixRgb(base, random() < 0.5 ? light : dark, random() * jitter);
			context.fillStyle = rgbToCss(tone);
			context.fillRect(x, y, w, h);
			// Top-edge catchlight + bottom-edge occlusion give each block visible relief.
			context.fillStyle = rgbToCss(shadeRgb(tone, 1.18));
			context.fillRect(x, y, w, Math.max(1, h * 0.12));
			context.fillStyle = rgbToCss(shadeRgb(tone, 0.75));
			context.fillRect(x, y + h - Math.max(1, h * 0.12), w, Math.max(1, h * 0.12));
		}
	}
}

function paintBrick(context, size, palette, seed) {
	paintMasonry(context, size, palette, seed, { rows: 10, jitter: 0.5, mortarRatio: 0.14, irregular: false });
}

function paintCastleBlock(context, size, palette, seed) {
	paintMasonry(context, size, palette, seed, { rows: 6, jitter: 0.42, mortarRatio: 0.1, irregular: true });
	// Weathering wash so a castle wall does not look like fresh brickwork.
	const fbm = createFbm(seed ^ 0x991a, { octaves: 4, baseResolution: 3 });
	const accent = hexToRgb(palette.accent);
	const image = context.getImageData(0, 0, size, size);
	const { data } = image;
	for (let py = 0; py < size; py += 1) {
		for (let px = 0; px < size; px += 1) {
			const weather = Math.pow(fbm(px / size, py / size), 3) * 0.45;
			const offset = (py * size + px) * 4;
			data[offset] += (accent.r - data[offset]) * weather;
			data[offset + 1] += (accent.g - data[offset + 1]) * weather;
			data[offset + 2] += (accent.b - data[offset + 2]) * weather;
		}
	}
	context.putImageData(image, 0, 0);
}

function paintCobble(context, size, palette, seed) {
	const dark = hexToRgb(palette.dark);
	context.fillStyle = rgbToCss(dark);
	context.fillRect(0, 0, size, size);
	const random = createRandom(seed ^ 0x2d81);
	const cells = 9;
	const step = size / cells;
	for (let row = 0; row < cells; row += 1) {
		for (let column = 0; column < cells; column += 1) {
			const cx = column * step + step * 0.5 + (row % 2) * step * 0.5 + (random() - 0.5) * step * 0.15;
			const cy = row * step + step * 0.5 + (random() - 0.5) * step * 0.15;
			const tone = mixRgb(hexToRgb(palette.base), random() < 0.5 ? hexToRgb(palette.light) : dark, random() * 0.55);
			context.fillStyle = rgbToCss(tone);
			context.beginPath();
			context.ellipse(cx, cy, step * (0.36 + random() * 0.1), step * (0.3 + random() * 0.1), random() * Math.PI, 0, Math.PI * 2);
			context.fill();
		}
	}
}

/** Timber: long grain lines plus occasional knots. */

/** Timber: long grain lines plus occasional knots. */
function paintWood(context, size, palette, seed) {
	const fbm = createFbm(seed, { octaves: 4, baseResolution: 3 });
	const base = hexToRgb(palette.base);
	const dark = hexToRgb(palette.dark);
	const light = hexToRgb(palette.light);
	fillPixels(context, size, (x, y) => {
		const grain = Math.sin((y * 22 + fbm(x, y) * 6) * Math.PI) * 0.5 + 0.5;
		return mixRgb(mixRgb(base, dark, grain * 0.45), light, (1 - grain) * 0.28);
	});
	const random = createRandom(seed ^ 0x6c3f);
	for (let knot = 0; knot < 3; knot += 1) {
		const cx = random() * size;
		const cy = random() * size;
		for (let ring = 6; ring > 0; ring -= 1) {
			context.strokeStyle = rgbToCss(ring % 2 ? hexToRgb(palette.dark) : hexToRgb(palette.base));
			context.globalAlpha = 0.35;
			context.lineWidth = Math.max(0.8, size / 220);
			context.beginPath();
			context.ellipse(cx, cy, ring * size * 0.008, ring * size * 0.014, 0, 0, Math.PI * 2);
			context.stroke();
		}
	}
	context.globalAlpha = 1;
}

/** Roof tiles: overlapping half-round courses. */

/** Roof tiles: overlapping half-round courses. */
function paintRoofTile(context, size, palette, seed) {
	const dark = hexToRgb(palette.dark);
	context.fillStyle = rgbToCss(dark);
	context.fillRect(0, 0, size, size);
	const random = createRandom(seed ^ 0x7a4e);
	const rows = 8;
	const rowHeight = size / rows;
	for (let row = 0; row < rows; row += 1) {
		for (let column = -1; column < 9; column += 1) {
			const cx = column * (size / 8) + (row % 2) * (size / 16);
			const cy = row * rowHeight;
			const tone = mixRgb(hexToRgb(palette.base), random() < 0.5 ? hexToRgb(palette.light) : dark, random() * 0.45);
			context.fillStyle = rgbToCss(tone);
			context.beginPath();
			context.moveTo(cx, cy + rowHeight);
			context.quadraticCurveTo(cx + size / 16, cy - rowHeight * 0.35, cx + size / 8, cy + rowHeight);
			context.closePath();
			context.fill();
		}
	}
}

/** Thatch: dense diagonal straw strokes. */

/** Thatch: dense diagonal straw strokes. */
function paintThatch(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 3, contrast: 0.45 });
	const random = createRandom(seed ^ 0x51b3);
	context.lineWidth = Math.max(0.7, size / 260);
	for (let i = 0; i < size * 10; i += 1) {
		context.strokeStyle = rgbToCss(random() < 0.4 ? hexToRgb(palette.dark) : hexToRgb(palette.light));
		context.globalAlpha = 0.25 + random() * 0.35;
		const x = random() * size;
		const y = random() * size;
		const length = size * (0.05 + random() * 0.1);
		context.beginPath();
		context.moveTo(x, y);
		context.lineTo(x + (random() - 0.5) * size * 0.04, y + length);
		context.stroke();
	}
	context.globalAlpha = 1;
}

/** Plaster/render: soft matte wall with faint trowel texture. */

/** Plaster/render: soft matte wall with faint trowel texture. */
function paintPlaster(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 4, baseResolution: 3, contrast: 0.25 });
	const random = createRandom(seed ^ 0x40cd);
	context.globalAlpha = 0.08;
	for (let i = 0; i < size * 2; i += 1) {
		context.strokeStyle = rgbToCss(hexToRgb(palette.dark));
		context.lineWidth = Math.max(0.5, size / 300);
		const x = random() * size;
		const y = random() * size;
		context.beginPath();
		context.moveTo(x, y);
		context.lineTo(x + (random() - 0.5) * size * 0.1, y + (random() - 0.5) * size * 0.04);
		context.stroke();
	}
	context.globalAlpha = 1;
}

/** Woven cloth: visible warp/weft grid. */

/** Woven cloth: visible warp/weft grid. */
function paintFabric(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 3, contrast: 0.22 });
	const random = createRandom(seed ^ 0x9d5c);
	const step = Math.max(2, size / 64);
	context.lineWidth = Math.max(0.5, step * 0.4);
	for (let i = 0; i * step < size; i += 1) {
		context.globalAlpha = 0.1 + random() * 0.12;
		context.strokeStyle = rgbToCss(i % 2 ? hexToRgb(palette.light) : hexToRgb(palette.dark));
		context.beginPath();
		context.moveTo(i * step, 0);
		context.lineTo(i * step, size);
		context.moveTo(0, i * step);
		context.lineTo(size, i * step);
		context.stroke();
	}
	context.globalAlpha = 1;
}

/** Leather: pebbled grain with worn creases. */

/** Leather: pebbled grain with worn creases. */
function paintLeather(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 5, baseResolution: 8, contrast: 0.35 });
	const random = createRandom(seed ^ 0x2e6a);
	for (let i = 0; i < size * 5; i += 1) {
		context.fillStyle = rgbToCss(random() < 0.5 ? hexToRgb(palette.dark) : hexToRgb(palette.light));
		context.globalAlpha = 0.1 + random() * 0.14;
		context.beginPath();
		context.arc(random() * size, random() * size, size * (0.004 + random() * 0.008), 0, Math.PI * 2);
		context.fill();
	}
	context.globalAlpha = 1;
}

/** Metal: brushed anisotropic streaks plus sparse nicks. */

/** Metal: brushed anisotropic streaks plus sparse nicks. */
function paintMetal(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 3, baseResolution: 2, contrast: 0.3 });
	const random = createRandom(seed ^ 0x1f8b);
	context.lineWidth = Math.max(0.5, size / 400);
	for (let i = 0; i < size * 6; i += 1) {
		context.strokeStyle = rgbToCss(random() < 0.5 ? hexToRgb(palette.light) : hexToRgb(palette.dark));
		context.globalAlpha = 0.08 + random() * 0.14;
		const y = random() * size;
		context.beginPath();
		context.moveTo(0, y);
		context.lineTo(size, y + (random() - 0.5) * size * 0.02);
		context.stroke();
	}
	// A few deeper scratches so the surface reads as used rather than showroom-new.
	for (let i = 0; i < 10; i += 1) {
		context.strokeStyle = rgbToCss(hexToRgb(palette.dark));
		context.globalAlpha = 0.25;
		context.lineWidth = Math.max(0.8, size / 260);
		const x = random() * size;
		const y = random() * size;
		context.beginPath();
		context.moveTo(x, y);
		context.lineTo(x + (random() - 0.5) * size * 0.25, y + (random() - 0.5) * size * 0.08);
		context.stroke();
	}
	context.globalAlpha = 1;
}

/** Sun/star: radial hot core falling off to the rim. */

/** Dirt road: compacted earth with wheel ruts and scattered gravel. */
function paintRoadDirt(context, size, palette, seed) {
	paintDirt(context, size, palette, seed);
	const random = createRandom(seed ^ 0xb3d7);
	context.strokeStyle = rgbToCss(hexToRgb(palette.dark));
	context.lineWidth = size * 0.06;
	for (const rutX of [size * 0.3, size * 0.7]) {
		context.globalAlpha = 0.22;
		context.beginPath();
		context.moveTo(rutX, 0);
		for (let y = 0; y <= size; y += size / 8) context.lineTo(rutX + (random() - 0.5) * size * 0.03, y);
		context.stroke();
	}
	context.globalAlpha = 1;
}

/** Built-surface painters, keyed by `palettes.js`'s `pattern` field. */
export const STRUCTURE_PATTERNS = Object.freeze({
	brick: paintBrick,
	'castle-block': paintCastleBlock,
	cobble: paintCobble,
	wood: paintWood,
	'roof-tile': paintRoofTile,
	thatch: paintThatch,
	plaster: paintPlaster,
	fabric: paintFabric,
	leather: paintLeather,
	metal: paintMetal,
	'road-dirt': paintRoadDirt,
});
