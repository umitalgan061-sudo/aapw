const OVERSIZED_IMPORT_THRESHOLD = 20;

const TARGET_MAX_DIMENSION_BY_ASSET = Object.freeze({
  'black-dragon': 8,
  paladin: 2,
  'peasant-girl': 1.8
});

/**
 * Returns a deterministic root scale multiplier for externally-authored editor assets.
 * Models exported in centimetres can otherwise arrive tens or hundreds of scene units tall.
 * Small/metre-authored assets are intentionally left untouched.
 *
 * @param {object} asset Editor asset descriptor.
 * @param {number} maxDimension Largest local bounding-box dimension before root scaling.
 * @returns {number} Root scale multiplier.
 */
export function computeEditorAssetImportScale(asset, maxDimension) {
  if (!asset || asset.format === 'primitive') return 1;
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) return 1;
  if (maxDimension <= OVERSIZED_IMPORT_THRESHOLD) return 1;
  const target = TARGET_MAX_DIMENSION_BY_ASSET[asset.id] || 2;
  return target / maxDimension;
}

export const EDITOR_ASSET_SCALE_POLICY = Object.freeze({
  oversizedImportThreshold: OVERSIZED_IMPORT_THRESHOLD,
  targetMaxDimensionByAsset: TARGET_MAX_DIMENSION_BY_ASSET
});
