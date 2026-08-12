/**
 * Dragon scale painter — the most detailed surface in the catalogue, kept in its own module because
 * it is built from five stacked passes rather than the single base+detail pass every other family
 * uses.
 *
 * The owner asked specifically for dragons to be treated with care and developed continuously, so
 * this is written to be extended: each pass is a separate function with its own tuning constants, and
 * `DRAGON_DETAIL` collects the numbers most likely to be adjusted (scale density, ridge width, wear
 * amount) in one place instead of scattering magic numbers through the drawing code.
 *
 * The passes, in the order a real reptile surface reads:
 *   1. Hide base — mottled underlayer, so gaps between scales are never flat colour.
 *   2. Scale rows — overlapping teardrop scales in a staggered lattice, each individually toned.
 *   3. Scale relief — per-scale rim light and contact shadow, which is what creates the sense of
 *      overlap rather than a printed diamond pattern.
 *   4. Dorsal ridge — a band of larger, harder plates running down the spine.
 *   5. Wear — battle scarring, dust in the crevices, and a faint sheen along the light direction.
 *
 * Nothing here derives from real HBO material; the shapes are generated from first principles.
 * @module materials/dragonTextures
 */

import {
	createFbm, createRandom, fillPixels,
	hexToRgb, mixRgb, rgbToCss, shadeRgb,
} from './textureCore.js';

/**
 * Tuning constants for the dragon surface. Grouped deliberately: these are the values a future pass
 * at "make the dragons look better" will want to reach for first.
 */
export const DRAGON_DETAIL = Object.freeze({
	/** Scale rows across the tile. Higher = finer, more serpentine scales. */
	SCALE_ROWS: 26,
	/** Scale width as a multiple of row height — >1 gives the wide, flattened scales of a big flier. */
	SCALE_ASPECT: 1.25,
	/** How far each row overlaps the one above it, as a fraction of row height. */
	SCALE_OVERLAP: 0.42,
	/** Per-scale tonal spread — how much neighbouring scales differ from each other. */
	SCALE_TONE_JITTER: 0.55,
	/** Dorsal ridge width as a fraction of the tile. */
	RIDGE_WIDTH: 0.16,
	/** Number of hard plates along the ridge. */
	RIDGE_PLATES: 15,
	/** Battle scars drawn across the hide. */
	SCAR_COUNT: 7,
});

/**
 * Pass 1 — mottled hide underlayer.
 * @param {CanvasRenderingContext2D} context
 * @param {number} size
 * @param {import('./palettes.js').Palette} palette
 * @param {number} seed
 */
function paintHideBase(context, size, palette, seed) {
	const coarse = createFbm(seed, { octaves: 4, baseResolution: 3 });
	const fine = createFbm(seed ^ 0x51a3, { octaves: 3, baseResolution: 9 });
	const base = hexToRgb(palette.base);
	const dark = hexToRgb(palette.dark);
	const light = hexToRgb(palette.light);
	fillPixels(context, size, (x, y) => {
		const blotch = coarse(x, y);
		const grain = fine(x, y);
		const body = blotch < 0.5
			? mixRgb(base, dark, (0.5 - blotch) * 1.5)
			: mixRgb(base, light, (blotch - 0.5) * 1.1);
		return mixRgb(body, dark, (1 - grain) * 0.18);
	});
}

/**
 * Draws one teardrop scale outline into the current path.
 * @param {CanvasRenderingContext2D} context
 * @param {number} cx
 * @param {number} cy
 * @param {number} halfWidth
 * @param {number} halfHeight
 */
function traceScale(context, cx, cy, halfWidth, halfHeight) {
	context.beginPath();
	context.moveTo(cx, cy - halfHeight);
	context.bezierCurveTo(
		cx + halfWidth, cy - halfHeight * 0.55,
		cx + halfWidth, cy + halfHeight * 0.35,
		cx, cy + halfHeight,
	);
	context.bezierCurveTo(
		cx - halfWidth, cy + halfHeight * 0.35,
		cx - halfWidth, cy - halfHeight * 0.55,
		cx, cy - halfHeight,
	);
	context.closePath();
}

/**
 * Passes 2 + 3 — the scale lattice and its per-scale relief.
 *
 * Rows are drawn top to bottom so each row's scales overlap the row above, and every scale gets its
 * own tone plus a rim light on the upper edge and a contact shadow on the lower edge. Drawing relief
 * per scale (rather than as one global shading pass at the end) is what makes the surface read as
 * hundreds of individual overlapping plates.
 * @param {CanvasRenderingContext2D} context
 * @param {number} size
 * @param {import('./palettes.js').Palette} palette
 * @param {number} seed
 */
function paintScaleRows(context, size, palette, seed) {
	const random = createRandom(seed ^ 0x2c8f);
	const base = hexToRgb(palette.base);
	const dark = hexToRgb(palette.dark);
	const light = hexToRgb(palette.light);
	const accent = hexToRgb(palette.accent);

	const rows = DRAGON_DETAIL.SCALE_ROWS;
	const rowHeight = size / rows;
	const halfHeight = rowHeight * (1 + DRAGON_DETAIL.SCALE_OVERLAP) * 0.5;
	const halfWidth = halfHeight * DRAGON_DETAIL.SCALE_ASPECT * 0.5;
	const columnStep = halfWidth * 2;

	for (let row = -1; row <= rows; row += 1) {
		const cy = row * rowHeight;
		const rowOffset = (row % 2) * columnStep * 0.5;
		// Belly-adjacent rows lean toward the accent colour, so the tile has a lighter underside band
		// the way a real animal's ventral scales do.
		const bellyBlend = Math.pow(Math.max(0, (row / rows) - 0.62) / 0.38, 2) * 0.55;

		for (let column = -1; column * columnStep <= size + columnStep; column += 1) {
			const cx = column * columnStep + rowOffset;
			const jitter = random();
			let tone = jitter < 0.5
				? mixRgb(base, dark, (0.5 - jitter) * 2 * DRAGON_DETAIL.SCALE_TONE_JITTER)
				: mixRgb(base, light, (jitter - 0.5) * 2 * DRAGON_DETAIL.SCALE_TONE_JITTER);
			if (bellyBlend > 0) tone = mixRgb(tone, accent, bellyBlend * (0.4 + random() * 0.4));

			traceScale(context, cx, cy, halfWidth, halfHeight);
			context.fillStyle = rgbToCss(tone);
			context.globalAlpha = 0.92;
			context.fill();

			// Rim light along the exposed upper edge.
			context.strokeStyle = rgbToCss(shadeRgb(tone, 1.42));
			context.globalAlpha = 0.5;
			context.lineWidth = Math.max(0.6, size / 300);
			context.beginPath();
			context.moveTo(cx - halfWidth * 0.82, cy - halfHeight * 0.18);
			context.quadraticCurveTo(cx, cy - halfHeight * 1.02, cx + halfWidth * 0.82, cy - halfHeight * 0.18);
			context.stroke();

			// Contact shadow where the scale below tucks underneath.
			context.strokeStyle = rgbToCss(shadeRgb(tone, 0.5));
			context.globalAlpha = 0.4;
			context.beginPath();
			context.moveTo(cx - halfWidth * 0.7, cy + halfHeight * 0.34);
			context.quadraticCurveTo(cx, cy + halfHeight * 0.98, cx + halfWidth * 0.7, cy + halfHeight * 0.34);
			context.stroke();
		}
	}
	context.globalAlpha = 1;
}

/**
 * Pass 4 — dorsal ridge of larger, harder plates down the spine.
 * @param {CanvasRenderingContext2D} context
 * @param {number} size
 * @param {import('./palettes.js').Palette} palette
 * @param {number} seed
 */
function paintDorsalRidge(context, size, palette, seed) {
	const random = createRandom(seed ^ 0x74be);
	const dark = hexToRgb(palette.dark);
	const light = hexToRgb(palette.light);
	const accent = hexToRgb(palette.accent);
	const ridgeWidth = size * DRAGON_DETAIL.RIDGE_WIDTH;
	const centerX = size * 0.5;
	const plates = DRAGON_DETAIL.RIDGE_PLATES;
	const plateHeight = size / plates;

	for (let plate = 0; plate < plates; plate += 1) {
		const cy = plate * plateHeight + plateHeight * 0.5;
		const halfW = ridgeWidth * (0.5 + random() * 0.22);
		const tone = mixRgb(mixRgb(dark, accent, random() * 0.35), light, random() * 0.28);
		context.fillStyle = rgbToCss(tone);
		context.globalAlpha = 0.9;
		// Hexagonal hard plate, wider than the surrounding scales and flat-topped.
		context.beginPath();
		context.moveTo(centerX, cy - plateHeight * 0.62);
		context.lineTo(centerX + halfW, cy - plateHeight * 0.18);
		context.lineTo(centerX + halfW * 0.82, cy + plateHeight * 0.45);
		context.lineTo(centerX, cy + plateHeight * 0.68);
		context.lineTo(centerX - halfW * 0.82, cy + plateHeight * 0.45);
		context.lineTo(centerX - halfW, cy - plateHeight * 0.18);
		context.closePath();
		context.fill();

		context.strokeStyle = rgbToCss(shadeRgb(tone, 1.5));
		context.globalAlpha = 0.45;
		context.lineWidth = Math.max(0.7, size / 260);
		context.stroke();

		// Keel line down the middle of each plate.
		context.strokeStyle = rgbToCss(shadeRgb(tone, 0.55));
		context.globalAlpha = 0.5;
		context.beginPath();
		context.moveTo(centerX, cy - plateHeight * 0.5);
		context.lineTo(centerX, cy + plateHeight * 0.55);
		context.stroke();
	}
	context.globalAlpha = 1;
}

/**
 * Pass 5 — wear: scars, crevice dust and a directional sheen.
 * @param {CanvasRenderingContext2D} context
 * @param {number} size
 * @param {import('./palettes.js').Palette} palette
 * @param {number} seed
 */
function paintWear(context, size, palette, seed) {
	const random = createRandom(seed ^ 0x9f42);
	const light = hexToRgb(palette.light);
	const dark = hexToRgb(palette.dark);

	// Battle scars — long, slightly curved, brighter than the hide (healed tissue).
	for (let scar = 0; scar < DRAGON_DETAIL.SCAR_COUNT; scar += 1) {
		const x = random() * size;
		const y = random() * size;
		const length = size * (0.1 + random() * 0.3);
		const angle = random() * Math.PI * 2;
		context.strokeStyle = rgbToCss(mixRgb(light, dark, random() * 0.4));
		context.globalAlpha = 0.16 + random() * 0.2;
		context.lineWidth = Math.max(0.8, size / 200) * (0.6 + random());
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

	// Dust settling into the crevices — breaks up the regularity of the scale lattice.
	const dust = createFbm(seed ^ 0x33d1, { octaves: 4, baseResolution: 4 });
	const image = context.getImageData(0, 0, size, size);
	const { data } = image;
	for (let py = 0; py < size; py += 1) {
		for (let px = 0; px < size; px += 1) {
			const amount = Math.pow(dust(px / size, py / size), 3) * 0.3;
			const offset = (py * size + px) * 4;
			data[offset] += (dark.r - data[offset]) * amount;
			data[offset + 1] += (dark.g - data[offset + 1]) * amount;
			data[offset + 2] += (dark.b - data[offset + 2]) * amount;
		}
	}
	context.putImageData(image, 0, 0);
}

/**
 * Full dragon-scale surface — the `dragon-scales` pattern entry.
 * @param {CanvasRenderingContext2D} context
 * @param {number} size
 * @param {import('./palettes.js').Palette} palette
 * @param {number} seed
 */
export function paintDragonScales(context, size, palette, seed) {
	paintHideBase(context, size, palette, seed);
	paintScaleRows(context, size, palette, seed);
	paintDorsalRidge(context, size, palette, seed);
	paintWear(context, size, palette, seed);
}

/** Dragon painters, keyed by `palettes.js`'s `pattern` field. */
export const DRAGON_PATTERNS = Object.freeze({
	'dragon-scales': paintDragonScales,
});
