import * as THREE from 'three';
import {
  createMaterialManifest,
  validateMaterialAssignment,
} from '../materials/MaterialAssignmentCore.js';

/**
 * Material-adoption policy for the existing kingdom-seat castle assets.
 *
 * Real GLB materials stay authoritative whenever they carry authored PBR maps. Geometry-only or
 * flat-material exports retain the existing seeded procedural-stone fallback supplied by
 * `settlements.js`. This is deliberately an adoption layer, not a second texture framework: shared
 * MaterialAssignmentCore remains the validator/manifest authority and no editor DOM code is used.
 */
export const CASTLE_MATERIAL_FIDELITY_POLICY = Object.freeze({
  id: 'castle-authored-material-fidelity-2026-09-01-v1',
  preservesAuthoredPbrMaps: true,
  generatedFallbackOnlyWhenUntextured: true,
  perSeatMaterialIsolation: true,
  sharedGeometryPreserved: true,
  sharedMaterialValidator: 'MaterialAssignmentCore',
  renderOnly: true,
  geographyAuthorityUnchanged: true,
  terrainHeightAuthorityUnchanged: true,
  colliderAuthorityUnchanged: true,
});

export const CASTLE_REGIONAL_SURFACE_PROFILES = Object.freeze({
  arctic: Object.freeze({ tintStrength: 0.10, roughnessFloor: 0.72, tintHex: 0xdce8ef }),
  maritime: Object.freeze({ tintStrength: 0.09, roughnessFloor: 0.76, tintHex: 0xaeb8b7 }),
  fertile: Object.freeze({ tintStrength: 0.07, roughnessFloor: 0.70, tintHex: 0xc4bba0 }),
  temperate: Object.freeze({ tintStrength: 0.06, roughnessFloor: 0.70, tintHex: 0xb8b2a5 }),
  arid: Object.freeze({ tintStrength: 0.11, roughnessFloor: 0.78, tintHex: 0xd0ab78 }),
  volcanic: Object.freeze({ tintStrength: 0.05, roughnessFloor: 0.74, tintHex: 0x81726c }),
});

const AUTHORED_PBR_MAP_FIELDS = Object.freeze([
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
  'lightMap',
  'displacementMap',
]);

export function authoredPbrMapSlots(material) {
  if (!material || typeof material !== 'object') return [];
  return AUTHORED_PBR_MAP_FIELDS.filter((field) => Boolean(material[field]?.isTexture));
}

export function hasAuthoredCastlePbr(material) {
  return authoredPbrMapSlots(material).length > 0;
}

function resolvedProfile(profileId) {
  return CASTLE_REGIONAL_SURFACE_PROFILES[profileId] ?? CASTLE_REGIONAL_SURFACE_PROFILES.temperate;
}

function applyRegionalResponse(material, { profileId, stoneColorHex }) {
  const profile = resolvedProfile(profileId);
  if (material?.color?.isColor) {
    const regionalTint = new THREE.Color(profile.tintHex);
    if (Number.isFinite(stoneColorHex)) {
      const seatTint = new THREE.Color(stoneColorHex);
      regionalTint.lerp(seatTint, 0.45);
    }
    // Keep authored albedo dominant. This is a weak multiplicative cast, not a recolour/repaint.
    regionalTint.lerp(new THREE.Color(0xffffff), 0.68);
    material.color.lerp(material.color.clone().multiply(regionalTint), profile.tintStrength);
  }
  // Do not flatten authored metal trims. Only stone-like, non-metallic slots receive the weathered
  // roughness floor; map identity and authored scalar variation remain intact.
  if (!material?.metalnessMap && Number(material?.metalness ?? 0) < 0.35 && Number.isFinite(material?.roughness)) {
    material.roughness = Math.max(profile.roughnessFloor, Math.min(1, material.roughness));
  }
}

function cloneAuthoredMaterial(source, context) {
  const clone = source.clone();
  const slots = authoredPbrMapSlots(source);
  applyRegionalResponse(clone, context);
  clone.userData = {
    ...clone.userData,
    castleMaterialFidelity: Object.freeze({
      policyId: CASTLE_MATERIAL_FIDELITY_POLICY.id,
      source: 'authored-pbr',
      profileId: context.profileId,
      seatId: context.seatId,
      preservedMapSlots: Object.freeze([...slots]),
    }),
  };
  return clone;
}

function tagGeneratedFallback(material, context) {
  if (!material) return material;
  material.userData = {
    ...material.userData,
    castleMaterialFidelity: Object.freeze({
      policyId: CASTLE_MATERIAL_FIDELITY_POLICY.id,
      source: 'generated-stone-fallback',
      profileId: context.profileId,
      seatId: context.seatId,
      preservedMapSlots: Object.freeze([]),
    }),
  };
  return material;
}

/**
 * Clone/adopt materials for one already-loaded castle model.
 *
 * @param {THREE.Object3D} root
 * @param {object} options
 * @param {string} options.seatId
 * @param {string} options.assetId
 * @param {string} options.src
 * @param {string} options.profileId
 * @param {number} options.stoneColorHex
 * @param {() => THREE.Material} options.createFallbackMaterial lazy per-seat generated-stone factory
 * @param {(material: THREE.Material) => THREE.Material} [options.decorateMaterial] optional existing
 *   seat-specific shader/weathering hook (Valyria uses this).
 */
export function applyCastleMaterialFidelity(root, {
  seatId,
  assetId,
  src,
  profileId = 'temperate',
  stoneColorHex,
  createFallbackMaterial,
  decorateMaterial = null,
} = {}) {
  if (!root?.traverse || typeof createFallbackMaterial !== 'function') {
    return { ok: false, error: 'invalid-castle-material-input' };
  }

  const context = { seatId: String(seatId ?? ''), profileId, stoneColorHex };
  let fallback = null;
  let authoredMaterialCount = 0;
  let generatedFallbackCount = 0;
  const preservedMapSlots = new Set();

  root.traverse((node) => {
    if (!node?.isMesh) return;
    const sourceMaterials = Array.isArray(node.material) ? node.material : [node.material];
    const adopted = sourceMaterials.map((source) => {
      let material;
      if (hasAuthoredCastlePbr(source)) {
        material = cloneAuthoredMaterial(source, context);
        authoredMaterialCount += 1;
        for (const slot of authoredPbrMapSlots(source)) preservedMapSlots.add(slot);
      } else {
        fallback ??= tagGeneratedFallback(createFallbackMaterial(), context);
        material = fallback;
        generatedFallbackCount += 1;
      }
      return typeof decorateMaterial === 'function' ? (decorateMaterial(material) ?? material) : material;
    });
    node.material = Array.isArray(node.material) ? adopted : adopted[0];
  });

  const validation = validateMaterialAssignment(root, { requireGeneratedTexture: false });
  if (!validation.ok) return { ok: false, error: validation.errors.join(','), validation };
  const manifest = createMaterialManifest(root, {
    metadata: { id: assetId, category: 'settlement-castle', src },
  });
  root.userData.castleMaterialManifest = manifest;
  root.userData.castleMaterialFidelity = Object.freeze({
    policyId: CASTLE_MATERIAL_FIDELITY_POLICY.id,
    seatId: context.seatId,
    profileId,
    authoredMaterialCount,
    generatedFallbackCount,
    preservedMapSlots: Object.freeze([...preservedMapSlots].sort()),
  });

  return {
    ok: true,
    validation,
    manifest,
    authoredMaterialCount,
    generatedFallbackCount,
    preservedMapSlots: [...preservedMapSlots].sort(),
  };
}
