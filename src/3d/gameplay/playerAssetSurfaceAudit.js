/**
 * Player asset readiness/audit helpers.
 *
 * This is not a second material system. MaterialAssignmentCore remains the sole authority for material
 * assignment and validation. This adapter only observes the resulting mesh/material topology and records
 * whether a shipped asset has enough surface diversity to avoid a monochrome runtime presentation.
 *
 * Filesystem/LFS byte checks intentionally live in proof scripts, not this browser-runtime module.
 *
 * @module gameplay/playerAssetSurfaceAudit
 */

import { analyzeMaterialSurfaces, validateMaterialAssignment } from '../materials/MaterialAssignmentCore.js';

const AUDIT_VERSION = '2026-09-07-v1';
const SURFACE_ROLE_ALIASES = Object.freeze({
  skin: ['skin', 'body', 'face', 'head', 'arm', 'hand'],
  hair: ['hair', 'brow', 'beard', 'mustache'],
  eye: ['eye', 'iris', 'pupil'],
  cloth: ['cloth', 'shirt', 'tunic', 'robe', 'dress', 'jacket', 'sleeve', 'trousers', 'pants'],
  leather: ['leather', 'belt', 'strap', 'boot', 'shoe', 'scabbard'],
  metal: ['metal', 'steel', 'iron', 'plate', 'blade', 'mail'],
  clothAccent: ['cloak', 'cape', 'hood', 'trim'],
  weapon: ['sword', 'axe', 'bow', 'weapon', 'shield', 'dagger'],
});

function walk(root, visitor) {
  if (!root) return;
  visitor(root);
  if (!Array.isArray(root.children)) return;
  for (const child of root.children) walk(child, visitor);
}

function stringsForNode(node) {
  const parts = [node?.name, node?.userData?.name, node?.userData?.assetId];
  return parts.filter(Boolean).map((value) => String(value).toLowerCase());
}

function materialArray(node) {
  if (!node) return [];
  return Array.isArray(node.material) ? node.material.filter(Boolean) : node.material ? [node.material] : [];
}

function mapKeys(material) {
  return ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'].filter((key) => Boolean(material?.[key]));
}

function roleForStrings(strings) {
  const joined = strings.join(' ');
  for (const [role, aliases] of Object.entries(SURFACE_ROLE_ALIASES)) {
    if (aliases.some((alias) => joined.includes(alias))) return role;
  }
  return 'unclassified';
}

function collectNodeSurfaceRecords(root) {
  const records = [];
  walk(root, (node) => {
    if (!node?.isMesh) return;
    const nodeStrings = stringsForNode(node);
    const nodeRole = roleForStrings(nodeStrings);
    const materials = materialArray(node);
    if (!materials.length) {
      records.push(Object.freeze({ node: node?.name || null, role: nodeRole, material: null, textureKeys: [], textureSize: null }));
      return;
    }
    materials.forEach((material, index) => {
      const strings = [...nodeStrings, material?.name].filter(Boolean).map((value) => String(value).toLowerCase());
      records.push(Object.freeze({
        node: node?.name || null,
        role: roleForStrings(strings),
        material: material?.name || `material-${index}`,
        textureKeys: Object.freeze(mapKeys(material)),
        textureSize: inferTextureSize(material),
        roughness: finiteNumber(material?.roughness),
        metalness: finiteNumber(material?.metalness),
      }));
    });
  });
  return records;
}

function finiteNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function inferTextureSize(material) {
  const textures = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'];
  for (const key of textures) {
    const image = material?.[key]?.image;
    const width = finiteNumber(image?.width);
    const height = finiteNumber(image?.height);
    if (width && height) return Object.freeze({ key, width, height });
  }
  return null;
}

function uniqueRoles(records) {
  return new Set(records.map((record) => record.role).filter((role) => role && role !== 'unclassified'));
}

function textureResponse(records) {
  const total = records.length;
  const mapped = records.filter((record) => record.textureKeys.includes('map')).length;
  const normal = records.filter((record) => record.textureKeys.includes('normalMap')).length;
  return Object.freeze({
    records: total,
    diffuseMapped: mapped,
    normalMapped: normal,
    diffuseRatio: total ? mapped / total : 0,
    normalRatio: total ? normal / total : 0,
  });
}

function monochromeRisk(records, validation) {
  const roles = uniqueRoles(records);
  const materialNames = new Set(records.map((record) => record.material).filter(Boolean));
  if (validation?.warnings?.some((warning) => /single material|single surface|monochrome/i.test(String(warning)))) return true;
  return roles.size <= 1 && materialNames.size <= 1;
}

export function inspectPlayerSurfaceTopology(object3D) {
  if (!object3D) throw new TypeError('player asset object3D is required');
  const records = collectNodeSurfaceRecords(object3D);
  const renderStats = {
    meshCount: records.length,
    materialCount: new Set(records.map((record) => record.material).filter(Boolean)).size,
    namedSurfaceCount: records.filter((record) => record.node).length,
  };
  const roles = [...uniqueRoles(records)].sort();
  const textures = textureResponse(records);
  return Object.freeze({
    auditVersion: AUDIT_VERSION,
    records: Object.freeze(records),
    renderStats: Object.freeze(renderStats),
    roles: Object.freeze(roles),
    textureResponse: textures,
    layeredFallbackRecommended: roles.length <= 1 || renderStats.materialCount <= 1,
    monochromeRisk: monochromeRisk(records, null),
  });
}

export function inspectPlayerMaterialAssignment(object3D) {
  if (!object3D) throw new TypeError('player asset object3D is required');
  const topology = inspectPlayerSurfaceTopology(object3D);
  const validation = validateMaterialAssignment(object3D, { requireGeneratedTexture: true });
  return Object.freeze({
    ok: validation.ok,
    errors: Object.freeze([...validation.errors]),
    warnings: Object.freeze([...validation.warnings]),
    topology,
    materialAssignment: Object.freeze({
      meshCount: validation.meshCount,
      surfaceCount: validation.surfaceCount,
      materialSlotCount: validation.materialSlotCount,
      generatedMaterialCount: validation.generatedMaterialCount,
    }),
    monochromeRisk: monochromeRisk(topology.records, validation),
  });
}

export function inspectPlayerAssetSurfaceReadiness(object3D, {
  assetId = object3D?.userData?.assetId || 'player',
  assetSrc = object3D?.userData?.assetSrc || null,
  expectedTextureSize = 256,
  requireNamedOrLayered = true,
} = {}) {
  const audit = inspectPlayerMaterialAssignment(object3D);
  const errors = [...audit.errors];
  const topology = audit.topology;
  if (topology.renderStats.meshCount <= 0) errors.push('no-renderable-mesh');
  if (requireNamedOrLayered && audit.monochromeRisk && !topology.layeredFallbackRecommended) errors.push('surface-diversity-missing');
  if (expectedTextureSize && topology.textureResponse.diffuseMapped > 0) {
    const mismatches = topology.records.filter((record) => record.textureSize && (record.textureSize.width !== expectedTextureSize || record.textureSize.height !== expectedTextureSize));
    if (mismatches.length === topology.textureResponse.diffuseMapped) errors.push(`texture-size-unexpected:${expectedTextureSize}`);
  }
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: audit.warnings,
    assetId,
    assetSrc,
    audit,
    expectedTextureSize,
  });
}

export function createPlayerAssetSurfaceManifest({ object3D, assetId, assetSrc, textureSize = 256, hydrated = null, bytes = null } = {}) {
  const readiness = inspectPlayerAssetSurfaceReadiness(object3D, { assetId, assetSrc, expectedTextureSize: textureSize });
  return Object.freeze({
    version: AUDIT_VERSION,
    assetId,
    assetSrc,
    hydrated,
    bytes,
    textureSize,
    meshCount: readiness.audit.topology.renderStats.meshCount,
    materialCount: readiness.audit.topology.renderStats.materialCount,
    surfaceRoles: readiness.audit.topology.roles,
    layeredFallbackRecommended: readiness.audit.topology.layeredFallbackRecommended,
    monochromeRisk: readiness.audit.monochromeRisk,
    diffuseMappedSurfaces: readiness.audit.topology.textureResponse.diffuseMapped,
    normalMappedSurfaces: readiness.audit.topology.textureResponse.normalMapped,
    validationErrors: readiness.errors,
    validationWarnings: readiness.warnings,
  });
}

export function compareSurfaceManifestDeterminism(first, second) {
  const left = JSON.stringify(first);
  const right = JSON.stringify(second);
  return Object.freeze({ ok: left === right, identical: left === right, leftBytes: left.length, rightBytes: right.length });
}

export const PLAYER_ASSET_SURFACE_AUDIT_POLICY = Object.freeze({
  version: AUDIT_VERSION,
  sharedMaterialAuthority: 'src/3d/materials/MaterialAssignmentCore.js',
  sharedPlacementAuthority: 'src/3d/world/WorldAssetPlacementPipeline.js',
  editorImportForbidden: 'src/3d/editor/EditorMaterialStudio.js',
  defaultTextureSize: 256,
  missingAssetsMustBeZero: true,
  consoleErrorsMustBeZero: true,
  lfsPointersMustBeRejected: true,
});
