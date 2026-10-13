export const WATER_PHOTOREALISM_RUNTIME_PATCH_POLICY = Object.freeze({
  id: 'water-world-space-antimoire-2026-10-13-v1',
  renderOnly: true,
  canonicalDepthUnchanged: true,
  canonicalCoverageUnchanged: true,
  replacesPeriodicMicroCarriers: true,
  patchedFamilies: Object.freeze(['offshore-micro-slope', 'near-water-ripple', 'shoreline-foam-surge']),
});

const REPLACEMENTS = Object.freeze([
  ['float warp = sin(dot(worldXZ, vec2(0.0067, -0.0051)) + shear * 1.35 + time * 0.075);',
   'float warp = (waterSurfaceNoise(worldXZ * mat2(0.83, -0.56, 0.56, 0.83) / 510.0 + vec2(time * 0.0018, -time * 0.0011)) - 0.5) * 2.0;'],
  ['float c1 = sin(dot(worldXZ, vec2(0.041, 0.018)) + warp * 0.62 + time * 0.46);',
   'float c1 = (waterSurfaceNoise((worldXZ * mat2(0.83, -0.56, 0.56, 0.83) + vec2(warp * 170.0, shear * 65.0)) / 67.0 + vec2(8.7, -14.1)) - 0.5) * 2.0;'],
  ['float c2 = sin(dot(worldXZ, vec2(-0.024, 0.049)) - warp * 0.47 - time * 0.38);',
   'float c2 = (waterSurfaceNoise((worldXZ * mat2(0.47, 0.88, -0.88, 0.47) + vec2(-warp * 115.0, shear * 52.0)) / 123.0 + vec2(-19.4, 5.8)) - 0.5) * 2.0;'],
  ['float c3 = sin(dot(worldXZ, vec2(0.017, -0.031)) + shear * 0.92 + time * 0.27);',
   'float c3 = (waterSurfaceNoise((worldXZ + vec2(shear * 120.0, -shear * 85.0)) / 190.0 + vec2(3.1, 21.7)) - 0.5) * 2.0;'],
  ['float c4 = sin(dot(worldXZ, vec2(0.071, -0.056)) + warp * 0.24 - time * 0.62);',
   'float c4 = (waterSurfaceNoise((worldXZ * mat2(0.61, 0.79, -0.79, 0.61) + vec2(warp * 58.0, -time * 2.4)) / 47.0 + vec2(-7.9, 12.6)) - 0.5) * 2.0;'],
  ['float warp = sin(dot(worldXZ, vec2(0.014, -0.011)) + time * 0.07);',
   'float warp = (waterSurfaceNoise(worldXZ * mat2(0.76, -0.65, 0.65, 0.76) / 132.0 + vec2(time * 0.018, -time * 0.013)) - 0.5) * 2.0;'],
  ['float r1 = sin(dot(worldXZ, vec2(0.095, 0.061)) + warp * 0.75 + time * 0.55);',
   'float r1 = (waterSurfaceNoise((worldXZ * mat2(0.76, -0.65, 0.65, 0.76) + vec2(warp * 34.0, -warp * 21.0)) / 31.0 + vec2(11.8, -6.2)) - 0.5) * 2.0;'],
  ['float r2 = sin(dot(worldXZ, vec2(-0.052, 0.083)) - warp * 0.42 - time * 0.41);',
   'float r2 = (waterSurfaceNoise((worldXZ * mat2(0.52, 0.85, -0.85, 0.52) + vec2(time * 2.8, -time * 1.9)) / 47.0 + vec2(-15.3, 9.4)) - 0.5) * 2.0;'],
  ['float r3 = sin(dot(worldXZ, vec2(0.031, -0.044)) + warp * 0.58 + time * 0.29);',
   'float r3 = (waterSurfaceNoise((worldXZ + vec2((r1 - 0.5) * 26.0, (r2 - 0.5) * 19.0)) / 76.0 + vec2(4.6, 18.2)) - 0.5) * 2.0;'],
  ['float surfA = sin(dot(vWorldPosition.xz, vec2(0.018, -0.013)) + uTime * 0.55);',
   'float surfA = waterSurfaceNoise(vWorldPosition.xz / 173.0 + vec2(uTime * 0.009, -uTime * 0.006));'],
  ['float surfB = sin(dot(vWorldPosition.xz, vec2(-0.009, 0.021)) - uTime * 0.37);',
   'float surfB = waterSurfaceNoise((vWorldPosition.xz * mat2(0.73, -0.68, 0.68, 0.73) + vec2(uTime * 8.0, -uTime * 5.0)) / 61.0 + vec2(13.4, -9.2));'],
  ['float surge = clamp(0.62 + 0.22 * surfA + 0.16 * surfB, 0.18, 1.0);',
   'float foamFine = waterSurfaceNoise((vWorldPosition.xz * mat2(0.49, 0.87, -0.87, 0.49) + vec2(-uTime * 4.5, uTime * 3.2)) / 23.0 + vec2(-17.6, 4.9));\n\t\tfloat foamDistanceFade = 1.0 - smoothstep(180.0, 700.0, distance(uCameraPosition, vWorldPosition));\n\t\tfloat surge = clamp(0.28 + surfA * 0.38 + surfB * 0.24 + foamFine * 0.10, 0.18, 1.0);\n\t\tsurge = mix(0.58, surge, foamDistanceFade);'],
]);

function patchMaterial(material) {
  if (!material || typeof material.fragmentShader !== 'string') return Object.freeze({ status: 'unsupported-material', replaced: 0 });
  if (material.userData?.waterPhotorealismPatch?.policyId === WATER_PHOTOREALISM_RUNTIME_PATCH_POLICY.id) {
    return material.userData.waterPhotorealismPatch;
  }
  let shader = material.fragmentShader;
  const before = shader;
  const applied = [];
  for (const [search, replacement] of REPLACEMENTS) {
    if (shader.includes(search)) {
      shader = shader.replace(search, replacement);
      applied.push(search.startsWith('float c') || search.startsWith('float warp = sin(dot(worldXZ, vec2(0.0067') ? 'offshore-micro-slope'
        : search.startsWith('float r') || search.startsWith('float warp = sin(dot(worldXZ, vec2(0.014') ? 'near-water-ripple'
        : 'shoreline-foam-surge');
    }
  }
  if (shader !== before) {
    material.fragmentShader = shader;
    material.needsUpdate = true;
  }
  const uniqueFamilies = Object.freeze([...new Set(applied)]);
  const status = Object.freeze({
    policyId: WATER_PHOTOREALISM_RUNTIME_PATCH_POLICY.id,
    status: uniqueFamilies.length === 3 ? 'active' : uniqueFamilies.length > 0 ? 'partial' : 'unavailable',
    replacedStatements: applied.length,
    patchedFamilies: uniqueFamilies,
    canonicalDepthUnchanged: true,
    canonicalCoverageUnchanged: true,
    shaderChanged: shader !== before,
  });
  material.userData ||= {};
  material.userData.waterPhotorealismPatch = status;
  return status;
}

/** Runtime-only anti-moiré treatment for the existing near and far water ShaderMaterials. */
export function applyWaterPhotorealismRuntimePatch(waterMesh) {
  if (!waterMesh?.material) return waterMesh;
  const near = patchMaterial(waterMesh.material);
  const far = waterMesh.userData?.farWater?.material ? patchMaterial(waterMesh.userData.farWater.material) : null;
  const statuses = [near, far].filter(Boolean).map((entry) => entry.status);
  const status = statuses.every((entry) => entry === 'active') ? 'active'
    : statuses.some((entry) => entry === 'active' || entry === 'partial') ? 'partial' : 'unavailable';
  waterMesh.userData.waterPhotorealismRuntimePatch = Object.freeze({
    policyId: WATER_PHOTOREALISM_RUNTIME_PATCH_POLICY.id,
    status, near, far,
    renderOnly: true, canonicalDepthUnchanged: true, canonicalCoverageUnchanged: true,
  });
  if (waterMesh.userData.opticalProfile) {
    waterMesh.userData.opticalProfile = Object.freeze({
      ...waterMesh.userData.opticalProfile,
      runtimeAntiMoirePolicyId: WATER_PHOTOREALISM_RUNTIME_PATCH_POLICY.id,
      runtimeAntiMoireStatus: status,
    });
  }
  return waterMesh;
}
