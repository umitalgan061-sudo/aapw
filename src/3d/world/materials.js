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

	// `THREE.Color` keeps its components in **linear** space (`ColorManagement` is on by default since
	// three r152), but the bytes written into this canvas are read back as **sRGB** — `finalizeTexture`
	// tags the colour map `SRGBColorSpace`. Writing the linear components straight into the canvas
	// therefore darkened the stone twice: the 0x8a8578 warm grey this module is called with landed on
	// screen as roughly rgb(47,45,40), a muddy near-black, which is what every castle in the game has
	// actually been rendering since ADR-0013 (run 330 found it once the real castle models finally had
	// UVs to show a texture through at all). Convert back to sRGB for the byte write. The `shade` ramp
	// below then operates in the same space as `paintRoofColor`'s own grey ramp, which was always
	// written as plain sRGB bytes and so never had this problem.
	const srgbBase = baseColor.clone().convertLinearToSRGB();

	for (let i = 0; i < heights.length; i++) {
		const shade = 0.72 + heights[i] * 0.28 + tintNoise[i];
		const r = clamp(srgbBase.r * shade, 0, 1);
		const g = clamp(srgbBase.g * shade, 0, 1);
		const b = clamp(srgbBase.b * shade, 0, 1);
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

/**
 * Makes an imported mesh actually *renderable* with the maps `createStoneMaterial` produces.
 *
 * **Why this exists (GOVERNANCE.md §8.2 Root Cause Analysis).** The real castle models have carried a
 * `createStoneMaterial` since ADR-0074, but run 330 rendered them and found flat black silhouettes:
 * every one of these AI-generated `.glb` exports ships **geometry only** — `attributes` is
 * `['normal','position']` at best and `['position']` alone for several. Two independent consequences,
 * both invisible from code review and both fixed here:
 *
 * 1. **No `uv`** — a `map`/`normalMap`/`roughnessMap` has nothing to sample against, so every
 *    fragment reads texel (0,0). The stone texture was technically "applied" for ~275 runs and never
 *    once visible; the castle rendered as the single dark colour of its texture's first pixel.
 * 2. **No `normal`** — `MeshStandardMaterial` has no surface direction to light. glTF says a client
 *    must treat a normal-less primitive as flat-shaded, and `GLTFLoader` honours that by setting
 *    `flatShading` on *the material it creates*; replacing that material (which is the whole point of
 *    the procedural-stone pass) silently threw the accommodation away and left the mesh unlit.
 *
 * The UV projection is a **box/triplanar-lite** unwrap: each vertex is projected onto whichever world
 * plane its own normal faces most strongly, so walls take their tiling from X/Z and roofs and floors
 * from the horizontal plane, with no stretching where a real unwrap would have a seam. This is not a
 * substitute for an authored UV map — it cannot respect a texture's intended layout — but these
 * textures are seamless procedural noise with no layout to respect, which is exactly the case box
 * projection handles well.
 *
 * Scaling: UVs are emitted in **tiles of `metersPerTile` at final world size**, so the caller passes
 * the scale it is about to apply and stone blocks come out the same real-world size on a 40m keep and
 * a 52m fortress, instead of stretching with the model.
 *
 * Mutates the geometry in place and is idempotent (an existing `uv`/`normal` is never overwritten) —
 * which also makes it safe to call once on a model whose geometry is shared by several clones.
 *
 * @param {import('three').Object3D} model Root of a loaded model; every descendant mesh is processed.
 * @param {object} options
 * @param {number} options.modelScale Uniform scale the caller will apply to `model` after this call.
 * @param {number} [options.metersPerTile] Real-world size of one texture tile. ~4m reads as courses of
 *   masonry on a castle wall at gameplay distance rather than as visible wallpaper.
 * @returns {{meshes: number, uvsGenerated: number, normalsComputed: number}} What actually needed fixing.
 */
export function prepareImportedGeometryForTexturing(model, { modelScale, metersPerTile = 4 }) {
	let meshes = 0;
	let uvsGenerated = 0;
	let normalsComputed = 0;

	model.traverse((node) => {
		if (!node.isMesh || !node.geometry) return;
		const geometry = node.geometry;
		meshes++;

		if (!geometry.attributes.normal) {
			// glTF's own rule for a normal-less primitive. Must run before the UV pass below, which
			// reads normals to choose each vertex's projection plane.
			geometry.computeVertexNormals();
			normalsComputed++;
		}

		if (geometry.attributes.uv) return;

		const position = geometry.attributes.position;
		const normal = geometry.attributes.normal;
		const uv = new Float32Array(position.count * 2);
		const tile = metersPerTile / modelScale; // tile size expressed in the model's own local units

		for (let i = 0; i < position.count; i++) {
			const x = position.getX(i);
			const y = position.getY(i);
			const z = position.getZ(i);
			const nx = Math.abs(normal.getX(i));
			const ny = Math.abs(normal.getY(i));
			const nz = Math.abs(normal.getZ(i));

			// Dominant-axis box projection: drop the axis the surface faces, keep the other two.
			let u;
			let v;
			if (ny >= nx && ny >= nz) {
				u = x; v = z; // roof / floor / battlement top
			} else if (nx >= nz) {
				u = z; v = y; // wall facing ±X
			} else {
				u = x; v = y; // wall facing ±Z
			}
			uv[i * 2] = u / tile;
			uv[i * 2 + 1] = v / tile;
		}

		geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
		uvsGenerated++;
	});

	return { meshes, uvsGenerated, normalsComputed };
}
