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

/** Render-only anti-repetition treatment layered over the existing authored/procedural UV maps.
 * The base maps keep masonry/shingle scale while world-space macro/meso/fine weathering prevents
 * the same 256px tile from reading as wallpaper across a keep or across multiple kingdom seats. */
export const CASTLE_WORLD_SPACE_WEATHERING_POLICY = Object.freeze({
	id: 'castle-world-space-weathering-2026-09-01-v2',
	macroMeters: 76,
	mesoMeters: 21,
	fineMeters: 5.8,
	stoneStrength: 1,
	roofStrength: 0.72,
});

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
 * Height field for mortared stonework. It deliberately avoids a Cartesian brick grid: every course
 * gets its own deterministic horizontal phase, individual stones get shallow height offsets, and
 * the horizontal mortar boundary meanders by roughly a pixel or two across each course. The result
 * remains seamless/repeatable as a texture, but no long ruler-straight vertical joint can cross an
 * entire keep or tower. World-space weathering below then breaks repetition between UV tiles.
 * @param {() => number} random Seeded PRNG (`mulberry32`).
 * @param {number} blockCols
 * @param {number} blockRows
 * @returns {Float32Array} `TEXTURE_SIZE * TEXTURE_SIZE` heights in [0, 1].
 */
function buildStoneHeightField(random, blockCols, blockRows) {
	const heights = new Float32Array(TEXTURE_SIZE * TEXTURE_SIZE);
	const blockW = TEXTURE_SIZE / blockCols;
	const blockH = TEXTURE_SIZE / blockRows;
	const grooveHalfWidth = 1.15;
	const rowOffsets = new Float32Array(blockRows);
	const rowWobblePhase = new Float32Array(blockRows);
	const blockOffsets = new Float32Array(blockCols * blockRows);

	for (let row = 0; row < blockRows; row++) {
		// Broadly stretcher-bond, but not a perfect half-brick mechanical alternation.
		const bond = (row & 1) ? 0.44 : 0.04;
		rowOffsets[row] = (bond + (random() - 0.5) * 0.16) * blockW;
		rowWobblePhase[row] = random() * Math.PI * 2;
		for (let col = 0; col < blockCols; col++) {
			blockOffsets[row * blockCols + col] = (random() - 0.5) * 0.22;
		}
	}

	for (let py = 0; py < TEXTURE_SIZE; py++) {
		const row = Math.min(blockRows - 1, Math.floor(py / blockH));
		const by = py - row * blockH;
		for (let px = 0; px < TEXTURE_SIZE; px++) {
			const shiftedX = ((px + rowOffsets[row]) % TEXTURE_SIZE + TEXTURE_SIZE) % TEXTURE_SIZE;
			const col = Math.min(blockCols - 1, Math.floor(shiftedX / blockW));
			const bx = shiftedX - col * blockW;
			const verticalEdge = Math.min(bx, blockW - bx);
			// Low-amplitude, deterministic bedding irregularity removes the perfect horizontal rings
			// that were especially obvious on cylindrical towers while retaining readable masonry.
			const courseWave = Math.sin(
				(px / TEXTURE_SIZE) * Math.PI * 2 * (1 + (row % 3) * 0.5) + rowWobblePhase[row],
			) * 1.35;
			const horizontalEdge = Math.min(by + courseWave, blockH - by - courseWave);
			const edgeDist = Math.min(verticalEdge, horizontalEdge);
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
	for (let i = 0; i < tintNoise.length; i++) tintNoise[i] = (random() - 0.5) * 0.035;

	// `THREE.Color` components are linear while canvas bytes are sRGB. Convert once before writing.
	const srgbBase = baseColor.clone().convertLinearToSRGB();

	for (let i = 0; i < heights.length; i++) {
		// Mortar stays legible without turning every joint into a black line from gameplay distance.
		const shade = 0.81 + heights[i] * 0.19 + tintNoise[i];
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
		const roughness = clamp(0.93 - heights[i] * 0.18, 0, 1);
		const value = roughness * 255;
		image.data[i * 4] = value;
		image.data[i * 4 + 1] = value;
		image.data[i * 4 + 2] = value;
		image.data[i * 4 + 3] = 255;
	}
	ctx.putImageData(image, 0, 0);
}

/**
 * Derives a tangent-space normal map from the height field via a central-difference gradient.
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
 * @param {boolean} isColorMap
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
 * Adds deterministic world-space weathering without replacing any existing map. The UV maps retain
 * local masonry/shingle detail; this shader supplies non-periodic macro/meso/fine mineral,
 * dampness and roughness variation at real metre scales.
 * @param {THREE.MeshStandardMaterial} material
 * @param {object} options
 * @param {number} options.seed
 * @param {'stone'|'roof'} options.surface
 * @returns {THREE.MeshStandardMaterial}
 */
function applyCastleWorldSpaceWeathering(material, { seed, surface }) {
	const policy = CASTLE_WORLD_SPACE_WEATHERING_POLICY;
	const stableSeed = Number(seed) >>> 0;
	const phase = new THREE.Vector2(
		((stableSeed & 1023) - 511.5) * 0.173,
		(((stableSeed >>> 10) & 1023) - 511.5) * 0.157,
	);
	const strength = surface === 'roof' ? policy.roofStrength : policy.stoneStrength;
	const previousCompile = material.onBeforeCompile;
	const previousCacheKey = material.customProgramCacheKey;

	material.userData ||= {};
	material.userData.castleWorldSpaceWeathering = Object.freeze({
		policyId: policy.id,
		surface,
		macroMeters: policy.macroMeters,
		mesoMeters: policy.mesoMeters,
		fineMeters: policy.fineMeters,
	});

	material.onBeforeCompile = (shader, renderer) => {
		previousCompile?.(shader, renderer);
		shader.uniforms.uCastleWeatherPhase = { value: phase };
		shader.uniforms.uCastleWeatherStrength = { value: strength };

		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vCastleWorldPosition;')
			.replace(
				'#include <worldpos_vertex>',
				`#include <worldpos_vertex>
				vec4 castleWeatherWorldPosition = vec4(transformed, 1.0);
				#ifdef USE_BATCHING
					castleWeatherWorldPosition = batchingMatrix * castleWeatherWorldPosition;
				#endif
				#ifdef USE_INSTANCING
					castleWeatherWorldPosition = instanceMatrix * castleWeatherWorldPosition;
				#endif
				vCastleWorldPosition = (modelMatrix * castleWeatherWorldPosition).xyz;`,
			);

		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
				varying vec3 vCastleWorldPosition;
				uniform vec2 uCastleWeatherPhase;
				uniform float uCastleWeatherStrength;
				float castleWeatherHash(vec2 p) {
					return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
				}
				float castleWeatherNoise(vec2 p) {
					vec2 i = floor(p);
					vec2 f = fract(p);
					f = f * f * (3.0 - 2.0 * f);
					return mix(
						mix(castleWeatherHash(i), castleWeatherHash(i + vec2(1.0, 0.0)), f.x),
						mix(castleWeatherHash(i + vec2(0.0, 1.0)), castleWeatherHash(i + vec2(1.0, 1.0)), f.x),
						f.y
					);
				}
				float castleWeatherFbm(vec2 p) {
					float value = castleWeatherNoise(p) * 0.58;
					p = mat2(0.80, -0.60, 0.60, 0.80) * p * 2.03 + vec2(7.3, 3.1);
					value += castleWeatherNoise(p) * 0.28;
					p = mat2(0.60, -0.80, 0.80, 0.60) * p * 2.11 + vec2(2.7, 9.4);
					value += castleWeatherNoise(p) * 0.14;
					return value;
				}`,
			)
			.replace(
				'#include <map_fragment>',
				`#include <map_fragment>
				vec2 castleWeatherXZ = vCastleWorldPosition.xz + uCastleWeatherPhase;
				float castleWeatherMacro = castleWeatherFbm(castleWeatherXZ / ${policy.macroMeters.toFixed(1)});
				float castleWeatherMeso = castleWeatherFbm((mat2(0.86, -0.51, 0.51, 0.86) * castleWeatherXZ) / ${policy.mesoMeters.toFixed(1)} + vec2(13.7, 4.6));
				float castleWeatherFine = castleWeatherFbm(castleWeatherXZ / ${policy.fineMeters.toFixed(1)} + vec2(3.9, 17.2));
				float castleWeatherExposure = clamp(castleWeatherMacro * 0.52 + castleWeatherMeso * 0.34 + castleWeatherFine * 0.14, 0.0, 1.0);
				float castleWeatherDamp = smoothstep(0.58, 0.89, castleWeatherFbm(castleWeatherXZ / 33.0 + vec2(31.4, 8.2)));
				vec3 castleWeatherMineral = mix(vec3(0.89, 0.93, 0.90), vec3(1.045, 0.995, 0.92), castleWeatherMacro);
				diffuseColor.rgb *= mix(vec3(1.0), castleWeatherMineral, 0.15 * uCastleWeatherStrength);
				diffuseColor.rgb *= 0.96 + (castleWeatherExposure - 0.5) * 0.15 * uCastleWeatherStrength;
				diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.80, 0.89, 0.83), castleWeatherDamp * 0.12 * uCastleWeatherStrength);`,
			)
			.replace(
				'#include <roughnessmap_fragment>',
				`#include <roughnessmap_fragment>
				roughnessFactor = clamp(
					roughnessFactor + ((1.0 - castleWeatherExposure) * 0.09 + castleWeatherDamp * 0.14 - castleWeatherFine * 0.035) * uCastleWeatherStrength,
					0.38,
					0.98
				);`,
			);
	};

	material.customProgramCacheKey = () => {
		const previous = typeof previousCacheKey === 'function' ? previousCacheKey.call(material) : '';
		return `${previous}|${policy.id}|${surface}`;
	};
	material.needsUpdate = true;
	return material;
}

/**
 * Builds a seeded mortared-stone-block `MeshStandardMaterial` (color + roughness + normal maps).
 * Deterministic: the same `seed` always paints the same texture.
 * @param {object} options
 * @param {number} options.seed
 * @param {THREE.Color} options.baseColor
 * @param {number} [options.repeat]
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
	paintStoneNormal(normalCanvas.getContext('2d'), heights, 3.8);

	const map = finalizeTexture(new THREE.CanvasTexture(colorCanvas), repeat, repeat, true);
	const roughnessMap = finalizeTexture(new THREE.CanvasTexture(roughnessCanvas), repeat, repeat, false);
	const normalMap = finalizeTexture(new THREE.CanvasTexture(normalCanvas), repeat, repeat, false);

	const material = new THREE.MeshStandardMaterial({
		map,
		roughnessMap,
		normalMap,
		normalScale: new THREE.Vector2(0.52, 0.52),
		metalness: 0.035,
	});
	return applyCastleWorldSpaceWeathering(material, { seed, surface: 'stone' });
}

/**
 * Builds a seeded slate-roof `MeshStandardMaterial`: horizontal shingle-row shading in the color
 * map plus a matching roughness map. World-space weathering prevents identical roof sheets from
 * sharing one broad tone across an entire settlement.
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
		const rowShade = 0.84 + random() * 0.16;
		colorCtx.fillStyle = `rgb(${rowShade * 255}, ${rowShade * 255}, ${rowShade * 255})`;
		colorCtx.fillRect(0, row * rowH, TEXTURE_SIZE, rowH);
		colorCtx.fillStyle = 'rgba(0, 0, 0, 0.26)';
		colorCtx.fillRect(0, (row + 1) * rowH - 2, TEXTURE_SIZE, 2);

		const rowRoughness = clamp(0.57 + (random() - 0.5) * 0.12, 0, 1) * 255;
		roughnessCtx.fillStyle = `rgb(${rowRoughness}, ${rowRoughness}, ${rowRoughness})`;
		roughnessCtx.fillRect(0, row * rowH, TEXTURE_SIZE, rowH);
	}

	const map = finalizeTexture(new THREE.CanvasTexture(colorCanvas), repeat, repeat, true);
	const roughnessMap = finalizeTexture(new THREE.CanvasTexture(roughnessCanvas), repeat, repeat, false);

	const material = new THREE.MeshStandardMaterial({ map, roughnessMap, metalness: 0.08 });
	return applyCastleWorldSpaceWeathering(material, { seed, surface: 'roof' });
}

/**
 * Disposes a material's own maps plus the material itself.
 * @param {THREE.MeshStandardMaterial} material
 */
export function disposeCastleMaterial(material) {
	if (material.map) material.map.dispose();
	if (material.roughnessMap) material.roughnessMap.dispose();
	if (material.normalMap) material.normalMap.dispose();
	material.dispose();
}

/**
 * Makes an imported mesh actually renderable with the maps `createStoneMaterial` produces.
 * Missing normals are generated; missing UVs receive a dominant-axis box projection sized in
 * real-world metres. Existing authored UVs/normals are never overwritten.
 * @param {import('three').Object3D} model
 * @param {object} options
 * @param {number} options.modelScale
 * @param {number} [options.metersPerTile]
 * @returns {{meshes: number, uvsGenerated: number, normalsComputed: number}}
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
			geometry.computeVertexNormals();
			normalsComputed++;
		}

		if (geometry.attributes.uv) return;

		const position = geometry.attributes.position;
		const normal = geometry.attributes.normal;
		const uv = new Float32Array(position.count * 2);
		const tile = metersPerTile / modelScale;

		for (let i = 0; i < position.count; i++) {
			const x = position.getX(i);
			const y = position.getY(i);
			const z = position.getZ(i);
			const nx = Math.abs(normal.getX(i));
			const ny = Math.abs(normal.getY(i));
			const nz = Math.abs(normal.getZ(i));

			let u;
			let v;
			if (ny >= nx && ny >= nz) {
				u = x; v = z;
			} else if (nx >= nz) {
				u = z; v = y;
			} else {
				u = x; v = y;
			}
			uv[i * 2] = u / tile;
			uv[i * 2 + 1] = v / tile;
		}

		geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
		uvsGenerated++;
	});

	return { meshes, uvsGenerated, normalsComputed };
}
