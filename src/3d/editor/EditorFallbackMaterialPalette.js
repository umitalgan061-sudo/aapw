const HUE_FAMILY_COUNT = 24;
const SATURATION_BANDS = Object.freeze([0.30, 0.38, 0.46]);
const LIGHTNESS_BANDS = Object.freeze([0.34, 0.44, 0.54, 0.64]);

function hslToHex(hueDegrees, saturation, lightness) {
  const hue = ((((hueDegrees % 360) + 360) % 360) / 60);
  const chroma = (1 - Math.abs((2 * lightness) - 1)) * saturation;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;
  if (hue < 1) [red, green, blue] = [chroma, x, 0];
  else if (hue < 2) [red, green, blue] = [x, chroma, 0];
  else if (hue < 3) [red, green, blue] = [0, chroma, x];
  else if (hue < 4) [red, green, blue] = [0, x, chroma];
  else if (hue < 5) [red, green, blue] = [x, 0, chroma];
  else [red, green, blue] = [chroma, 0, x];
  const match = lightness - (chroma / 2);
  const channel = (value) => Math.max(0, Math.min(255, Math.round((value + match) * 255)));
  return (channel(red) << 16) | (channel(green) << 8) | channel(blue);
}

const FALLBACK_COLOR_FAMILIES = Object.freeze(
  Array.from({ length: HUE_FAMILY_COUNT }, (_, familyIndex) => Object.freeze(
    SATURATION_BANDS.flatMap((saturation) => LIGHTNESS_BANDS.map((lightness) =>
      hslToHex(familyIndex * (360 / HUE_FAMILY_COUNT), saturation, lightness)
    ))
  ))
);
const FALLBACK_COLORS = Object.freeze(FALLBACK_COLOR_FAMILIES.flat());

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

function selectFallbackColor(asset, child, materialIndex) {
  const assetKey = String(asset.id || asset.name || 'fbx');
  const familyIndex = hashString(assetKey) % FALLBACK_COLOR_FAMILIES.length;
  const family = FALLBACK_COLOR_FAMILIES[familyIndex];
  const toneKey = `${child.name || child.uuid || 'mesh'}:${materialIndex}`;
  return family[hashString(toneKey) % family.length];
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
      changed = true;
      return tintedMaterial(material, selectFallbackColor(asset, child, materialIndex));
    });
    if (!changed) return;
    child.material = Array.isArray(child.material) ? nextMaterials : nextMaterials[0];
    child.userData.editorFallbackPalette = true;
    tintedMeshes += 1;
  });
  return Object.freeze({ tintedMeshes });
}

export const EDITOR_FALLBACK_MATERIAL_PALETTE = Object.freeze({
  families: FALLBACK_COLOR_FAMILIES,
  colors: FALLBACK_COLORS,
  familyCount: HUE_FAMILY_COUNT,
  tonesPerFamily: SATURATION_BANDS.length * LIGHTNESS_BANDS.length,
  grayscaleSaturationThreshold: 0.12,
  minimumBrightness: 0.18
});

// Run259 exact-head checkpoint: 288 coordinated fallback colors, deterministically assigned.
