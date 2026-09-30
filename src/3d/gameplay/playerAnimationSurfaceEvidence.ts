/** Production TypeScript owner for src/3d/gameplay/playerAnimationSurfaceEvidence.js. Legacy .js remains compatibility-only. */

import {
  analyzeMaterialSurfaces,
  validateMaterialAssignment,
} from '../materials/MaterialAssignmentCore.js';

type UnknownRecord = Record<string, unknown>;

export interface PlayerSurfaceEvidence {
  readonly key: string;
  readonly meshName: string;
  readonly materialName: string;
  readonly slot: string;
  readonly role: string;
  readonly textures: Readonly<Record<string, boolean>>;
  readonly textureCount: number;
  readonly paletteId: string | null;
}

export interface PlayerSurfaceInspection {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly meshCount: number;
  readonly surfaceCount: number;
  readonly uvMeshCount: number;
  readonly namedSurfaceCount: number;
  readonly textureBearingSurfaceCount: number;
  readonly generatedMaterialCount: number;
  readonly materialSlotCount: number;
  readonly roleCounts: Readonly<Record<string, number>>;
  readonly roleCoverage: readonly string[];
  readonly paletteIds: readonly string[];
  readonly paletteCount: number;
  readonly surfaces: readonly PlayerSurfaceEvidence[];
  readonly textureSizes: readonly Readonly<Record<'width' | 'height' | 'field', number | string>>[];
  readonly textureQuality: PlayerTextureQuality;
}

export interface PlayerTextureQuality {
  readonly count: number;
  readonly oversizedCount: number;
  readonly undersizedCount: number;
  readonly preferredSizeCount: number;
  readonly maxDimension: number;
  readonly minDimension: number;
}

export interface PlayerSurfaceManifest {
  readonly version: 2;
  readonly playerAssetId: string;
  readonly sourcePath: string;
  readonly meshCount: number;
  readonly surfaceCount: number;
  readonly textureBearingSurfaceCount: number;
  readonly roleCounts: Readonly<Record<string, number>>;
  readonly roleCoverage: readonly string[];
  readonly paletteIds: readonly string[];
  readonly paletteCount: number;
  readonly textureSizes: readonly Readonly<Record<'width' | 'height' | 'field', number | string>>[];
  readonly textureQuality: PlayerTextureQuality;
  readonly surfaces: readonly PlayerSurfaceEvidence[];
  readonly validation: Readonly<{ ok: boolean; errors: readonly string[]; warnings: readonly string[] }>;
}

export interface PlayerSurfaceMaterialDiversity {
  readonly score: number;
  readonly roleScore: number;
  readonly textureScore: number;
  readonly paletteScore: number;
  readonly warnings: readonly string[];
}

export interface PlayerSurfaceQualitySummary {
  readonly valid: boolean;
  readonly layered: boolean;
  readonly textured: boolean;
  readonly visualFailure: boolean;
  readonly diversityScore: number;
  readonly diversityWarnings: readonly string[];
  readonly meshCount: number;
  readonly surfaceCount: number;
  readonly textureBearingSurfaceCount: number;
  readonly paletteCount: number;
}

interface MaterialSurfaceAnalysis {
  readonly surfaces?: readonly UnknownRecord[];
  readonly meshCount?: number;
  readonly surfaceCount?: number;
  readonly uvMeshCount?: number;
  readonly namedSurfaceCount?: number;
}

interface MaterialValidation {
  readonly ok?: boolean;
  readonly errors?: readonly unknown[];
  readonly warnings?: readonly unknown[];
  readonly generatedMaterialCount?: number;
  readonly materialSlotCount?: number;
}

const ROLE_RULES: ReadonlyArray<readonly [string, RegExp]> = Object.freeze([
  ['skin', /skin|face|body|head/i],
  ['hair', /hair|ponytail|beard/i],
  ['cloth', /cloth|dress|shirt|tunic|trouser|skirt|fabric/i],
  ['leather', /leather|belt|strap|glove/i],
  ['metal', /metal|steel|armor|armour|blade|mail|chain/i],
  ['boot', /boot|shoe|footwear/i],
]);

export const SURFACE_ROLE_ORDER = Object.freeze(['skin', 'hair', 'cloth', 'leather', 'metal', 'boot']);
const TEXTURE_FIELDS = Object.freeze(['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap']);
export const TEXTURE_POLICY = Object.freeze({ minDimension: 64, maxDimension: 2048, preferredSizes: Object.freeze([256, 512, 1024]) });

const safeName = (value: unknown): string => String(value ?? '').trim();
const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};

function classifySurface(surface: UnknownRecord): string {
  const haystack = [surface.meshName, surface.materialName, surface.slot].map(safeName).join(' ');
  const match = ROLE_RULES.find(([, pattern]) => pattern.test(haystack));
  return match?.[0] ?? 'unclassified';
}

function materialTextureSlots(material: unknown): Readonly<Record<string, boolean>> {
  const source = asRecord(material);
  return Object.freeze({
    map: Boolean(source.map),
    normalMap: Boolean(source.normalMap),
    roughnessMap: Boolean(source.roughnessMap),
    metalnessMap: Boolean(source.metalnessMap),
    aoMap: Boolean(source.aoMap),
    alphaMap: Boolean(source.alphaMap),
  });
}

function collectTextureSizes(material: unknown): readonly Readonly<Record<'width' | 'height' | 'field', number | string>>[] {
  const source = asRecord(material);
  const sizes: Array<Readonly<Record<'width' | 'height' | 'field', number | string>>> = [];
  for (const field of TEXTURE_FIELDS) {
    const image = asRecord(source[field]).image;
    const imageRecord = asRecord(image);
    const width = Number(imageRecord.width);
    const height = Number(imageRecord.height);
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      sizes.push(Object.freeze({ width, height, field }));
    }
  }
  return Object.freeze(sizes);
}

function roleCounts(surfaces: readonly PlayerSurfaceEvidence[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const surface of surfaces) counts[surface.role] = (counts[surface.role] ?? 0) + 1;
  return Object.freeze(counts);
}

function distinctPaletteIds(surfaces: readonly PlayerSurfaceEvidence[]): readonly string[] {
  return Object.freeze([...new Set(surfaces.map((surface) => surface.paletteId).filter((id): id is string => Boolean(id)))].sort());
}

function textureQuality(textureSizes: readonly Readonly<Record<'width' | 'height' | 'field', number | string>>[]): PlayerTextureQuality {
  const dimensions = textureSizes.map(({ width, height }) => Math.max(Number(width), Number(height)));
  const oversized = textureSizes.filter(({ width, height }) => Math.max(Number(width), Number(height)) > TEXTURE_POLICY.maxDimension);
  const undersized = textureSizes.filter(({ width, height }) => Math.max(Number(width), Number(height)) < TEXTURE_POLICY.minDimension);
  const preferred = textureSizes.filter(({ width, height }) => TEXTURE_POLICY.preferredSizes.includes(Math.max(Number(width), Number(height))) && Number(width) === Number(height));
  return Object.freeze({
    count: textureSizes.length,
    oversizedCount: oversized.length,
    undersizedCount: undersized.length,
    preferredSizeCount: preferred.length,
    maxDimension: dimensions.length ? Math.max(...dimensions) : 0,
    minDimension: dimensions.length ? Math.min(...dimensions) : 0,
  });
}

function normalizeAnalysis(value: unknown): MaterialSurfaceAnalysis {
  const source = asRecord(value);
  return {
    surfaces: Array.isArray(source.surfaces) ? source.surfaces as readonly UnknownRecord[] : [],
    meshCount: Number(source.meshCount) || 0,
    surfaceCount: Number(source.surfaceCount) || 0,
    uvMeshCount: Number(source.uvMeshCount) || 0,
    namedSurfaceCount: Number(source.namedSurfaceCount) || 0,
  };
}

function normalizeValidation(value: unknown): MaterialValidation {
  const source = asRecord(value);
  return {
    ok: Boolean(source.ok),
    errors: Array.isArray(source.errors) ? source.errors : [],
    warnings: Array.isArray(source.warnings) ? source.warnings : [],
    generatedMaterialCount: Number(source.generatedMaterialCount) || 0,
    materialSlotCount: Number(source.materialSlotCount) || 0,
  };
}

export function inspectPlayerSurfaceEvidence(
  root: unknown,
  { requireSharedValidation = true }: { requireSharedValidation?: boolean } = {},
): PlayerSurfaceInspection {
  if (!root || typeof root !== 'object') {
    return Object.freeze({
      ok: false,
      errors: Object.freeze(['player-model-missing']),
      warnings: Object.freeze([]),
      meshCount: 0,
      surfaceCount: 0,
      uvMeshCount: 0,
      namedSurfaceCount: 0,
      textureBearingSurfaceCount: 0,
      generatedMaterialCount: 0,
      materialSlotCount: 0,
      roleCounts: Object.freeze({}),
      roleCoverage: Object.freeze([]),
      paletteIds: Object.freeze([]),
      paletteCount: 0,
      surfaces: Object.freeze([]),
      textureSizes: Object.freeze([]),
      textureQuality: textureQuality([]),
    });
  }

  const analysis = normalizeAnalysis(analyzeMaterialSurfaces(root));
  const validation = normalizeValidation(validateMaterialAssignment(root));
  const errors = validation.errors.map(String);
  const warnings = validation.warnings.map(String);
  if (requireSharedValidation && !validation.ok) errors.push('shared-material-validation-failed');

  const surfaces: readonly PlayerSurfaceEvidence[] = Object.freeze((analysis.surfaces ?? []).map((surface) => {
    const textures = materialTextureSlots(surface.material);
    const sourceMaterial = asRecord(surface.material);
    const userData = asRecord(sourceMaterial.userData);
    return Object.freeze({
      key: safeName(surface.key),
      meshName: safeName(surface.meshName),
      materialName: safeName(surface.materialName),
      slot: safeName(surface.slot),
      role: classifySurface(surface),
      textures,
      textureCount: Object.values(textures).filter(Boolean).length,
      paletteId: typeof userData.paletteId === 'string' ? userData.paletteId : null,
    });
  }));

  const textureBearingSurfaceCount = surfaces.filter((surface) => surface.textureCount > 0).length;
  const textureSizes = Object.freeze((analysis.surfaces ?? []).flatMap((surface) => collectTextureSizes(surface.material)));
  if ((analysis.meshCount ?? 0) === 0) errors.push('no-player-meshes');
  if ((analysis.surfaceCount ?? 0) === 0) errors.push('no-player-material-surfaces');
  if (textureBearingSurfaceCount === 0) warnings.push('no-authored-texture-slots-observed');
  if ((analysis.meshCount ?? 0) === 1 && (analysis.surfaceCount ?? 0) === 1 && textureBearingSurfaceCount === 0) warnings.push('single-surface-flat-material-risk');

  const quality = textureQuality(textureSizes);
  if (quality.oversizedCount) warnings.push('oversized-player-texture');
  if (quality.undersizedCount) warnings.push('undersized-player-texture');
  const paletteIds = distinctPaletteIds(surfaces);
  if (surfaces.length >= 3 && paletteIds.length <= 1) warnings.push('single-palette-multi-surface-risk');
  const counts = roleCounts(surfaces);

  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze([...new Set(errors)]),
    warnings: Object.freeze([...new Set(warnings)]),
    meshCount: analysis.meshCount ?? 0,
    surfaceCount: analysis.surfaceCount ?? 0,
    uvMeshCount: analysis.uvMeshCount ?? 0,
    namedSurfaceCount: analysis.namedSurfaceCount ?? 0,
    textureBearingSurfaceCount,
    generatedMaterialCount: validation.generatedMaterialCount ?? 0,
    materialSlotCount: validation.materialSlotCount ?? 0,
    roleCounts: counts,
    roleCoverage: Object.freeze(SURFACE_ROLE_ORDER.filter((role) => Number(counts[role]) > 0)),
    paletteIds,
    paletteCount: paletteIds.length,
    surfaces,
    textureSizes,
    textureQuality: quality,
  });
}

export function buildPlayerSurfaceManifest(root: unknown, metadata: UnknownRecord = {}): PlayerSurfaceManifest {
  const evidence = inspectPlayerSurfaceEvidence(root);
  return Object.freeze({
    version: 2,
    playerAssetId: String(metadata.id ?? ''),
    sourcePath: String(metadata.src ?? ''),
    meshCount: evidence.meshCount,
    surfaceCount: evidence.surfaceCount,
    textureBearingSurfaceCount: evidence.textureBearingSurfaceCount,
    roleCounts: evidence.roleCounts,
    roleCoverage: evidence.roleCoverage,
    paletteIds: evidence.paletteIds,
    paletteCount: evidence.paletteCount,
    textureSizes: evidence.textureSizes,
    textureQuality: evidence.textureQuality,
    surfaces: evidence.surfaces,
    validation: Object.freeze({ ok: evidence.ok, errors: evidence.errors, warnings: evidence.warnings }),
  });
}

export function hasLayeredPlayerSurfaceLanguage(evidence: Partial<PlayerSurfaceInspection> | null | undefined): boolean {
  if (!evidence) return false;
  const roleCountsValue = evidence.roleCounts ?? {};
  const roleHits = SURFACE_ROLE_ORDER.filter((role) => Number(roleCountsValue[role]) > 0).length;
  return roleHits >= 2 || Number(evidence.surfaceCount ?? 0) >= 2 || Number(evidence.textureBearingSurfaceCount ?? 0) >= 2;
}

export function scorePlayerSurfaceMaterialDiversity(evidence: Partial<PlayerSurfaceInspection> | null | undefined): PlayerSurfaceMaterialDiversity {
  if (!evidence) return Object.freeze({ score: 0, roleScore: 0, textureScore: 0, paletteScore: 0, warnings: Object.freeze(['missing-evidence']) });
  const roleScore = Math.min(1, Number((evidence.roleCoverage?.length ?? 0) / 4));
  const surfaceCount = Math.max(1, Number(evidence.surfaceCount ?? 1));
  const textureScore = Math.min(1, Number(evidence.textureBearingSurfaceCount ?? 0) / surfaceCount);
  const paletteCount = Number(evidence.paletteCount ?? 0);
  const paletteScore = paletteCount >= 2 ? 1 : Number(evidence.surfaceCount ?? 0) <= 1 ? 0.5 : 0;
  const score = (roleScore * 0.45) + (textureScore * 0.35) + (paletteScore * 0.20);
  const warnings: string[] = [];
  if (roleScore < 0.5) warnings.push('insufficient-semantic-surface-roles');
  if (textureScore < 0.5) warnings.push('insufficient-textured-surfaces');
  if (paletteScore === 0) warnings.push('palette-diversity-missing');
  return Object.freeze({
    score: Math.round(score * 1000) / 1000,
    roleScore: Math.round(roleScore * 1000) / 1000,
    textureScore: Math.round(textureScore * 1000) / 1000,
    paletteScore: Math.round(paletteScore * 1000) / 1000,
    warnings: Object.freeze(warnings),
  });
}

export function summarizePlayerSurfaceQuality(evidence: Partial<PlayerSurfaceInspection> | null | undefined): PlayerSurfaceQualitySummary {
  const valid = Boolean(evidence?.ok);
  const layered = hasLayeredPlayerSurfaceLanguage(evidence);
  const textured = Number(evidence?.textureBearingSurfaceCount ?? 0) > 0;
  const diversity = scorePlayerSurfaceMaterialDiversity(evidence);
  return Object.freeze({
    valid,
    layered,
    textured,
    visualFailure: !valid || (!layered && !textured),
    diversityScore: diversity.score,
    diversityWarnings: diversity.warnings,
    meshCount: Number(evidence?.meshCount ?? 0),
    surfaceCount: Number(evidence?.surfaceCount ?? 0),
    textureBearingSurfaceCount: Number(evidence?.textureBearingSurfaceCount ?? 0),
    paletteCount: Number(evidence?.paletteCount ?? 0),
  });
}

export { ROLE_RULES };
