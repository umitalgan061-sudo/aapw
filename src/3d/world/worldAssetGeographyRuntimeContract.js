/**
 * Runtime-safe helpers for geography-aware world asset placement.
 *
 * This module is intentionally orthogonal to the canonical terrain/hydrology/collider authorities.
 * It normalizes asset family metadata and preserves the placed object's actual world position when
 * a footprint sample is present. The helpers are pure and deterministic so callers can adopt them
 * incrementally without changing geometry, water, roads, or collision semantics.
 *
 * @module world/worldAssetGeographyRuntimeContract
 */

const FAMILY_ALIASES = Object.freeze({
  vegetation: 'vegetation',
  plant: 'vegetation',
  flora: 'vegetation',
  tree: 'tree',
  woodland: 'tree',
  shrub: 'shrub',
  bush: 'shrub',
  rock: 'rock',
  boulder: 'rock',
  stone: 'rock',
  scree: 'rock',
  building: 'building',
  structure: 'building',
  house: 'building',
  castle: 'building',
  settlement: 'settlement',
  village: 'settlement',
  town: 'settlement',
  city: 'settlement',
  snow: 'snow',
  ice: 'snow',
  glacier: 'snow',
  waterside: 'waterside',
  riverbank: 'waterside',
  shoreline: 'waterside',
});

const FAMILY_SEARCH_ORDER = Object.freeze([
  'settlement',
  'building',
  'snow',
  'waterside',
  'rock',
  'tree',
  'shrub',
  'vegetation',
]);

const POSITION_KEYS = Object.freeze(['x', 'z']);

function text(value) {
  return String(value ?? '').trim().toLowerCase();
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function tokenSet(values) {
  return values
    .flatMap((value) => text(value).split(/[^a-z0-9]+/g))
    .filter(Boolean);
}

/**
 * Normalize arbitrary metadata into one of the geography profiler's supported families.
 * Explicit family metadata wins; otherwise aliases are detected in stable priority order.
 */
export function normalizeWorldAssetGeographyFamily(metadata = {}, object = null) {
  const explicit = [
    metadata.family,
    metadata.assetFamily,
    object?.userData?.assetFamily,
  ].map(text).find(Boolean);
  if (explicit && FAMILY_ALIASES[explicit]) return FAMILY_ALIASES[explicit];

  const tokens = new Set(tokenSet([
    metadata.id,
    metadata.category,
    metadata.type,
    metadata.src,
    object?.userData?.assetId,
    object?.userData?.assetCategory,
  ]));
  for (const family of FAMILY_SEARCH_ORDER) {
    if (tokens.has(family)) return FAMILY_ALIASES[family];
    for (const [alias, canonical] of Object.entries(FAMILY_ALIASES)) {
      if (canonical === family && tokens.has(alias)) return canonical;
    }
  }
  return 'vegetation';
}

/**
 * Return the actual placed object's world position, preserving the transform established by the
 * authoritative placement pipeline. Footprint samples are used only as a fallback for callers that
 * have not attached the object yet; they never override object.position.
 */
export function resolveWorldAssetPlacementPoint(object, prepared = null) {
  const objectPosition = object?.position;
  if (objectPosition && POSITION_KEYS.every((key) => Number.isFinite(Number(objectPosition[key])))) {
    return Object.freeze({
      x: Number(objectPosition.x),
      z: Number(objectPosition.z),
      source: 'object-position',
    });
  }

  const sample = prepared?.footprint?.samples?.find((candidate) => (
    candidate && POSITION_KEYS.every((key) => Number.isFinite(Number(candidate[key])))
  ));
  if (sample) {
    return Object.freeze({
      x: Number(sample.x),
      z: Number(sample.z),
      source: 'footprint-sample',
    });
  }

  return Object.freeze({ x: 0, z: 0, source: 'origin-fallback' });
}

/**
 * Merge surface context and stable world position without mutating either input.
 */
export function buildWorldAssetGeographySurface(prepared, object = prepared?.object) {
  const surface = prepared?.surface;
  if (!surface || typeof surface !== 'object') return null;
  const point = resolveWorldAssetPlacementPoint(object, prepared);
  return Object.freeze({
    ...surface,
    x: point.x,
    z: point.z,
    worldX: Number.isFinite(Number(surface.worldX)) ? Number(surface.worldX) : point.x,
    worldZ: Number.isFinite(Number(surface.worldZ)) ? Number(surface.worldZ) : point.z,
    placementPointSource: point.source,
  });
}

/**
 * Create profiler-ready metadata while retaining the caller's original fields.
 */
export function buildWorldAssetGeographyMetadata(metadata = {}, object = null) {
  return Object.freeze({
    ...metadata,
    id: metadata.id ?? object?.userData?.assetId,
    category: metadata.category ?? object?.userData?.assetCategory,
    src: metadata.src ?? object?.userData?.assetSrc,
    family: normalizeWorldAssetGeographyFamily(metadata, object),
  });
}

/**
 * Non-mutating diagnostic describing whether runtime context is sufficient for geography sampling.
 */
export function validateWorldAssetGeographyRuntimeContext(prepared, object = prepared?.object) {
  const surface = buildWorldAssetGeographySurface(prepared, object);
  const metadata = buildWorldAssetGeographyMetadata(prepared?.metadata ?? {}, object);
  const errors = [];
  if (!surface) errors.push('missing-surface-context');
  if (!metadata.family) errors.push('missing-family');
  if (surface && !POSITION_KEYS.every((key) => Number.isFinite(Number(surface[key])))) {
    errors.push('missing-world-position');
  }
  return Object.freeze({
    ok: errors.length === 0,
    errors,
    surface,
    metadata,
  });
}

/**
 * Attach only diagnostics; never rewrite the grounded transform, material, or collider data.
 */
export function attachWorldAssetGeographyRuntimeDiagnostics(object, {
  profile = null,
  decision = null,
  runtimeContext = null,
  policyId = 'world-asset-geography-runtime-contract-2026-09-07-v1',
} = {}) {
  if (!object) return object;
  object.userData ||= {};
  object.userData.worldAssetGeographyRuntimeContract = policyId;
  if (runtimeContext) object.userData.worldAssetGeographyRuntimeContext = runtimeContext;
  if (profile) object.userData.worldAssetGeographyProfile = profile;
  if (decision) object.userData.worldAssetGeographyDecision = decision;
  return object;
}

export const WORLD_ASSET_GEOGRAPHY_RUNTIME_CONTRACT_POLICY = Object.freeze({
  id: 'world-asset-geography-runtime-contract-2026-09-07-v1',
  deterministic: true,
  renderOnly: true,
  placementRankingOnly: true,
  canonicalTerrainReadOnly: true,
  canonicalHydrologyReadOnly: true,
  canonicalRoadReadOnly: true,
  canonicalColliderReadOnly: true,
  transformRewrite: false,
  materialRewrite: false,
  sourceUvRewrite: false,
});
