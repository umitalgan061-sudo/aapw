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
import { surveyParts } from './meshPartClassifier.js';
import { kitForPalette, resolveKit } from './figureKits.js';
import { createLayeredMaterial, meshHeightRange } from './layeredMaterial.js';
import { hashString as hashSeed } from './textureCore.js';
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
 * Dresses a figure part by part, which is what a real figure needs: a person is skin *and* hair
 * *and* eyes *and* tunic *and* boots, not one surface.
 *
 * Three mechanisms, applied in descending order of confidence — this ordering is the whole design:
 *   1. **Named parts.** Every mesh and every material slot is classified by name
 *      (`meshPartClassifier.js`) and dressed from the kit's slot table. This is what actually
 *      handles the wolf (fur/claws/teeth/eyes) and the dragon (whose five materials live on one
 *      mesh, so classification runs per material index, not per mesh).
 *   2. **Vertical bands.** A mesh whose parts cannot be named — the common case for character models
 *      here — gets `layeredMaterial.js`'s banded shader, dressing it by height: boots, trousers,
 *      belt, tunic, skin, hair. Still one material and one draw call.
 *   3. **Single palette.** Anything with no kit at all (plain stone, water, a road) keeps the
 *      original whole-object behaviour.
 *
 * @param {import('three').Object3D} root
 * @param {string} paletteId Palette chosen by the matcher; selects the kit.
 * @param {object} [options]
 * @param {string} [options.variant] Seed material so individuals differ deterministically.
 * @param {number} [options.size] Texture size for named/material-slot surfaces.
 * @param {number} [options.layeredSize] Explicit single-mesh layered resolution. Defaults to 128 for
 *   bulk/crowd auto-dressing; editor hero workflows may opt into a larger value deliberately.
 * @returns {{ok: boolean, kit: string|null, named: number, banded: number, plain: number, slots: Record<string, number>}}
 */
export function applyKitToObject(root, paletteId, {
	variant = '',
	size = DEFAULT_TEXTURE_SIZE,
	layeredSize = 128,
} = {}) {
	const summary = { ok: false, kit: null, named: 0, banded: 0, main: 0, plain: 0, slots: {} };
	if (!root) return summary;

	const palette = findPalette(paletteId);
	const kit = kitForPalette(palette);
	if (!kit) {
		// No part structure worth modelling (stone, water, road) — the whole-object path is correct.
		summary.plain = applyPaletteToObject(root, paletteId, { variant, size });
		summary.ok = summary.plain > 0;
		return summary;
	}

	summary.kit = kit.id;
	const seed = hashSeed(`${paletteId}|${variant}`);
	const resolved = resolveKit(kit, seed);
	// The matched palette wins over the kit's own default for the figure's main surface — matching
	// "Kızıl Ejderha" must still produce a red dragon, not the kit's black default.
	const mainPalette = palette ? palette.id : resolved.base;

	const surfaces = surveyParts(root);
	/** @type {Map<object, (import('three').Material|null)[]>} */
	const pendingByMesh = new Map();

	for (const surface of surfaces) {
		const { mesh, materialIndex, slot } = surface;
		if (!pendingByMesh.has(mesh)) {
			const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
			pendingByMesh.set(mesh, new Array(materials.length).fill(null));
		}
		if (!slot) continue;

		// A slot the kit does not list (e.g. `wing` on a horse) falls back to the figure's main
		// surface rather than being left undressed.
		const slotPalette = resolved.slots[slot] || (isMainSurfaceSlot(slot) ? mainPalette : null);
		if (!slotPalette) continue;
		const material = getPaletteMaterial(slotPalette, { variant: `${variant}:${slot}`, size });
		if (!material) continue;
		pendingByMesh.get(mesh)[materialIndex] = material;
		summary.named += 1;
		summary.slots[slot] = (summary.slots[slot] || 0) + 1;
	}

	for (const [mesh, pending] of pendingByMesh) {
		const anyNamed = pending.some(Boolean);
		if (!anyNamed) {
			// Nothing on this mesh was identifiable — dress it by height instead of by name. The crowd
			// default stays 128px, while an explicit editor hero resolution can opt into up to 512px.
			const range = meshHeightRange(mesh);
			const layered = range
				? createLayeredMaterial({
					bands: resolved.bands,
					heightRange: range,
					variant,
					size: Math.min(Math.max(64, layeredSize), 512),
				})
				: null;
			if (layered) {
				rememberAndAssign(mesh, layered);
				summary.banded += 1;
				continue;
			}
			const plain = getPaletteMaterial(mainPalette, { variant, size });
			if (plain) {
				rememberAndAssign(mesh, plain);
				summary.plain += 1;
			}
			continue;
		}

		// Partially named mesh: fill the unnamed material slots with the figure's main surface so no
		// slot is left wearing the imported asset's original material next to a dressed one. This is
		// the dragon's case — one mesh, five materials, only `EYES.001` self-describing, so the other
		// four correctly become dragon scales.
		const mainMaterial = getPaletteMaterial(mainPalette, { variant, size });
		const filled = pending.map((material) => {
			if (material) return material;
			summary.main += 1;
			return mainMaterial;
		});
		rememberAndAssign(mesh, filled.length === 1 ? filled[0] : filled);
	}

	root.userData.appliedKitId = kit.id;
	summary.ok = summary.named + summary.banded + summary.main + summary.plain > 0;
	return summary;
}

/** Slots that represent the figure's main body surface rather than a distinct accessory. */
function isMainSurfaceSlot(slot) {
	return ['skin', 'fur', 'scale', 'feather', 'mane'].includes(slot);
}

/**
 * Assigns a material, stashing the original once so auto-dressing stays reversible.
 * @param {import('three').Mesh} mesh
 * @param {import('three').Material|import('three').Material[]} material
 */
function rememberAndAssign(mesh, material) {
	if (mesh.userData.originalMaterial === undefined) mesh.userData.originalMaterial = mesh.material;
	mesh.material = material;
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