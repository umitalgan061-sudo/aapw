/**
 * Read-only audit helpers for hydrated environment model materials.
 *
 * The auditor reports what an authored model exposes. It never changes textures, UVs, materials or
 * geometry. Application remains the responsibility of MaterialAssignmentCore.
 */
import { analyzeMaterialSurfaces, describeMaterialSubject } from '../materials/MaterialAssignmentCore.js';
import { surfaceRoleFromMaterialName, classifyAssetSurfaceRoles, TERRAIN_ENVIRONMENT_MATERIAL_DIRECTOR_POLICY } from './terrainEnvironmentMaterialDirector.js';

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const norm = (value) => String(value ?? '').trim().toLowerCase();

export const TERRAIN_ENVIRONMENT_TEXTURE_AUDIT_POLICY = freeze({
  id: 'terrain-environment-texture-audit-2026-09-07-v1',
  readOnly: true,
  materialAuthority: TERRAIN_ENVIRONMENT_MATERIAL_DIRECTOR_POLICY.materialAuthority,
  requirePbrCompatibleSurfaces: true,
  preserveAuthoredTextures: true,
  rejectEditorRuntimeImport: true,
  placeholderAllowed: false,
  targetUvDensityMeters: freeze({ close: 0.20, near: 0.45, far: 1.80 }),
});

const COLOR_KEYS = freeze(['color', 'map', 'albedo', 'basecolor', 'diffuse', 'diffusemap', 'albedomap']);
const NORMAL_KEYS = freeze(['normal', 'normalmap', 'bump', 'bumpmap']);
const ROUGH_KEYS = freeze(['roughness', 'roughnessmap']);
const METAL_KEYS = freeze(['metalness', 'metalnessmap', 'metallic']);

function materialName(surface) {
  return surface?.name ?? surface?.material?.name ?? 'unnamed-material';
}

function materialObject(surface) {
  return surface?.material ?? surface ?? {};
}

function texturePresent(material, keys) {
  return keys.some((key) => {
    const value = material?.[key];
    return Boolean(value) || Boolean(material?.userData?.[key]);
  });
}

function textureDimension(texture) {
  const image = texture?.image;
  return freeze({
    width: finite(image?.width, 0),
    height: finite(image?.height, 0),
    powerOfTwo: Boolean(image?.width && image?.height && ((image.width & (image.width - 1)) === 0) && ((image.height & (image.height - 1)) === 0)),
  });
}

function inspectTexture(texture, channel) {
  if (!texture) return freeze({ present: false, channel });
  return freeze({
    present: true,
    channel,
    name: texture.name ?? '',
    uuid: texture.uuid ?? '',
    colorSpace: texture.colorSpace ?? '',
    wrapS: texture.wrapS ?? null,
    wrapT: texture.wrapT ?? null,
    repeat: freeze({ x: finite(texture.repeat?.x, 1), y: finite(texture.repeat?.y, 1) }),
    rotation: finite(texture.rotation, 0),
    dimensions: textureDimension(texture),
    anisotropy: finite(texture.anisotropy, 0),
    channelIndex: Number.isInteger(texture.channel) ? texture.channel : 0,
    generatedByTextureFactory: Boolean(texture.userData?.generatedByTextureFactory),
  });
}

function findTexture(material, keys) {
  for (const key of keys) {
    if (material?.[key] && typeof material[key] === 'object') return material[key];
  }
  return null;
}

export function auditMaterialSurface(surface, { expectedRole = null, asset = null } = {}) {
  const material = materialObject(surface);
  const name = materialName(surface);
  const role = surfaceRoleFromMaterialName(name);
  const colorTexture = findTexture(material, COLOR_KEYS);
  const normalTexture = findTexture(material, NORMAL_KEYS);
  const roughnessTexture = findTexture(material, ROUGH_KEYS);
  const metalnessTexture = findTexture(material, METAL_KEYS);
  const result = {
    assetId: asset?.id ?? '',
    assetSrc: asset?.src ?? '',
    materialName: name,
    inferredRole: role,
    expectedRole: expectedRole ?? role,
    roleMatches: expectedRole ? role === expectedRole : true,
    pbr: {
      color: inspectTexture(colorTexture, 'color'),
      normal: inspectTexture(normalTexture, 'normal'),
      roughness: inspectTexture(roughnessTexture, 'roughness'),
      metalness: inspectTexture(metalnessTexture, 'metalness'),
      scalarRoughness: finite(material.roughness, 0.5),
      scalarMetalness: finite(material.metalness, 0),
      transparent: Boolean(material.transparent),
      alphaTest: finite(material.alphaTest, 0),
    },
    generatedTexture: Boolean(material.userData?.generatedByTextureFactory || material.userData?.layeredMaterial),
    authoredMaterialName: Boolean(name),
  };
  return freeze(result);
}

export function auditEnvironmentObject(root, { asset = null, expectedRoles = [] } = {}) {
  if (!root) return freeze({ ok: false, errors: freeze(['missing-object']), surfaces: freeze([]) });
  const analysis = analyzeMaterialSurfaces(root);
  const roles = classifyAssetSurfaceRoles(asset ?? {});
  const surfaces = analysis.surfaces.map((surface, index) => auditMaterialSurface(surface, { expectedRole: expectedRoles[index] ?? null, asset }));
  const errors = [];
  if (!surfaces.length) errors.push('no-material-surfaces');
  surfaces.forEach((surface) => {
    if (surface.pbr.scalarRoughness < 0 || surface.pbr.scalarRoughness > 1) errors.push(`roughness-range:${surface.materialName}`);
    if (surface.pbr.scalarMetalness < 0 || surface.pbr.scalarMetalness > 1) errors.push(`metalness-range:${surface.materialName}`);
    if (surface.pbr.color.present && surface.pbr.color.colorSpace === 'SRGBColorSpace' && ['normal', 'roughness', 'metalness'].includes(surface.inferredRole)) errors.push(`data-color-space:${surface.materialName}`);
    if (expectedRoles.length && !surface.roleMatches) errors.push(`surface-role-mismatch:${surface.materialName}`);
  });
  return freeze({
    ok: errors.length === 0,
    errors: freeze(errors),
    policyId: TERRAIN_ENVIRONMENT_TEXTURE_AUDIT_POLICY.id,
    materialSummary: analysis,
    expectedRoles: freeze([...roles]),
    surfaces: freeze(surfaces),
    authoredSurfaceCount: surfaces.filter((surface) => surface.authoredMaterialName).length,
    generatedSurfaceCount: surfaces.filter((surface) => surface.generatedTexture).length,
  });
}

export function compareMaterialSurfaceAudits(left, right) {
  const a = left?.surfaces ?? [];
  const b = right?.surfaces ?? [];
  const names = [...new Set([...a.map((surface) => surface.materialName), ...b.map((surface) => surface.materialName)])];
  return freeze(names.map((name) => {
    const x = a.find((surface) => surface.materialName === name);
    const y = b.find((surface) => surface.materialName === name);
    return freeze({
      materialName: name,
      leftPresent: Boolean(x),
      rightPresent: Boolean(y),
      roughnessDelta: finite(y?.pbr?.scalarRoughness) - finite(x?.pbr?.scalarRoughness),
      metalnessDelta: finite(y?.pbr?.scalarMetalness) - finite(x?.pbr?.scalarMetalness),
    });
  }));
}

export function auditScalarPbrRange({ roughness = 0.5, metalness = 0, normalStrength = 0.5 } = {}) {
  const r = finite(roughness, 0.5);
  const m = finite(metalness, 0);
  const n = finite(normalStrength, 0.5);
  const errors = [];
  if (r < 0 || r > 1) errors.push('roughness-range');
  if (m < 0 || m > 1) errors.push('metalness-range');
  if (n <= 0 || n > 1.5) errors.push('normal-strength-range');
  return freeze({ ok: errors.length === 0, errors: freeze(errors), roughness: r, metalness: m, normalStrength: n });
}

export function materialTextureCompleteness(surfaceAudit, role) {
  const expected = new Set(['ground', 'rock', 'bark', 'foliage', 'wall', 'roof', 'snow', 'waterEdge', 'metal'][role] ? [role] : [role]);
  const surface = surfaceAudit;
  if (!surface) return 0;
  let score = 0;
  if (surface.pbr.color.present) score += 0.45;
  if (surface.pbr.normal.present) score += 0.25;
  if (surface.pbr.roughness.present || surface.pbr.scalarRoughness !== 0.5) score += 0.20;
  if (surface.pbr.metalness.present || surface.pbr.scalarMetalness !== 0) score += 0.10;
  return clamp(score) * (expected.has(role) ? 1 : 0.92);
}

export function environmentTextureQualityScore(audit) {
  if (!audit) return 0;
  const surfaces = audit.surfaces ?? [];
  if (!surfaces.length) return 0;
  const completeness = surfaces.reduce((sum, surface) => sum + materialTextureCompleteness(surface, surface.inferredRole), 0) / surfaces.length;
  const authored = surfaces.filter((surface) => surface.authoredMaterialName).length / surfaces.length;
  const validPbr = surfaces.filter((surface) => surface.pbr.scalarRoughness >= 0 && surface.pbr.scalarRoughness <= 1 && surface.pbr.scalarMetalness >= 0 && surface.pbr.scalarMetalness <= 1).length / surfaces.length;
  return clamp01(completeness * 0.42 + authored * 0.26 + validPbr * 0.32);
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

export function describeEnvironmentMaterialGap(root, { asset = null } = {}) {
  const audit = auditEnvironmentObject(root, { asset });
  const gaps = [];
  for (const surface of audit.surfaces) {
    if (!surface.pbr.color.present) gaps.push(`${surface.materialName}:missing-color`);
    if (!surface.pbr.normal.present) gaps.push(`${surface.materialName}:missing-normal`);
    if (!(surface.pbr.roughness.present) && surface.pbr.scalarRoughness === 0.5) gaps.push(`${surface.materialName}:generic-roughness`);
  }
  return freeze({ policyId: TERRAIN_ENVIRONMENT_TEXTURE_AUDIT_POLICY.id, assetId: asset?.id ?? '', subject: describeMaterialSubject(root), qualityScore: environmentTextureQualityScore(audit), gaps: freeze(gaps), audit });
}

export function buildTextureAuditManifest(entries = []) {
  const reports = entries.map((entry) => describeEnvironmentMaterialGap(entry.root, { asset: entry.asset }));
  const gaps = reports.flatMap((report) => report.gaps);
  return freeze({
    version: 1,
    policyId: TERRAIN_ENVIRONMENT_TEXTURE_AUDIT_POLICY.id,
    reports,
    acceptance: freeze({ ok: reports.every((report) => report.audit.ok), errorCount: reports.reduce((sum, report) => sum + report.audit.errors.length, 0) }),
    gaps: freeze(gaps),
  });
}
