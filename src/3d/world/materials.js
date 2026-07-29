/**
 * Procedural PBR-ish textures for `world/settlements.js`'s castle materials — canvas-generated
 * color/normal/roughness maps, no external image files (this project's no-network-asset
 * constraint, plus its established "procedural first" pattern already used by `sky.js`'s aurora
 * shader and `water.js`'s Gerstner waves). FAZ 3's second sub-task: castles had only flat-color
 * `MeshStandardMaterial`s (no maps) before this module — see DECISIONS.md ADR-0013's Consequence.
 * @module world/materials
 */

import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

/** Square texture resolution (px) for every map this module generates. Cheap at this size: three
 * 256x256 RGBA canvases total ~768KB uncompressed GPU memory, negligible against either the
 * desktop (2GB) or mobile (512MB) texture budget — no device-quality branch needed here. */
const TEXTURE_SIZE = 256;

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

/**
 * Height field for a mortared stone-block wall: each block is a shallow bevel (height 1 in the
 * middle, recessed to 0 in a thin groove at its edges to read as mortar), plus a small per-block
 * random height offset for natural variation. Shared by the color/roughness/normal generators
 * below so all three maps agree on where the blocks and grooves are.
 * @param {() => number} random Seeded PRNG (`mulberry32`).
 * @param {number} blockCols
 * @param {number} blockRows
 * @returns {Float32Array} `TEXTURE_SIZE * TEXTURE_SIZE` heights in [0, 1].
 */
function buildStoneHeightField(random, blockCols, blockRows) {
	const heights = new Float32Array(TEXTURE_SIZE * TEXTURE_SIZE);
	const blockW = TEXTURE_SIZE / blockCols;
	const blockH = TEXTURE_SIZE / blockRows;
	const grooveHalfWidth = 1.5;

	const blockOffsets = new Float32Array(blockCols * blockRows);
	for (let i = 0; i < blockOffsets.length; i++) blockOffsets[i] = (random() - 0.5) * 0.3;

	for (let py = 0; py < TEXTURE_SIZE; py++) {
		const row = Math.min(blockRows - 1, Math.floor(py / blockH));
		const by = py - row * blockH;
		for (let px = 0; px < TEXTURE_SIZE; px++) {
			const col = Math.min(blockCols - 1, Math.floor(px / blockW));
			const bx = px - col * blockW;
			const edgeDist = Math.min(bx, blockW - bx, by, blockH - by);
			const bevel = clamp(edgeDist / grooveHalfWidth, 0, 1);
			heights[py * TEXTURE_SIZE + px] = clamp(bevel + blockOffsets[row * blockCols + col], 0, 1);
		}
	}
	return heights;
}

/**
 * Paints a stone-block color map (per-block tint variance over `baseColor`, darker mortar grooves)
 * onto a 2D canvas context, driven by the same height field the normal map derives from so the
 * grooves line up visually.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Float32Array} heights From `buildStoneHeightField`.
 * @param {THREE.Color} baseColor
 * @param {() => number} random
 */
function paintStoneColor(ctx, heights, baseColor, random) {
	const image = ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
	const tintNoise = new Float32Array(TEXTURE_SIZE * TEXTURE_SIZE);
	// Low-frequency tint variance so neighboring blocks don't all share one random value per pixel
	// (that would look like static, not stone) — reuse the block-aligned height field's grooves
	// for shape, but a smoother per-pixel jitter for color richness.
	for (let i = 0; i < tintNoise.length; i++) tintNoise[i] = (random() - 0.5) * 0.06;

	for (let i = 0; i < heights.length; i++) {
		const shade = 0.72 + heights[i] * 0.28 + tintNoise[i];
		const r = clamp(baseColor.r * shade, 0, 1);
		const g = clamp(baseColor.g * shade, 0, 1);
		const b = clamp(baseColor.b * shade, 0, 1);
		image.data[i * 4] = r * 255;
		image.data[i * 4 + 1] = g * 255;
		image.data[i * 4 + 2] = b * 255;
		image.data[i * 4 + 3] = 255;
	}
	ctx.putImageData(image, 0, 0);
}

/**
 * Paints a grayscale roughness map: mortar grooves are rougher (brighter) than block faces.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Float32Array} heights
 */
function paintStoneRoughness(ctx, heights) {
	const image = ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
	for (let i = 0; i < heights.length; i++) {
		const roughness = clamp(0.95 - heights[i] * 0.25, 0, 1);
		const value = roughness * 255;
		image.data[i * 4] = value;
		image.data[i * 4 + 1] = value;
		image.data[i * 4 + 2] = value;
		image.data[i * 4 + 3] = 255;
	}
	ctx.putImageData(image, 0, 0);
}

/**
 * Derives a tangent-space normal map from the height field via a central-difference gradient
 * (classic height->normal conversion): steep transitions at groove edges bevel the light instead
 * of reading as flat-shaded per-block color, without any real extra vertex geometry.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Float32Array} heights
 * @param {number} strength Gradient multiplier — higher reads as a deeper groove.
 */
function paintStoneNormal(ctx, heights, strength) {
	const image = ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
	const at = (x, y) => heights[((y + TEXTURE_SIZE) % TEXTURE_SIZE) * TEXTURE_SIZE + ((x + TEXTURE_SIZE) % TEXTURE_SIZE)];

	for (let py = 0; py < TEXTURE_SIZE; py++) {
		for (let px = 0; px < TEXTURE_SIZE; px++) {
			const dx = (at(px + 1, py) - at(px - 1, py)) * strength;
			const dy = (at(px, py + 1) - at(px, py - 1)) * strength;
			// Normal from a height field: (-dHeight/dx, -dHeight/dy, 1), normalized.
			const nx = -dx;
			const ny = -dy;
			const nz = 1;
			const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
			const i = py * TEXTURE_SIZE + px;
			image.data[i * 4] = ((nx / len) * 0.5 + 0.5) * 255;
			image.data[i * 4 + 1] = ((ny / len) * 0.5 + 0.5) * 255;
			image.data[i * 4 + 2] = ((nz / len) * 0.5 + 0.5) * 255;
			image.data[i * 4 + 3] = 255;
		}
	}
	ctx.putImageData(image, 0, 0);
}

/**
 * @param {THREE.Texture} texture
 * @param {number} repeatX
 * @param {number} repeatY
 * @param {boolean} isColorMap `true` for the color/albedo map (needs sRGB decoding); `false` for
 *   normal/roughness maps (already-linear data, must not be sRGB-decoded by the GPU sampler).
 */
function finalizeTexture(texture, repeatX, repeatY, isColorMap) {
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.repeat.set(repeatX, repeatY);
	if (isColorMap) texture.colorSpace = THREE.SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;
}

/**
 * Builds a seeded mortared-stone-block `MeshStandardMaterial` (color + roughness + normal maps).
 * Deterministic: the same `seed` always paints the same texture (this project's determinism rule
 * — see `world/README.md`'s "Determinism" convention).
 * @param {object} options
 * @param {number} options.seed
 * @param {THREE.Color} options.baseColor
 * @param {number} [options.repeat] UV repeat count along both axes (block density) — tuned per
 *   caller against the geometry's real size in meters so blocks read as a believable ~1.5-2m scale.
 * @returns {THREE.MeshStandardMaterial}
 */
export function createStoneMaterial({ seed, baseColor, repeat = 12 }) {
	const random = mulberry32(seed);
	const blockCols = 8;
	const blockRows = 8;
	const heights = buildStoneHeightField(random, blockCols, blockRows);

	const colorCanvas = document.createElement('canvas');
	colorCanvas.width = colorCanvas.height = TEXTURE_SIZE;
	paintStoneColor(colorCanvas.getContext('2d'), heights, baseColor, random);

	const roughnessCanvas = document.createElement('canvas');
	roughnessCanvas.width = roughnessCanvas.height = TEXTURE_SIZE;
	paintStoneRoughness(roughnessCanvas.getContext('2d'), heights);

	const normalCanvas = document.createElement('canvas');
	normalCanvas.width = normalCanvas.height = TEXTURE_SIZE;
	paintStoneNormal(normalCanvas.getContext('2d'), heights, 6);

	const map = finalizeTexture(new THREE.CanvasTexture(colorCanvas), repeat, repeat, true);
	const roughnessMap = finalizeTexture(new THREE.CanvasTexture(roughnessCanvas), repeat, repeat, false);
	const normalMap = finalizeTexture(new THREE.CanvasTexture(normalCanvas), repeat, repeat, false);

	return new THREE.MeshStandardMaterial({ map, roughnessMap, normalMap, metalness: 0.05 });
}

/**
 * Builds a seeded slate-roof `MeshStandardMaterial`: horizontal shingle-row shading in the color
 * map (grayscale-ish, so `InstancedMesh.setColorAt`'s per-seat house color still shows through
 * the multiply — see `world/settlements.js`), plus a matching roughness map. No normal map: the
 * roof's cone geometry is already faceted enough at this project's current camera distances to
 * read as shaped without one — see DECISIONS.md's this-run entry for why that scope is bounded on
 * purpose rather than matching the stone material's full map set.
 * @param {object} options
 * @param {number} options.seed
 * @param {number} [options.repeat]
 * @returns {THREE.MeshStandardMaterial}
 */
export function createRoofMaterial({ seed, repeat = 6 }) {
	const random = mulberry32(seed);
	const rowCount = 10;
	const rowH = TEXTURE_SIZE / rowCount;

	const colorCanvas = document.createElement('canvas');
	colorCanvas.width = colorCanvas.height = TEXTURE_SIZE;
	const colorCtx = colorCanvas.getContext('2d');
	const roughnessCanvas = document.createElement('canvas');
	roughnessCanvas.width = roughnessCanvas.height = TEXTURE_SIZE;
	const roughnessCtx = roughnessCanvas.getContext('2d');

	for (let row = 0; row < rowCount; row++) {
		const rowShade = 0.82 + random() * 0.18;
		colorCtx.fillStyle = `rgb(${rowShade * 255}, ${rowShade * 255}, ${rowShade * 255})`;
		colorCtx.fillRect(0, row * rowH, TEXTURE_SIZE, rowH);
		// A thin darker seam at each shingle row's lower edge reads as an overlap line.
		colorCtx.fillStyle = 'rgba(0, 0, 0, 0.35)';
		colorCtx.fillRect(0, (row + 1) * rowH - 2, TEXTURE_SIZE, 2);

		const rowRoughness = clamp(0.55 + (random() - 0.5) * 0.1, 0, 1) * 255;
		roughnessCtx.fillStyle = `rgb(${rowRoughness}, ${rowRoughness}, ${rowRoughness})`;
		roughnessCtx.fillRect(0, row * rowH, TEXTURE_SIZE, rowH);
	}

	const map = finalizeTexture(new THREE.CanvasTexture(colorCanvas), repeat, repeat, true);
	const roughnessMap = finalizeTexture(new THREE.CanvasTexture(roughnessCanvas), repeat, repeat, false);

	return new THREE.MeshStandardMaterial({ map, roughnessMap, metalness: 0.1 });
}

/**
 * Disposes a material's own maps plus the material itself (memory-leak checklist — three.js does
 * not dispose a material's textures automatically when you dispose the material). Call once per
 * material this module created, on scene teardown.
 * @param {THREE.MeshStandardMaterial} material
 */
export function disposeCastleMaterial(material) {
	if (material.map) material.map.dispose();
	if (material.roughnessMap) material.roughnessMap.dispose();
	if (material.normalMap) material.normalMap.dispose();
	material.dispose();
}
