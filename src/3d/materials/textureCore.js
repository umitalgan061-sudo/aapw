/**
 * Deterministic procedural texture core — the shared noise/canvas primitives every texture family in
 * `src/3d/materials/` draws with.
 *
 * Everything here is a pure function of an explicit seed (GOVERNANCE.md §5: `Math.random()` is
 * forbidden in world/content generation), so the same figure always receives byte-identical pixels
 * across sessions, machines and reloads. That matters for more than tidiness: the World Editor
 * serializes scenes to JSON by asset id, so a re-opened scene must re-generate exactly the textures
 * it was authored with.
 *
 * Textures are painted into an offscreen canvas at runtime rather than shipped as image files. No
 * new binary asset enters the repo or the PWA offline cache, and nothing here derives from real
 * HBO material (GOVERNANCE.md's single hard constraint) — every pattern is generated from first
 * principles by the code in this directory.
 * @module materials/textureCore
 */

/** Default edge length, in pixels, for generated texture canvases. 256 keeps a full figure set well
 * inside the mobile texture-memory budget (§4: <512MB) while still resolving fine detail such as
 * individual dragon scales; callers needing more can pass `size` explicitly. */
export const DEFAULT_TEXTURE_SIZE = 256;

/**
 * FNV-1a string hash — the entry point that turns a human-facing key ("black-dragon", "Kale
 * İşaertçisi") into a stable numeric seed.
 * @param {string} value
 * @returns {number} Unsigned 32-bit.
 */
export function hashString(value) {
	let hash = 2166136261;
	const text = String(value ?? '');
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

/**
 * mulberry32 PRNG — same generator family `world/terrain.js` already uses, kept local so this
 * directory never imports the world modules (and therefore never pulls THREE into a pure-math path).
 * @param {number} seed
 * @returns {() => number} Successive values in [0, 1).
 */
export function createRandom(seed) {
	let state = seed >>> 0;
	return function next() {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Builds a tileable value-noise sampler on an `resolution x resolution` lattice. Tileable matters
 * because these textures wrap around model UVs — a non-tiling noise shows a visible seam down the
 * side of every figure.
 * @param {number} seed
 * @param {number} [resolution] Lattice size; higher = finer features.
 * @returns {(x: number, y: number) => number} Sampler over normalized [0,1] coordinates, returns [0,1].
 */
export function createTileableNoise(seed, resolution = 8) {
	const random = createRandom(seed);
	const lattice = new Float32Array(resolution * resolution);
	for (let index = 0; index < lattice.length; index += 1) lattice[index] = random();

	const at = (ix, iy) => lattice[(((iy % resolution) + resolution) % resolution) * resolution + (((ix % resolution) + resolution) % resolution)];
	const smooth = (t) => t * t * (3 - 2 * t);

	return function sample(x, y) {
		const fx = x * resolution;
		const fy = y * resolution;
		const ix = Math.floor(fx);
		const iy = Math.floor(fy);
		const tx = smooth(fx - ix);
		const ty = smooth(fy - iy);
		const top = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
		const bottom = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
		return top * (1 - ty) + bottom * ty;
	};
}

/**
 * Fractal Brownian motion over `createTileableNoise` — the workhorse behind stone mottling, fur
 * softness, cloud shape and weathering. Each octave doubles the lattice resolution and halves its
 * contribution, and every octave keeps its own tileable lattice so the sum stays seamless.
 * @param {number} seed
 * @param {object} [options]
 * @param {number} [options.octaves]
 * @param {number} [options.baseResolution]
 * @param {number} [options.gain] Amplitude falloff per octave.
 * @returns {(x: number, y: number) => number} Normalized to roughly [0,1].
 */
export function createFbm(seed, { octaves = 4, baseResolution = 4, gain = 0.5 } = {}) {
	const layers = [];
	let amplitude = 1;
	let total = 0;
	for (let octave = 0; octave < octaves; octave += 1) {
		layers.push({
			sample: createTileableNoise(seed + octave * 7919, baseResolution * (2 ** octave)),
			amplitude,
		});
		total += amplitude;
		amplitude *= gain;
	}
	return function sample(x, y) {
		let sum = 0;
		for (const layer of layers) sum += layer.sample(x, y) * layer.amplitude;
		return sum / total;
	};
}

/**
 * Ridged variant of `createFbm` — folds the noise around its midpoint to produce creases rather than
 * blobs. Used wherever a material should read as cracked or veined (rock fractures, bark furrows,
 * dry earth) instead of softly mottled.
 * @param {number} seed
 * @param {object} [options] Same shape as `createFbm`.
 * @returns {(x: number, y: number) => number}
 */
export function createRidgedFbm(seed, options) {
	const fbm = createFbm(seed, options);
	return function sample(x, y) {
		return 1 - Math.abs(fbm(x, y) * 2 - 1);
	};
}

/**
 * Creates a drawing surface. Uses `OffscreenCanvas` when available (keeps generation off the DOM)
 * and falls back to a detached `<canvas>` element, so this works in the game page, the editor, and
 * headless test contexts alike.
 * @param {number} size
 * @returns {{canvas: HTMLCanvasElement|OffscreenCanvas, context: CanvasRenderingContext2D}}
 */
export function createCanvas(size = DEFAULT_TEXTURE_SIZE) {
	const canvas = typeof OffscreenCanvas === 'function'
		? new OffscreenCanvas(size, size)
		: Object.assign(document.createElement('canvas'), { width: size, height: size });
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas context unavailable — cannot generate procedural textures');
	return { canvas, context };
}

/** @param {{r: number, g: number, b: number}} color @returns {string} */
export function rgbToCss({ r, g, b }) {
	const channel = (value) => Math.max(0, Math.min(255, Math.round(value)));
	return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`;
}

/**
 * Parses `#rrggbb` / `0xrrggbb` / numeric hex into channel values.
 * @param {string|number} hex
 * @returns {{r: number, g: number, b: number}}
 */
export function hexToRgb(hex) {
	const value = typeof hex === 'number'
		? hex
		: Number.parseInt(String(hex).replace(/^[#0]x?/i, '').replace(/^#/, ''), 16);
	const safe = Number.isFinite(value) ? value : 0;
	return { r: (safe >> 16) & 255, g: (safe >> 8) & 255, b: safe & 255 };
}

/**
 * Linear blend between two colors.
 * @param {{r: number, g: number, b: number}} from
 * @param {{r: number, g: number, b: number}} to
 * @param {number} t Clamped to [0,1].
 * @returns {{r: number, g: number, b: number}}
 */
export function mixRgb(from, to, t) {
	const amount = Math.max(0, Math.min(1, t));
	return {
		r: from.r + (to.r - from.r) * amount,
		g: from.g + (to.g - from.g) * amount,
		b: from.b + (to.b - from.b) * amount,
	};
}

/**
 * Multiplies a color's brightness, keeping it in range. Used for the shading pass most patterns
 * finish with (ambient occlusion in crevices, highlight on raised detail).
 * @param {{r: number, g: number, b: number}} color
 * @param {number} factor
 * @returns {{r: number, g: number, b: number}}
 */
export function shadeRgb(color, factor) {
	return {
		r: Math.max(0, Math.min(255, color.r * factor)),
		g: Math.max(0, Math.min(255, color.g * factor)),
		b: Math.max(0, Math.min(255, color.b * factor)),
	};
}

/**
 * Fills the whole canvas by evaluating `shade(x, y)` per pixel, where `x`/`y` are normalized [0,1).
 * This is the base pass nearly every pattern starts from; patterns then draw vector detail (scales,
 * bricks, planks) on top with the normal canvas API.
 * @param {CanvasRenderingContext2D} context
 * @param {number} size
 * @param {(x: number, y: number) => {r: number, g: number, b: number}} shade
 */
export function fillPixels(context, size, shade) {
	const image = context.createImageData(size, size);
	const { data } = image;
	for (let py = 0; py < size; py += 1) {
		for (let px = 0; px < size; px += 1) {
			const color = shade(px / size, py / size);
			const offset = (py * size + px) * 4;
			data[offset] = Math.max(0, Math.min(255, color.r));
			data[offset + 1] = Math.max(0, Math.min(255, color.g));
			data[offset + 2] = Math.max(0, Math.min(255, color.b));
			data[offset + 3] = 255;
		}
	}
	context.putImageData(image, 0, 0);
}

/**
 * Wraps a normalized coordinate into [0,1) — lets patterns offset/repeat sampling without tearing at
 * the tile boundary.
 * @param {number} value
 * @returns {number}
 */
export function wrap01(value) {
	return value - Math.floor(value);
}
