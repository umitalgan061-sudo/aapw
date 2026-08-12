/**
 * Pattern painters for living things — skin, fur, wool, hides, feathers and scales.
 *
 * Every painter takes `(context, size, palette, seed)` and fills the canvas. They share a house
 * style: a per-pixel base pass built from `textureCore`'s noise (so the surface is never flat), then
 * vector detail drawn on top, then shading so crevices darken and raised detail catches light. That
 * order is what makes a 256px tile still read as a material rather than coloured mush.
 * @module materials/creaturePatterns
 */

import {
	createFbm,
	createRandom,
	fillPixels,
	hexToRgb,
	mixRgb,
	rgbToCss,
} from './textureCore.js';

/**
 * Shared base pass: mottled blend between `dark` and `light` around `base`, driven by FBM. Most
 * painters start here and then draw their own structure over it.
 * @param {CanvasRenderingContext2D} context
 * @param {number} size
 * @param {import('./palettes.js').Palette} palette
 * @param {number} seed
 * @param {object} [options]
 * @param {number} [options.octaves]
 * @param {number} [options.baseResolution]
 * @param {number} [options.contrast] 0 = flat base colour, 1 = full dark..light swing.
 */
function paintMottledBase(context, size, palette, seed, { octaves = 4, baseResolution = 4, contrast = 0.55 } = {}) {
	const fbm = createFbm(seed, { octaves, baseResolution });
	const base = hexToRgb(palette.base);
	const dark = hexToRgb(palette.dark);
	const light = hexToRgb(palette.light);
	fillPixels(context, size, (x, y) => {
		const n = fbm(x, y);
		const toward = n < 0.5
			? mixRgb(base, dark, (0.5 - n) * 2 * contrast)
			: mixRgb(base, light, (n - 0.5) * 2 * contrast);
		return toward;
	});
}

/** Skin/hide: soft mottling plus faint pore speckle — no hard edges anywhere. */

/** Skin/hide: soft mottling plus faint pore speckle — no hard edges anywhere. */
function paintSkin(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 3, baseResolution: 3, contrast: 0.32 });
	const random = createRandom(seed ^ 0x51ed);
	const dark = hexToRgb(palette.dark);
	context.globalAlpha = 0.08;
	for (let i = 0; i < size * 3; i += 1) {
		context.fillStyle = rgbToCss(dark);
		context.beginPath();
		context.arc(random() * size, random() * size, random() * 1.2 + 0.3, 0, Math.PI * 2);
		context.fill();
	}
	context.globalAlpha = 1;
}

/** Fur/hair: dense directional strokes, slightly curved, in three tonal layers for depth. */

/** Fur/hair: dense directional strokes, slightly curved, in three tonal layers for depth. */
function paintFur(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 3, contrast: 0.4 });
	const random = createRandom(seed ^ 0x9a3f);
	const tones = [hexToRgb(palette.dark), hexToRgb(palette.base), hexToRgb(palette.light)];
	context.lineWidth = Math.max(0.6, size / 320);
	for (let i = 0; i < size * 14; i += 1) {
		const tone = tones[Math.floor(random() * tones.length)];
		context.strokeStyle = rgbToCss(tone);
		context.globalAlpha = 0.22 + random() * 0.3;
		const x = random() * size;
		const y = random() * size;
		const length = size * (0.02 + random() * 0.05);
		const angle = -Math.PI / 2 + (random() - 0.5) * 0.9;
		context.beginPath();
		context.moveTo(x, y);
		context.quadraticCurveTo(
			x + Math.cos(angle) * length * 0.5 + (random() - 0.5) * 2,
			y + Math.sin(angle) * length * 0.5,
			x + Math.cos(angle) * length,
			y + Math.sin(angle) * length,
		);
		context.stroke();
	}
	context.globalAlpha = 1;
}

/** Wool: tight overlapping curls rather than straight strokes. */

/** Wool: tight overlapping curls rather than straight strokes. */
function paintWool(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 3, contrast: 0.3 });
	const random = createRandom(seed ^ 0x77c1);
	context.lineWidth = Math.max(0.8, size / 200);
	for (let i = 0; i < size * 4; i += 1) {
		context.strokeStyle = rgbToCss(random() < 0.5 ? hexToRgb(palette.dark) : hexToRgb(palette.light));
		context.globalAlpha = 0.18 + random() * 0.22;
		context.beginPath();
		context.arc(random() * size, random() * size, size * (0.008 + random() * 0.02), 0, Math.PI * (1 + random()));
		context.stroke();
	}
	context.globalAlpha = 1;
}

/** Tabby cat: fur base plus soft vertical stripe bands. */

/** Tabby cat: fur base plus soft vertical stripe bands. */
function paintTabbyFur(context, size, palette, seed) {
	paintFur(context, size, palette, seed);
	const random = createRandom(seed ^ 0x2b8d);
	const accent = hexToRgb(palette.accent);
	context.globalAlpha = 0.3;
	context.fillStyle = rgbToCss(accent);
	for (let stripe = 0; stripe < 9; stripe += 1) {
		const x = (stripe / 9) * size + (random() - 0.5) * size * 0.05;
		const width = size * (0.02 + random() * 0.035);
		context.beginPath();
		context.moveTo(x, 0);
		context.quadraticCurveTo(x + size * 0.06, size * 0.5, x, size);
		context.lineTo(x + width, size);
		context.quadraticCurveTo(x + width + size * 0.06, size * 0.5, x + width, 0);
		context.closePath();
		context.fill();
	}
	context.globalAlpha = 1;
}

/** Giraffe: the signature irregular polygonal patches separated by pale channels. */

/** Giraffe: the signature irregular polygonal patches separated by pale channels. */
function paintGiraffePatches(context, size, palette, seed) {
	const light = hexToRgb(palette.light);
	context.fillStyle = rgbToCss(light);
	context.fillRect(0, 0, size, size);
	const random = createRandom(seed ^ 0x6f2a);
	const base = hexToRgb(palette.base);
	const dark = hexToRgb(palette.dark);
	const cells = 6;
	for (let cy = 0; cy < cells; cy += 1) {
		for (let cx = 0; cx < cells; cx += 1) {
			const centerX = ((cx + 0.5 + (random() - 0.5) * 0.4) / cells) * size;
			const centerY = ((cy + 0.5 + (random() - 0.5) * 0.4) / cells) * size;
			const radius = (size / cells) * (0.34 + random() * 0.12);
			context.fillStyle = rgbToCss(mixRgb(base, dark, random() * 0.5));
			context.beginPath();
			const corners = 5 + Math.floor(random() * 3);
			for (let corner = 0; corner <= corners; corner += 1) {
				const angle = (corner / corners) * Math.PI * 2;
				const r = radius * (0.78 + random() * 0.35);
				const px = centerX + Math.cos(angle) * r;
				const py = centerY + Math.sin(angle) * r;
				if (corner === 0) context.moveTo(px, py); else context.lineTo(px, py);
			}
			context.closePath();
			context.fill();
		}
	}
}

/** Cow: large soft-edged blotches over a pale hide. */

/** Cow: large soft-edged blotches over a pale hide. */
function paintCowPatches(context, size, palette, seed) {
	const base = hexToRgb(palette.base);
	context.fillStyle = rgbToCss(base);
	context.fillRect(0, 0, size, size);
	const random = createRandom(seed ^ 0x41bd);
	context.fillStyle = rgbToCss(hexToRgb(palette.accent));
	for (let blob = 0; blob < 7; blob += 1) {
		const centerX = random() * size;
		const centerY = random() * size;
		context.beginPath();
		const corners = 10;
		for (let corner = 0; corner <= corners; corner += 1) {
			const angle = (corner / corners) * Math.PI * 2;
			const r = size * (0.06 + random() * 0.09);
			const px = centerX + Math.cos(angle) * r;
			const py = centerY + Math.sin(angle) * r * 0.75;
			if (corner === 0) context.moveTo(px, py); else context.lineTo(px, py);
		}
		context.closePath();
		context.fill();
	}
}

/** Elephant hide: deep criss-crossing wrinkles over dull grey. */

/** Elephant hide: deep criss-crossing wrinkles over dull grey. */
function paintWrinkledHide(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 4, contrast: 0.35 });
	const random = createRandom(seed ^ 0x8ee3);
	const dark = hexToRgb(palette.dark);
	context.lineWidth = Math.max(0.7, size / 256);
	for (let i = 0; i < size * 1.6; i += 1) {
		context.strokeStyle = rgbToCss(dark);
		context.globalAlpha = 0.16 + random() * 0.2;
		const x = random() * size;
		const y = random() * size;
		const length = size * (0.06 + random() * 0.18);
		const angle = random() * Math.PI;
		context.beginPath();
		context.moveTo(x, y);
		context.quadraticCurveTo(
			x + Math.cos(angle) * length * 0.5 + (random() - 0.5) * size * 0.05,
			y + Math.sin(angle) * length * 0.5 + (random() - 0.5) * size * 0.05,
			x + Math.cos(angle) * length,
			y + Math.sin(angle) * length,
		);
		context.stroke();
	}
	context.globalAlpha = 1;
}

/** Feathers: overlapping rounded barbs in staggered rows. */

/** Feathers: overlapping rounded barbs in staggered rows. */
function paintFeather(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 3, contrast: 0.35 });
	const random = createRandom(seed ^ 0x3c77);
	const rows = 14;
	const rowHeight = size / rows;
	for (let row = 0; row < rows; row += 1) {
		const offset = (row % 2) * rowHeight * 0.5;
		for (let column = 0; column < rows; column += 1) {
			const cx = column * rowHeight + offset;
			const cy = row * rowHeight;
			context.fillStyle = rgbToCss(mixRgb(hexToRgb(palette.base), hexToRgb(random() < 0.35 ? palette.light : palette.dark), random() * 0.55));
			context.globalAlpha = 0.55;
			context.beginPath();
			context.ellipse(cx, cy, rowHeight * 0.62, rowHeight * 0.9, 0, 0, Math.PI * 2);
			context.fill();
		}
	}
	context.globalAlpha = 1;
}

/** Fish/snake scales: small tight diamond rows with a specular edge. */

/** Fish/snake scales: small tight diamond rows with a specular edge. */
function paintFishScales(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 3, contrast: 0.4 });
	const random = createRandom(seed ^ 0x5da9);
	const rows = 22;
	const step = size / rows;
	context.lineWidth = Math.max(0.5, size / 400);
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < rows; column += 1) {
			const cx = column * step + (row % 2) * step * 0.5;
			const cy = row * step;
			context.fillStyle = rgbToCss(mixRgb(hexToRgb(palette.base), hexToRgb(palette.light), random() * 0.5));
			context.globalAlpha = 0.5;
			context.beginPath();
			context.moveTo(cx, cy - step * 0.55);
			context.lineTo(cx + step * 0.5, cy);
			context.lineTo(cx, cy + step * 0.55);
			context.lineTo(cx - step * 0.5, cy);
			context.closePath();
			context.fill();
			context.globalAlpha = 0.35;
			context.strokeStyle = rgbToCss(hexToRgb(palette.dark));
			context.stroke();
		}
	}
	context.globalAlpha = 1;
}

/** Dragon wing membrane: translucent-looking leather with radial vein structure. */

/** Dragon wing membrane: translucent-looking leather with radial vein structure. */
function paintMembrane(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 4, contrast: 0.45 });
	const random = createRandom(seed ^ 0x7f31);
	const dark = hexToRgb(palette.dark);
	const accent = hexToRgb(palette.accent);
	// Main veins fan from one corner, the way a bat/dragon wing's fingers actually radiate.
	for (let vein = 0; vein < 7; vein += 1) {
		context.strokeStyle = rgbToCss(mixRgb(dark, accent, random() * 0.5));
		context.lineWidth = Math.max(1, size / 90) * (1 - vein / 12);
		context.globalAlpha = 0.5;
		const angle = (vein / 7) * (Math.PI / 2) + 0.06;
		context.beginPath();
		context.moveTo(0, 0);
		context.quadraticCurveTo(size * 0.4 * Math.cos(angle - 0.2), size * 0.4 * Math.sin(angle + 0.2), size * Math.cos(angle) * 1.4, size * Math.sin(angle) * 1.4);
		context.stroke();
		// Capillaries branching off each main vein.
		for (let branch = 0; branch < 5; branch += 1) {
			const t = 0.25 + branch * 0.16;
			context.lineWidth = Math.max(0.4, size / 300);
			context.globalAlpha = 0.3;
			context.beginPath();
			context.moveTo(size * Math.cos(angle) * 1.4 * t, size * Math.sin(angle) * 1.4 * t);
			context.lineTo(
				size * Math.cos(angle) * 1.4 * t + (random() - 0.5) * size * 0.22,
				size * Math.sin(angle) * 1.4 * t + (random() - 0.5) * size * 0.22,
			);
			context.stroke();
		}
	}
	context.globalAlpha = 1;
}

/** Stone/rock: ridged fracture lines plus grain speckle. */

/** Living-surface painters, keyed by `palettes.js`'s `pattern` field. */
export const CREATURE_PATTERNS = Object.freeze({
	skin: paintSkin,
	fur: paintFur,
	wool: paintWool,
	'tabby-fur': paintTabbyFur,
	'giraffe-patches': paintGiraffePatches,
	'cow-patches': paintCowPatches,
	'wrinkled-hide': paintWrinkledHide,
	feather: paintFeather,
	'fish-scales': paintFishScales,
	membrane: paintMembrane,
});

/** Re-exported because the terrain/structure painters build on the same mottled base pass. */
export { paintMottledBase };
