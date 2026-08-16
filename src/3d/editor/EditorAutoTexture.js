/**
 * "Otomatik Doku Giydir" — the World Editor's auto-dressing action.
 *
 * Takes whatever the user has selected, asks `materials/textureMatcher.js` which palette that figure
 * should wear based on its kind and its Turkish/English name, and applies the generated texture.
 *
 * The matcher is given every identifying field the editor knows about (object name, editor asset id,
 * asset category, source path) because the library mixes conventions: a primitive is `marker-castle`
 * / "Kale İşaretçisi", an imported model is `peasant_girl.fbx`, and the user may have renamed the
 * object to something more specific than either. Names the user typed win over ids, so renaming an
 * object to "Kızıl Ejderha" re-dresses it on the next press.
 *
 * Applying is non-destructive in the sense that matters here: the original material is stashed on
 * `userData.originalMaterial` the first time a mesh is dressed, so `restoreOriginalMaterials()` can
 * put the imported FBX/GLB look back without reloading the asset.
 * @module editor/EditorAutoTexture
 */

import { matchPalette } from '../materials/textureMatcher.js';
import { applyKitToObject, getPaletteMaterial } from '../materials/textureFactory.js';
import { findPalette } from '../materials/palettes.js';

/**
 * Collects the identifying fields the matcher scores against.
 * @param {import('three').Object3D} object
 * @param {(assetId: string) => ({name?: string, category?: string, src?: string}|null)} [lookupAsset]
 * @returns {{id: string, name: string, category: string, src: string}}
 */
export function describeFigure(object, lookupAsset) {
	const assetId = object?.userData?.editorAssetId || '';
	const asset = (typeof lookupAsset === 'function' && assetId) ? lookupAsset(assetId) : null;
	return {
		id: assetId,
		name: object?.name || asset?.name || '',
		category: asset?.category || '',
		src: asset?.src || '',
	};
}

/**
 * Dresses one object with its auto-matched palette.
 *
 * @param {import('three').Object3D} object
 * @param {object} [options]
 * @param {(assetId: string) => object|null} [options.lookupAsset]
 * @param {string} [options.paletteId] Force a specific palette instead of matching.
 * @param {number} [options.size] Generated texture size; defaults to the shared texture-factory policy.
 * @returns {{ok: boolean, paletteId?: string, label?: string, reason?: string, meshes?: number, error?: string}}
 */
export function autoTextureObject(object, { lookupAsset, paletteId, size } = {}) {
	if (!object) return { ok: false, error: 'Önce bir obje seç.' };

	let chosenId = paletteId;
	let reason = 'elle seçildi';
	if (!chosenId) {
		const match = matchPalette(describeFigure(object, lookupAsset));
		chosenId = match.paletteId;
		reason = match.reason;
	}

	const palette = findPalette(chosenId);
	if (!palette) return { ok: false, error: `Bilinmeyen palet: ${chosenId}` };

	rememberOriginalMaterials(object);

	// Variant seeds from the object's own identity, so two castles in one scene weather differently —
	// and two peasants get different skin tones and tunic colours — while staying deterministic.
	const variant = object.userData?.editorId || object.name || '';
	const applied = applyKitToObject(object, chosenId, { variant, size });
	if (!applied.ok) return { ok: false, error: 'Bu objede giydirilecek mesh yok.' };

	object.userData.autoTexturePaletteId = chosenId;
	return {
		ok: true,
		paletteId: chosenId,
		label: palette.label,
		reason,
		meshes: applied.named + applied.banded + applied.main + applied.plain,
		kit: applied.kit,
		named: applied.named,
		banded: applied.banded,
		main: applied.main,
		plain: applied.plain,
		slots: applied.slots,
	};
}

/**
 * Dresses many objects at once. Instanced groups are included — they share one material, so a whole
 * formation re-textures in a single pass.
 * @param {import('three').Object3D[]} objects
 * @param {object} [options] Same as `autoTextureObject`.
 * @returns {{dressed: number, meshes: number, failures: number, byPalette: Record<string, number>}}
 */
export function autoTextureMany(objects, options = {}) {
	const summary = { dressed: 0, meshes: 0, failures: 0, byPalette: {}, named: 0, banded: 0, main: 0, plain: 0 };
	for (const object of objects || []) {
		const result = autoTextureObject(object, options);
		if (!result.ok) {
			summary.failures += 1;
			continue;
		}
		summary.dressed += 1;
		summary.meshes += result.meshes;
		summary.named += result.named || 0;
		summary.banded += result.banded || 0;
		summary.main += result.main || 0;
		summary.plain += result.plain || 0;
		summary.byPalette[result.paletteId] = (summary.byPalette[result.paletteId] || 0) + 1;
	}
	return summary;
}

/**
 * Stashes each mesh's original material once, so auto-texturing stays reversible.
 * @param {import('three').Object3D} root
 */
function rememberOriginalMaterials(root) {
	root.traverse((child) => {
		if (!child.isMesh && !child.isInstancedMesh) return;
		if (child.userData.originalMaterial !== undefined) return;
		child.userData.originalMaterial = child.material;
	});
}

/**
 * Puts back the materials an object had before it was first auto-textured.
 * @param {import('three').Object3D} root
 * @returns {number} Meshes restored.
 */
export function restoreOriginalMaterials(root) {
	if (!root) return 0;
	let restored = 0;
	root.traverse((child) => {
		if (!child.isMesh && !child.isInstancedMesh) return;
		const original = child.userData.originalMaterial;
		if (original === undefined) return;
		child.material = original;
		delete child.userData.autoTexturePaletteId;
		restored += 1;
	});
	if (restored > 0) delete root.userData.autoTexturePaletteId;
	return restored;
}

/**
 * Preview swatch for a palette — a small canvas showing the real generated texture, for palette
 * pickers and documentation.
 * @param {string} paletteId
 * @param {number} [size]
 * @returns {HTMLCanvasElement|OffscreenCanvas|null}
 */
export function paletteSwatch(paletteId, size = 64) {
	const material = getPaletteMaterial(paletteId, { size });
	return material?.map?.image || null;
}

/**
 * Turkish summary line for the editor toast.
 * @param {ReturnType<typeof autoTextureObject>} result
 * @returns {string}
 */
export function describeResult(result) {
	if (!result?.ok) return result?.error || 'Doku giydirilemedi.';
	const detail = [];
	// Report the three mechanisms separately — "3 mesh" hides whether parts were actually identified
	// or the figure just got a single colour, which is exactly the difference that matters here.
	if (result.named) {
		const slots = Object.keys(result.slots || {});
		detail.push(`${result.named} adlandırılmış parça${slots.length ? ` (${slots.join(', ')})` : ''}`);
	}
	if (result.banded) detail.push(`${result.banded} katmanlı gövde`);
	if (result.main) detail.push(`${result.main} ana yüzey`);
	if (result.plain) detail.push(`${result.plain} tek doku`);
	const kit = result.kit ? `${result.kit} kiti · ` : '';
	return `${result.label} giydirildi (${kit}${result.reason}${detail.length ? ' · ' + detail.join(', ') : ''}).`;
}