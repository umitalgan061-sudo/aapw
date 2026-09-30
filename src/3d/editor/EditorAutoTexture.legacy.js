/**
 * Editor-facing compatibility wrappers around the shared material assignment core.
 * Runtime/autonomous world builders use the same core directly; the editor no longer owns a
 * separate material decision path.
 * @module editor/EditorAutoTexture
 */

import { getPaletteMaterial } from '../materials/textureFactory.js';
import { findPalette } from '../materials/palettes.js';
import {
  autoAssignMaterials,
  describeMaterialSubject,
  restoreOriginalMaterials as restoreFromCore,
} from '../materials/MaterialAssignmentCore.js';

export function describeFigure(object, lookupAsset) {
  const assetId = object?.userData?.editorAssetId || '';
  const asset = (typeof lookupAsset === 'function' && assetId) ? lookupAsset(assetId) : null;
  return describeMaterialSubject(object, {
    id: assetId,
    name: object?.name || asset?.name || '',
    category: asset?.category || '',
    src: asset?.src || '',
  });
}

export function autoTextureObject(object, { lookupAsset, paletteId, size } = {}) {
  if (!object) return { ok: false, error: 'Önce bir obje seç.' };
  const metadata = describeFigure(object, lookupAsset);
  const result = autoAssignMaterials(object, {
    metadata,
    paletteId,
    textureSize: size || 256,
  });
  if (!result.ok) return { ok: false, error: materialError(result.error) };
  const resolvedPaletteId = result.paletteId || result.recipe?.basePaletteId;
  return {
    ok: true,
    paletteId: resolvedPaletteId,
    label: findPalette(resolvedPaletteId)?.label || resolvedPaletteId,
    reason: result.recipe?.reason || (paletteId ? 'elle seçildi' : 'otomatik eşleşti'),
    meshes: result.meshes || 0,
    kit: result.kit,
    named: result.named || 0,
    banded: result.banded || 0,
    main: result.main || 0,
    plain: result.plain || 0,
    slots: result.slots || {},
    recipe: result.recipe,
  };
}

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
    summary.named += result.named;
    summary.banded += result.banded;
    summary.main += result.main;
    summary.plain += result.plain;
    summary.byPalette[result.paletteId] = (summary.byPalette[result.paletteId] || 0) + 1;
  }
  return summary;
}

export function restoreOriginalMaterials(root) {
  return restoreFromCore(root);
}

export function paletteSwatch(paletteId, size = 64) {
  const material = getPaletteMaterial(paletteId, { size });
  return material?.map?.image || null;
}

export function describeResult(result) {
  if (!result?.ok) return result?.error || 'Doku giydirilemedi.';
  const detail = [];
  if (result.named) {
    const slots = Object.keys(result.slots || {});
    detail.push(`${result.named} adlandırılmış parça${slots.length ? ` (${slots.join(', ')})` : ''}`);
  }
  if (result.banded) detail.push(`${result.banded} katmanlı gövde`);
  if (result.main) detail.push(`${result.main} ana yüzey`);
  if (result.plain) detail.push(`${result.plain} tek doku`);
  const kit = result.kit ? `${result.kit} kiti · ` : '';
  return `${result.label || result.paletteId} giydirildi (${kit}${result.reason}${detail.length ? ' · ' + detail.join(', ') : ''}).`;
}

function materialError(error) {
  const map = {
    'missing-object-or-recipe': 'Önce bir obje seç.',
    'no-palette-match': 'Bu obje için uygun materyal paleti bulunamadı.',
    'no-dressable-mesh': 'Bu objede giydirilecek mesh yok.',
  };
  return map[error] || `Doku giydirilemedi: ${error || 'bilinmeyen hata'}`;
}
