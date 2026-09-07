/**
 * Runtime material/surface audit for authored scene assets.
 *
 * This module does not create a second material system and never replaces the shared material
 * authority. It normalizes texture color-space flags that can be safely inferred from Three.js
 * material slots, then records a compact audit on the object graph so browser/runtime evidence can
 * prove whether an authored model arrived textured, normal-mapped and physically plausible.
 */
import * as THREE from 'three';

export const RUNTIME_SURFACE_AUDIT_POLICY = Object.freeze({
  id: 'runtime-surface-audit-2026-09-07-v1',
  materialAuthority: 'MaterialAssignmentCore.js',
  normalizeBaseColorColorSpace: THREE.SRGBColorSpace ?? 'srgb',
  normalizeEmissiveColorSpace: THREE.SRGBColorSpace ?? 'srgb',
  nonColorTextureColorSpace: THREE.NoColorSpace ?? '',
  minimumRoughness: 0.18,
  maximumRoughness: 1,
});

function listMaterials(material) {
  if (!material) return [];
  return Array.isArray(material) ? material.filter(Boolean) : [material];
}

function normalizeTexture(texture, colorSpace) {
  if (!texture) return false;
  if ('colorSpace' in texture && texture.colorSpace !== colorSpace) {
    texture.colorSpace = colorSpace;
    texture.needsUpdate = true;
    return true;
  }
  return false;
}

function auditMaterial(material, stats, { normalize = true } = {}) {
  if (!material) return;
  stats.materialCount += 1;
  const baseColorTexture = material.map ?? material.diffuseMap ?? null;
  const emissiveTexture = material.emissiveMap ?? null;
  const normalTexture = material.normalMap ?? null;
  const roughnessTexture = material.roughnessMap ?? null;
  const metalnessTexture = material.metalnessMap ?? null;
  const aoTexture = material.aoMap ?? null;
  const displacementTexture = material.displacementMap ?? null;

  if (baseColorTexture) {
    stats.baseColorMapped += 1;
    if (normalize) stats.normalizedTextureFlags += normalizeTexture(baseColorTexture, RUNTIME_SURFACE_AUDIT_POLICY.normalizeBaseColorColorSpace) ? 1 : 0;
  } else {
    stats.baseColorUnmapped += 1;
  }
  if (emissiveTexture) {
    stats.emissiveMapped += 1;
    if (normalize) stats.normalizedTextureFlags += normalizeTexture(emissiveTexture, RUNTIME_SURFACE_AUDIT_POLICY.normalizeEmissiveColorSpace) ? 1 : 0;
  }
  if (normalTexture) {
    stats.normalMapped += 1;
    if (normalize) stats.normalizedTextureFlags += normalizeTexture(normalTexture, RUNTIME_SURFACE_AUDIT_POLICY.nonColorTextureColorSpace) ? 1 : 0;
  }
  if (roughnessTexture) {
    stats.roughnessMapped += 1;
    if (normalize) stats.normalizedTextureFlags += normalizeTexture(roughnessTexture, RUNTIME_SURFACE_AUDIT_POLICY.nonColorTextureColorSpace) ? 1 : 0;
  }
  if (metalnessTexture) {
    stats.metalnessMapped += 1;
    if (normalize) stats.normalizedTextureFlags += normalizeTexture(metalnessTexture, RUNTIME_SURFACE_AUDIT_POLICY.nonColorTextureColorSpace) ? 1 : 0;
  }
  if (aoTexture) {
    stats.aoMapped += 1;
    if (normalize) stats.normalizedTextureFlags += normalizeTexture(aoTexture, RUNTIME_SURFACE_AUDIT_POLICY.nonColorTextureColorSpace) ? 1 : 0;
  }
  if (displacementTexture) {
    stats.displacementMapped += 1;
    if (normalize) stats.normalizedTextureFlags += normalizeTexture(displacementTexture, RUNTIME_SURFACE_AUDIT_POLICY.nonColorTextureColorSpace) ? 1 : 0;
  }
  if (material.alphaMap) stats.alphaMapped += 1;
  if (material.transparent) stats.transparentMaterials += 1;
  if (material.alphaTest > 0) stats.alphaTestMaterials += 1;

  if (Number.isFinite(material.roughness)) {
    material.roughness = Math.max(
      RUNTIME_SURFACE_AUDIT_POLICY.minimumRoughness,
      Math.min(RUNTIME_SURFACE_AUDIT_POLICY.maximumRoughness, material.roughness),
    );
  }
  if (material.needsUpdate === undefined) material.needsUpdate = true;
}

export function auditRuntimeSurface(object, {
  normalizeTextureColorSpaces = true,
  expectedRole = null,
} = {}) {
  const stats = {
    policyId: RUNTIME_SURFACE_AUDIT_POLICY.id,
    materialAuthority: RUNTIME_SURFACE_AUDIT_POLICY.materialAuthority,
    meshCount: 0,
    materialCount: 0,
    baseColorMapped: 0,
    baseColorUnmapped: 0,
    emissiveMapped: 0,
    normalMapped: 0,
    roughnessMapped: 0,
    metalnessMapped: 0,
    aoMapped: 0,
    displacementMapped: 0,
    alphaMapped: 0,
    transparentMaterials: 0,
    alphaTestMaterials: 0,
    normalizedTextureFlags: 0,
  };
  if (!object?.traverse) return Object.freeze({ ...stats, ok: false, reason: 'missing-object' });

  object.traverse((node) => {
    if (!node?.isMesh) return;
    stats.meshCount += 1;
    for (const material of listMaterials(node.material)) auditMaterial(material, stats, { normalize: normalizeTextureColorSpaces });
    node.userData.runtimeSurfaceRole = expectedRole;
  });

  const texturedMaterialRatio = stats.materialCount > 0 ? stats.baseColorMapped / stats.materialCount : 0;
  const normalMappedMaterialRatio = stats.materialCount > 0 ? stats.normalMapped / stats.materialCount : 0;
  const ok = stats.meshCount > 0 && stats.materialCount > 0;
  const result = Object.freeze({
    ...stats,
    ok,
    reason: ok ? 'surface-audited' : stats.meshCount === 0 ? 'no-renderable-mesh' : 'no-materials',
    texturedMaterialRatio,
    normalMappedMaterialRatio,
    expectedRole,
  });
  object.userData.runtimeSurfaceAudit = result;
  return result;
}

export function summarizeRuntimeSurface(object) {
  return object?.userData?.runtimeSurfaceAudit ?? null;
}
