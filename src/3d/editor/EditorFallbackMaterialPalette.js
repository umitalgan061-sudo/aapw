const FALLBACK_COLORS = Object.freeze([
  0x744639,
  0x8c4836,
  0xa54a31,
  0xb5604a,
  0xc7664d,
  0xb68072,
  0xcb8472,
  0x745c39,
  0x8c6836,
  0xa57531,
  0xb5894a,
  0xc7944d,
  0xb69a72,
  0xcba672,
  0x747239,
  0x8c8836,
  0xa5a031,
  0xb5b14a,
  0xc7c24d,
  0xb6b372,
  0xcbc772,
  0x607439,
  0x6f8c36,
  0x7ea531,
  0x91b54a,
  0x9ec74d,
  0x9fb672,
  0xadcb72,
  0x4a7439,
  0x4f8c36,
  0x53a531,
  0x69b54a,
  0x70c74d,
  0x86b672,
  0x8bcb72,
  0x39743e,
  0x368c3e,
  0x31a53b,
  0x4ab553,
  0x4dc757,
  0x72b677,
  0x72cb79,
  0x397454,
  0x368c5d,
  0x31a566,
  0x4ab57b,
  0x4dc785,
  0x72b691,
  0x72cb9b,
  0x39746a,
  0x368c7d,
  0x31a592,
  0x4ab5a3,
  0x4dc7b3,
  0x72b6ab,
  0x72cbbc,
  0x396874,
  0x367a8c,
  0x318da5,
  0x4a9fb5,
  0x4dadc7,
  0x72a8b6,
  0x72b8cb,
  0x395274,
  0x365a8c,
  0x3161a5,
  0x4a76b5,
  0x4d7fc7,
  0x728eb6,
  0x7297cb,
  0x393c74,
  0x363a8c,
  0x3136a5,
  0x4a4eb5,
  0x4d52c7,
  0x7274b6,
  0x7275cb,
  0x4d3974,
  0x53368c,
  0x5831a5,
  0x6e4ab5,
  0x764dc7,
  0x8972b6,
  0x8f72cb,
  0x633974,
  0x73368c,
  0x8331a5,
  0x964ab5,
  0xa34dc7,
  0xa272b6,
  0xb172cb,
  0x74396f,
  0x8c3684,
  0xa5319b,
  0xb54aac,
  0xc74dbc,
  0xb672b0,
  0xcb72c3,
  0x743959,
  0x8c3664,
  0xa53170,
  0xb54a84,
  0xc74d8f,
  0xb67297,
  0xcb72a2,
  0x743943,
  0x8c3644,
  0xa53144,
  0xb54a5c,
  0xc74d61,
  0xb6727d,
  0xcb7280,
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