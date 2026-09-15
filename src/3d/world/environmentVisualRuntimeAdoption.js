/**
 * Runtime-facing visual adoption for the shipped scene.
 *
 * This module is deliberately DOM-free and does not create geometry. It improves
 * readability of already-created terrain, water and atmosphere objects while
 * preserving canonical terrain/hydrology/collider ownership.
 */

const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const clamp01 = (value) => Math.min(1, Math.max(0, finite(value)));
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));

function materialList(root) {
  if (!root) return [];
  const materials = [];
  root.traverse?.((node) => {
    const material = node?.material;
    if (Array.isArray(material)) materials.push(...material.filter(Boolean));
    else if (material) materials.push(material);
  });
  return materials;
}

function patchMaterial(material, profile) {
  if (!material || typeof material !== 'object') return false;
  const before = {
    roughness: finite(material.roughness, 0.7),
    metalness: finite(material.metalness, 0),
    opacity: finite(material.opacity, 1),
  };
  material.roughness = clamp(before.roughness * profile.roughnessMultiplier, 0.22, 0.98);
  material.metalness = clamp(before.metalness, 0, 0.18);
  if ('opacity' in material) material.opacity = clamp(before.opacity * profile.opacityMultiplier, 0.38, 1);
  if ('transparent' in material && material.opacity < 0.995) material.transparent = true;
  material.userData = {
    ...(material.userData ?? {}),
    buzulVisualRuntimeAdoption: Object.freeze({
      roughness: material.roughness,
      opacity: material.opacity,
      antiTilingPhase: profile.antiTilingPhase,
      normalEnergy: profile.normalEnergy,
    }),
  };
  material.needsUpdate = true;
  return true;
}

function applyFogReadability(scene, profile) {
  if (!scene) return false;
  const fog = scene.fog;
  if (!fog) return false;
  if ('near' in fog) fog.near = clamp(fog.near, 1, profile.fogFar * 0.72);
  if ('far' in fog) fog.far = Math.max(profile.fogFar, finite(fog.far, profile.fogFar));
  if ('density' in fog) fog.density = clamp(fog.density, 0.0002, 0.018);
  return true;
}

export function deriveEnvironmentVisualProfile({
  isMobileClass = false,
  cameraDistanceMeters = 1200,
  waterCoverage = 0.35,
  snowCoverage = 0.18,
  relief = 0.5,
  blackSkyRisk = false,
  framePressure = 0,
} = {}) {
  const distance = clamp(cameraDistanceMeters, 20, 20000);
  const reliefSignal = clamp01(relief);
  const waterSignal = clamp01(waterCoverage);
  const snowSignal = clamp01(snowCoverage);
  const pressure = clamp01(framePressure);
  const microFade = isMobileClass ? 0.62 : 1;
  const profile = {
    roughnessMultiplier: 0.98 + reliefSignal * 0.12 + snowSignal * 0.03,
    opacityMultiplier: 1 - waterSignal * 0.04,
    normalEnergy: clamp(0.78 * microFade * (1 - distance / 24000), 0.22, 0.82),
    antiTilingPhase: Number(((distance * 0.00073 + reliefSignal * 0.37 + snowSignal * 0.19) % 1).toFixed(6)),
    fogFar: clamp(isMobileClass ? 9000 : 15000, 2500, 18000),
    exposureFloor: blackSkyRisk ? 0.88 : 0.72,
    vegetationDensityScale: clamp((1 - pressure * 0.42) * (0.94 + reliefSignal * 0.12), 0.45, 1.12),
    waterMicroNormalScale: clamp((1 - waterSignal * 0.18) * microFade, 0.32, 1),
    targets: Object.freeze({
      visibleGrid: 0,
      visibleSeam: 0,
      rectangularWaterBlocks: 0,
      waterMoire: 0,
      blackSky: 0,
      floatingVegetation: 0,
    }),
  };
  return Object.freeze(profile);
}

export function applyEnvironmentVisualRuntimeAdoption({
  scene,
  water,
  naturalGeology,
  vegetation,
  roads,
  camera,
  isMobileClass = false,
  observations = {},
} = {}) {
  const profile = deriveEnvironmentVisualProfile({
    isMobileClass,
    cameraDistanceMeters: camera?.position?.length?.() ?? 1200,
    waterCoverage: observations.waterCoverage,
    snowCoverage: observations.snowCoverage,
    relief: observations.relief,
    blackSkyRisk: observations.blackSkyRisk,
    framePressure: observations.framePressure,
  });
  const patched = {
    water: 0,
    geology: 0,
    vegetation: 0,
    roads: 0,
  };
  for (const material of materialList(water)) if (patchMaterial(material, { ...profile, roughnessMultiplier: profile.roughnessMultiplier + 0.02, opacityMultiplier: profile.opacityMultiplier, })) patched.water += 1;
  for (const material of materialList(naturalGeology)) if (patchMaterial(material, profile)) patched.geology += 1;
  for (const material of materialList(vegetation)) if (patchMaterial(material, { ...profile, roughnessMultiplier: profile.roughnessMultiplier - 0.03, })) patched.vegetation += 1;
  for (const material of materialList(roads)) if (patchMaterial(material, { ...profile, roughnessMultiplier: profile.roughnessMultiplier + 0.08, })) patched.roads += 1;
  applyFogReadability(scene, profile);
  if (scene) {
    scene.userData = {
      ...(scene.userData ?? {}),
      buzulVisualRuntimeAdoption: Object.freeze({ profile, patched: Object.freeze({ ...patched }) }),
    };
  }
  return Object.freeze({ profile, patched: Object.freeze(patched) });
}

export const __private__ = Object.freeze({ materialList, patchMaterial, applyFogReadability });
