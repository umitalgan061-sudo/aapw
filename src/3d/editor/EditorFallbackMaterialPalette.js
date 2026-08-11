const FALLBACK_COLORS = Object.freeze([
  0x6f7f5f,
  0x8b6f47,
  0x5f7088,
  0x7f5f5f,
  0x6f5f82,
  0x7c7658,
  0x596f6b,
  0x74655a
]);

function hashString(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shouldTintMaterial(material) {
  if (!material?.color || material.map || material.vertexColors) return false;
  const { r, g, b } = material.color;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max > 0 ? (max - min) / max : 0;
  return saturation < 0.12 && max > 0.18;
}

function tintedMaterial(material, colorHex) {
  const clone = material.clone();
  clone.color.setHex(colorHex);
  clone.needsUpdate = true;
  return clone;
}

export function applyEditorFallbackMaterialPalette(root, asset) {
  if (!root?.traverse || asset?.format !== 'fbx') return Object.freeze({ tintedMeshes: 0 });
  let tintedMeshes = 0;
  root.traverse((child) => {
    if (!child?.isMesh || !child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    let changed = false;
    const nextMaterials = materials.map((material, materialIndex) => {
      if (!shouldTintMaterial(material)) return material;
      const key = `${asset.id || asset.name || 'fbx'}:${child.name || child.uuid || 'mesh'}:${materialIndex}`;
      const colorHex = FALLBACK_COLORS[hashString(key) % FALLBACK_COLORS.length];
      changed = true;
      return tintedMaterial(material, colorHex);
    });
    if (!changed) return;
    child.material = Array.isArray(child.material) ? nextMaterials : nextMaterials[0];
    child.userData.editorFallbackPalette = true;
    tintedMeshes += 1;
  });
  return Object.freeze({ tintedMeshes });
}

export const EDITOR_FALLBACK_MATERIAL_PALETTE = Object.freeze({
  colors: FALLBACK_COLORS,
  grayscaleSaturationThreshold: 0.12,
  minimumBrightness: 0.18
});
