/**
 * Texture factory — turns a `palettes.js` entry into a cached `THREE.CanvasTexture` and a ready
 * `THREE.MeshStandardMaterial`.
 *
 * Caching is the point of this module. A scene can hold hundreds of figures sharing a handful of
 * palettes; generating a 256px canvas per figure would be both slow and a texture-memory leak
 * (GOVERNANCE.md §4's mobile budget is 512MB, §2 rule 8 requires a dispose path). Textures are keyed
 * by `paletteId:size:variant` and shared, so N soldiers cost one texture, not N.
 * @module materials/textureFactory
 */

import * as THREE from 'three';
import { DEFAULT_TEXTURE_SIZE, createCanvas, hashString } from './textureCore.js';
import { PALETTES, findPalette } from './palettes.js';
import { CREATURE_PATTERNS } from './creaturePatterns.js';
import { TERRAIN_PATTERNS } from './terrainPatterns.js';
import { STRUCTURE_PATTERNS } from './structurePatterns.js';
import { DRAGON_PATTERNS } from './dragonTextures.js';

/** All pattern painters, merged from the per-family modules. */
export const PATTERN_PAINTERS = Object.freeze({
	...CREATURE_PATTERNS,
	...TERRAIN_PATTERNS,
	...STRUCTURE_PATTERNS,
	...DRAGON_PATTERNS,
});

/** @type {Map<string, THREE.CanvasTexture>} */
const textureCache = new Map();
/** @type {Map<string, THREE.MeshStandardMaterial>} */
const materialCache = new Map();

/**
 * Generates (or returns a cached) texture for a palette.
 *
 * `variant` lets several figures sharing one palette still differ — pass the object's own name and
 * two castles get different stone weathering while still both reading as "Kale". Omit it and every
 * caller shares one texture, which is what you want for tiling terrain.
 *
 * @param {string} paletteId
 * @param {object} [options]
 * @param {number} [options.size]
 * @param {string} [options.variant] Extra seed material.
 * @returns {THREE.CanvasTexture|null} Null when the palette or its painter is unknown.
 */
export function getPaletteTexture(paletteId, { size = DEFAULT_TEXTURE_SIZE, variant = '' } = {}) {
	const palette = findPalette(paletteId);
	if (!palette) return null;
	const painter = PATTERN_PAINTERS[palette.pattern];
	if (!painter) return null;

	const cacheKey = `${paletteId}:${size}:${variant}`;
	const cached = textureCache.get(cacheKey);
	if (cached) return cached;

	const { canvas, context } = createCanvas(size);
	// Seed from palette + variant only — never from time or Math.random — so the same figure gets the
	// same pixels on every reload (GOVERNANCE.md §5).
	const seed = hashString(`${paletteId}|${variant}`);
	painter(context, size, palette, seed);

	const texture = new THREE.CanvasTexture(canvas);
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 4;
	texture.needsUpdate = true;
	texture.name = `palette:${paletteId}`;
	texture.userData.paletteId = paletteId;
	texture.userData.cacheKey = cacheKey;

	textureCache.set(cacheKey, texture);
	return texture;
}

/**
 * Builds (or returns a cached) standard material for a palette, including its PBR hints and any
 * emissive term.
 * @param {string} paletteId
 * @param {object} [options]
 * @param {number} [options.size]
 * @param {string} [options.variant]
 * @param {number} [options.repeat] UV repeat, for tiling surfaces like ground or walls.
 * @returns {THREE.MeshStandardMaterial|null}
 */
export function getPaletteMaterial(paletteId, { size = DEFAULT_TEXTURE_SIZE, variant = '', repeat = 1 } = {}) {
	const palette = findPalette(paletteId);
	if (!palette) return null;

	const cacheKey = `${paletteId}:${size}:${variant}:${repeat}`;
	const cached = materialCache.get(cacheKey);
	if (cached) return cached;

	const texture = getPaletteTexture(paletteId, { size, variant });
	if (!texture) return null;

	// A repeat other than 1 needs its own texture instance — repeat lives on the texture, so sharing
	// one across different repeats would make the last caller silently retile everyone else.
	const materialTexture = repeat === 1 ? texture : texture.clone();
	if (repeat !== 1) {
		materialTexture.repeat.set(repeat, repeat);
		materialTexture.needsUpdate = true;
	}

	const material = new THREE.MeshStandardMaterial({
		map: materialTexture,
		color: 0xffffff,
		roughness: palette.roughness,
		metalness: palette.metalness,
	});
	if (palette.emissive !== undefined) {
		material.emissive = new THREE.Color(palette.emissive);
		material.emissiveIntensity = palette.emissiveIntensity ?? 1;
		material.emissiveMap = materialTexture;
	}
	material.name = `palette:${paletteId}`;
	material.userData.paletteId = paletteId;
	material.userData.cacheKey = cacheKey;
	material.userData.generatedByTextureFactory = true;

	materialCache.set(cacheKey, material);
	return material;
}

/**
 * Applies a palette to every mesh under `root`, replacing existing materials.
 *
 * The previous materials are disposed only when this factory created them; an FBX/GLB's own imported
 * materials are left alone so re-dressing a model is reversible and never destroys asset data the
 * loader still owns.
 *
 * @param {THREE.Object3D} root
 * @param {string} paletteId
 * @param {object} [options]
 * @param {number} [options.size]
 * @param {string} [options.variant]
 * @param {number} [options.repeat]
 * @returns {number} Number of meshes dressed.
 */
export function applyPaletteToObject(root, paletteId, options = {}) {
	const material = getPaletteMaterial(paletteId, options);
	if (!material || !root) return 0;

	let dressed = 0;
	root.traverse((child) => {
		if (!child.isMesh && !child.isInstancedMesh) return;
		const previous = child.material;
		child.material = material;
		child.userData.appliedPaletteId = paletteId;
		dressed += 1;
		disposeIfFactoryOwned(previous, material);
	});
	return dressed;
}

/**
 * Disposes a replaced material only if this factory made it and it is no longer the active one.
 * Cached factory materials are shared, so they are never disposed here — `disposePaletteCaches()` is
 * the single owner of that lifetime.
 * @param {THREE.Material|THREE.Material[]} previous
 * @param {THREE.Material} current
 */
function disposeIfFactoryOwned(previous, current) {
	const list = Array.isArray(previous) ? previous : [previous];
	for (const material of list) {
		if (!material || material === current) continue;
		// Imported asset materials and cached factory materials both stay alive on purpose.
		if (!material.userData?.generatedByTextureFactory) continue;
		if (materialCache.has(material.userData.cacheKey)) continue;
		material.dispose();
	}
}

/**
 * Releases every cached texture and material (memory-leak checklist, GOVERNANCE.md §2 rule 8). Call
 * on scene teardown — e.g. the editor's `pagehide` path.
 * @returns {{textures: number, materials: number}} What was released.
 */
export function disposePaletteCaches() {
	const released = { textures: textureCache.size, materials: materialCache.size };
	for (const material of materialCache.values()) {
		if (material.map && material.map !== textureCache.get(material.map.userData?.cacheKey)) {
			material.map.dispose();
		}
		material.dispose();
	}
	for (const texture of textureCache.values()) texture.dispose();
	materialCache.clear();
	textureCache.clear();
	return released;
}

/** @returns {{textures: number, materials: number}} Current cache occupancy — used by tests/perf logs. */
export function getPaletteCacheStats() {
	return { textures: textureCache.size, materials: materialCache.size };
}

/**
 * Palettes whose `pattern` has no painter registered — a real wiring bug rather than a runtime
 * condition, so it is exposed for the regression check instead of silently rendering nothing.
 * @returns {string[]}
 */
export function findUnpaintablePalettes() {
	return Object.keys(PALETTES).filter((id) => !PATTERN_PAINTERS[PALETTES[id].pattern]);
}
