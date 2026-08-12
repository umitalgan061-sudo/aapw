/**
 * Pattern painters for natural surfaces — rock, soil, vegetation, water and sky bodies.
 *
 * Every painter takes `(context, size, palette, seed)` and fills the canvas. They share a house
 * style: a per-pixel base pass built from `textureCore`'s noise (so the surface is never flat), then
 * vector detail drawn on top, then shading so crevices darken and raised detail catches light. That
 * order is what makes a 256px tile still read as a material rather than coloured mush.
 * @module materials/terrainPatterns
 */

import {
	createFbm,
	createRidgedFbm,
	createRandom,
	fillPixels,
	hexToRgb,
	mixRgb,
	rgbToCss,
} from './textureCore.js';

import { paintMottledBase } from './creaturePatterns.js';

/** Stone/rock: ridged fracture lines plus grain speckle. */
function paintStone(context, size, palette, seed) {
	const ridged = createRidgedFbm(seed, { octaves: 5, baseResolution: 3 });
	const fbm = createFbm(seed ^ 0x1234, { octaves: 4, baseResolution: 6 });
	const base = hexToRgb(palette.base);
	const dark = hexToRgb(palette.dark);
	const light = hexToRgb(palette.light);
	fillPixels(context, size, (x, y) => {
		const crack = Math.pow(ridged(x, y), 6);
		const grain = fbm(x, y);
		let color = mixRgb(mixRgb(base, dark, (1 - grain) * 0.45), light, grain * 0.35);
		return mixRgb(color, dark, crack * 0.8);
	});
	// Sparse lichen/moss in the crevices, which is what stops bare stone reading as concrete.
	const random = createRandom(seed ^ 0xa2b4);
	context.globalAlpha = 0.12;
	context.fillStyle = rgbToCss(hexToRgb(palette.accent));
	for (let i = 0; i < size / 4; i += 1) {
		context.beginPath();
		context.arc(random() * size, random() * size, random() * size * 0.03, 0, Math.PI * 2);
		context.fill();
	}
	context.globalAlpha = 1;
}

/** Granite: stone with a dense bright mineral fleck. */

/** Granite: stone with a dense bright mineral fleck. */
function paintSpeckledStone(context, size, palette, seed) {
	paintStone(context, size, palette, seed);
	const random = createRandom(seed ^ 0xbb17);
	for (let i = 0; i < size * 8; i += 1) {
		context.fillStyle = rgbToCss(random() < 0.5 ? hexToRgb(palette.accent) : hexToRgb(palette.dark));
		context.globalAlpha = 0.35 + random() * 0.4;
		context.fillRect(random() * size, random() * size, Math.max(1, size / 256), Math.max(1, size / 256));
	}
	context.globalAlpha = 1;
}

/** Marble: pale field with dark veining that branches rather than running straight. */

/** Marble: pale field with dark veining that branches rather than running straight. */
function paintMarble(context, size, palette, seed) {
	const fbm = createFbm(seed, { octaves: 5, baseResolution: 3 });
	const base = hexToRgb(palette.base);
	const light = hexToRgb(palette.light);
	fillPixels(context, size, (x, y) => mixRgb(base, light, fbm(x, y) * 0.7));
	const random = createRandom(seed ^ 0xcd41);
	const accent = hexToRgb(palette.accent);
	for (let vein = 0; vein < 6; vein += 1) {
		context.strokeStyle = rgbToCss(accent);
		context.globalAlpha = 0.16 + random() * 0.2;
		context.lineWidth = Math.max(0.8, size / 220) * (0.5 + random());
		let x = random() * size;
		let y = 0;
		context.beginPath();
		context.moveTo(x, y);
		while (y < size) {
			x += (random() - 0.5) * size * 0.18;
			y += size * 0.07;
			context.lineTo(x, y);
		}
		context.stroke();
	}
	context.globalAlpha = 1;
}

/** Grass: dense upright blades in three greens over soil. */

/** Grass: dense upright blades in three greens over soil. */
function paintGrass(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 4, baseResolution: 5, contrast: 0.5 });
	const random = createRandom(seed ^ 0x2f9c);
	const tones = [hexToRgb(palette.dark), hexToRgb(palette.base), hexToRgb(palette.light), hexToRgb(palette.accent)];
	context.lineWidth = Math.max(0.6, size / 300);
	for (let i = 0; i < size * 12; i += 1) {
		context.strokeStyle = rgbToCss(tones[Math.floor(random() * tones.length)]);
		context.globalAlpha = 0.35 + random() * 0.45;
		const x = random() * size;
		const y = random() * size;
		const height = size * (0.02 + random() * 0.045);
		const lean = (random() - 0.5) * size * 0.03;
		context.beginPath();
		context.moveTo(x, y);
		context.quadraticCurveTo(x + lean * 0.4, y - height * 0.6, x + lean, y - height);
		context.stroke();
	}
	context.globalAlpha = 1;
}

/** Moss: clumpy, high-frequency, low-contrast green. */

/** Moss: clumpy, high-frequency, low-contrast green. */
function paintMoss(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 5, baseResolution: 8, contrast: 0.6 });
	const random = createRandom(seed ^ 0x93a2);
	for (let i = 0; i < size * 6; i += 1) {
		context.fillStyle = rgbToCss(random() < 0.5 ? hexToRgb(palette.light) : hexToRgb(palette.accent));
		context.globalAlpha = 0.14 + random() * 0.2;
		context.beginPath();
		context.arc(random() * size, random() * size, size * (0.004 + random() * 0.012), 0, Math.PI * 2);
		context.fill();
	}
	context.globalAlpha = 1;
}

/** Dirt: clumped earth with small stones and dry cracks. */

/** Dirt: clumped earth with small stones and dry cracks. */
function paintDirt(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 5, baseResolution: 5, contrast: 0.6 });
	const random = createRandom(seed ^ 0x64de);
	for (let i = 0; i < size * 2; i += 1) {
		context.fillStyle = rgbToCss(random() < 0.5 ? hexToRgb(palette.light) : hexToRgb(palette.accent));
		context.globalAlpha = 0.25 + random() * 0.35;
		context.beginPath();
		context.arc(random() * size, random() * size, size * (0.003 + random() * 0.01), 0, Math.PI * 2);
		context.fill();
	}
	context.globalAlpha = 1;
}

/** Sand: fine grain plus shallow wind ripples. */

/** Sand: fine grain plus shallow wind ripples. */
function paintSand(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 3, baseResolution: 4, contrast: 0.3 });
	const random = createRandom(seed ^ 0x1ab7);
	context.strokeStyle = rgbToCss(hexToRgb(palette.dark));
	context.lineWidth = Math.max(0.6, size / 300);
	for (let ripple = 0; ripple < 22; ripple += 1) {
		context.globalAlpha = 0.1 + random() * 0.12;
		const y = (ripple / 22) * size + (random() - 0.5) * size * 0.02;
		context.beginPath();
		context.moveTo(0, y);
		for (let x = 0; x <= size; x += size / 12) {
			context.lineTo(x, y + Math.sin((x / size) * Math.PI * 4 + ripple) * size * 0.012);
		}
		context.stroke();
	}
	context.globalAlpha = 1;
}

/** Snow: near-white with a bluish shadow drift and sparkle. */

/** Snow: near-white with a bluish shadow drift and sparkle. */
function paintSnow(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 4, baseResolution: 3, contrast: 0.28 });
	const random = createRandom(seed ^ 0xef22);
	for (let i = 0; i < size * 2; i += 1) {
		context.fillStyle = '#ffffff';
		context.globalAlpha = 0.3 + random() * 0.5;
		context.fillRect(random() * size, random() * size, Math.max(1, size / 256), Math.max(1, size / 256));
	}
	context.globalAlpha = 1;
}

/** Ice: smooth field with angular internal fracture planes. */

/** Ice: smooth field with angular internal fracture planes. */
function paintIce(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 3, baseResolution: 2, contrast: 0.45 });
	const random = createRandom(seed ^ 0x77fe);
	context.lineWidth = Math.max(0.7, size / 240);
	for (let crack = 0; crack < 16; crack += 1) {
		context.strokeStyle = rgbToCss(random() < 0.5 ? hexToRgb(palette.light) : hexToRgb(palette.accent));
		context.globalAlpha = 0.18 + random() * 0.3;
		const x = random() * size;
		const y = random() * size;
		const angle = random() * Math.PI * 2;
		const length = size * (0.1 + random() * 0.3);
		context.beginPath();
		context.moveTo(x, y);
		context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
		context.stroke();
	}
	context.globalAlpha = 1;
}

/** Water: layered sine caustics — reads as moving water once lit. */

/** Water: layered sine caustics — reads as moving water once lit. */
function paintWater(context, size, palette, seed) {
	const fbm = createFbm(seed, { octaves: 4, baseResolution: 3 });
	const base = hexToRgb(palette.base);
	const dark = hexToRgb(palette.dark);
	const light = hexToRgb(palette.light);
	fillPixels(context, size, (x, y) => {
		const wave = (Math.sin((x * 9 + fbm(x, y) * 3) * Math.PI) + Math.sin((y * 7 - fbm(y, x) * 3) * Math.PI)) * 0.25 + 0.5;
		const depth = fbm(x * 0.5, y * 0.5);
		return mixRgb(mixRgb(dark, base, depth), light, Math.pow(wave, 3) * 0.55);
	});
	const random = createRandom(seed ^ 0x5b19);
	context.strokeStyle = rgbToCss(hexToRgb(palette.accent));
	context.lineWidth = Math.max(0.6, size / 300);
	for (let i = 0; i < 26; i += 1) {
		context.globalAlpha = 0.1 + random() * 0.14;
		const y = random() * size;
		context.beginPath();
		context.moveTo(0, y);
		for (let x = 0; x <= size; x += size / 16) context.lineTo(x, y + Math.sin(x / size * Math.PI * 6 + i) * size * 0.008);
		context.stroke();
	}
	context.globalAlpha = 1;
}

/** Bark: strong vertical furrows with cross-checking. */

/** Bark: strong vertical furrows with cross-checking. */
function paintBark(context, size, palette, seed) {
	const ridged = createRidgedFbm(seed, { octaves: 4, baseResolution: 2 });
	const base = hexToRgb(palette.base);
	const dark = hexToRgb(palette.dark);
	const light = hexToRgb(palette.light);
	fillPixels(context, size, (x, y) => {
		// Squashing x hard is what turns isotropic noise into vertical bark furrows.
		const furrow = ridged(x * 4, y * 0.35);
		const groove = Math.pow(furrow, 3);
		return mixRgb(mixRgb(base, light, furrow * 0.3), dark, groove * 0.85);
	});
	const random = createRandom(seed ^ 0x3ba8);
	context.strokeStyle = rgbToCss(dark);
	context.lineWidth = Math.max(0.7, size / 220);
	for (let i = 0; i < 26; i += 1) {
		context.globalAlpha = 0.2 + random() * 0.3;
		const x = random() * size;
		context.beginPath();
		context.moveTo(x, 0);
		for (let y = 0; y <= size; y += size / 10) context.lineTo(x + (random() - 0.5) * size * 0.03, y);
		context.stroke();
	}
	context.globalAlpha = 1;
}

/** Foliage: overlapping leaf shapes in several greens. */

/** Foliage: overlapping leaf shapes in several greens. */
function paintLeaf(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 4, baseResolution: 5, contrast: 0.5 });
	const random = createRandom(seed ^ 0x4d72);
	const tones = [hexToRgb(palette.dark), hexToRgb(palette.base), hexToRgb(palette.light), hexToRgb(palette.accent)];
	for (let i = 0; i < size * 1.5; i += 1) {
		const cx = random() * size;
		const cy = random() * size;
		const r = size * (0.015 + random() * 0.03);
		const angle = random() * Math.PI * 2;
		context.fillStyle = rgbToCss(tones[Math.floor(random() * tones.length)]);
		context.globalAlpha = 0.35 + random() * 0.4;
		context.beginPath();
		context.ellipse(cx, cy, r, r * 0.45, angle, 0, Math.PI * 2);
		context.fill();
	}
	context.globalAlpha = 1;
}

/** Draws a running-bond masonry/brick grid; shared by brick, castle block and cobble. */

/** Sun/star: radial hot core falling off to the rim. */
function paintSun(context, size, palette, seed) {
	const fbm = createFbm(seed, { octaves: 4, baseResolution: 5 });
	const base = hexToRgb(palette.base);
	const light = hexToRgb(palette.light);
	const accent = hexToRgb(palette.accent);
	fillPixels(context, size, (x, y) => {
		const dx = x - 0.5;
		const dy = y - 0.5;
		const radius = Math.sqrt(dx * dx + dy * dy) * 2;
		const turbulence = fbm(x, y) * 0.4;
		return mixRgb(mixRgb(light, base, Math.min(1, radius + turbulence)), accent, Math.pow(Math.min(1, radius), 3) * 0.7);
	});
}

/** Moon: pale disc with impact craters. */

/** Moon: pale disc with impact craters. */
function paintMoon(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 4, baseResolution: 4, contrast: 0.35 });
	const random = createRandom(seed ^ 0x6ae2);
	for (let crater = 0; crater < 34; crater += 1) {
		const cx = random() * size;
		const cy = random() * size;
		const r = size * (0.01 + random() * 0.055);
		context.fillStyle = rgbToCss(hexToRgb(palette.dark));
		context.globalAlpha = 0.3 + random() * 0.25;
		context.beginPath();
		context.arc(cx, cy, r, 0, Math.PI * 2);
		context.fill();
		// Offset bright rim = a lit crater lip, which is what makes craters read as concave.
		context.fillStyle = rgbToCss(hexToRgb(palette.light));
		context.globalAlpha = 0.22;
		context.beginPath();
		context.arc(cx - r * 0.18, cy - r * 0.18, r * 0.82, 0, Math.PI * 2);
		context.fill();
	}
	context.globalAlpha = 1;
}

/** Cloud: soft billows, no hard edges. */

/** Cloud: soft billows, no hard edges. */
function paintCloud(context, size, palette, seed) {
	paintMottledBase(context, size, palette, seed, { octaves: 5, baseResolution: 2, contrast: 0.45 });
}

/** Lava: dark crust broken by glowing fissures. */

/** Lava: dark crust broken by glowing fissures. */
function paintLava(context, size, palette, seed) {
	const ridged = createRidgedFbm(seed, { octaves: 4, baseResolution: 3 });
	const dark = hexToRgb(palette.dark);
	const base = hexToRgb(palette.base);
	const light = hexToRgb(palette.light);
	const accent = hexToRgb(palette.accent);
	fillPixels(context, size, (x, y) => {
		const fissure = Math.pow(ridged(x, y), 4);
		const crust = mixRgb(dark, base, 1 - fissure);
		return mixRgb(crust, mixRgb(light, accent, fissure), Math.pow(fissure, 1.5));
	});
}

/** Dirt road: compacted earth with wheel ruts and scattered gravel. */

/** Natural-surface painters, keyed by `palettes.js`'s `pattern` field. */
export const TERRAIN_PATTERNS = Object.freeze({
	stone: paintStone,
	'speckled-stone': paintSpeckledStone,
	marble: paintMarble,
	grass: paintGrass,
	moss: paintMoss,
	dirt: paintDirt,
	sand: paintSand,
	snow: paintSnow,
	ice: paintIce,
	water: paintWater,
	bark: paintBark,
	leaf: paintLeaf,
	sun: paintSun,
	moon: paintMoon,
	cloud: paintCloud,
	lava: paintLava,
});

/** Re-exported for `structurePatterns.js`'s dirt-road painter. */
export { paintDirt };
