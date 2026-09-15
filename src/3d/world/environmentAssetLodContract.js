/**
 * Buzul Muhafızı — asset-first environment LOD contract.
 *
 * This module is intentionally DOM-free and side-effect-free. It does not
 * hydrate files, create geometry, or attach scene nodes. The caller owns
 * asset hydrate/load and must route model-bearing placement through the
 * shared MaterialAssignmentCore + WorldAssetPlacementPipeline contract.
 */

const EPSILON = 1e-6;
const MAX_DISTANCE = 1_000_000;
const MIN_SCALE = 0.05;
const MAX_SCALE = 20;
const MAX_DRAWCALLS = 2500;
const MAX_VISIBLE_INSTANCES = 100000;
const MAX_LOD_LEVEL = 3;

const ASSET_FAMILIES = Object.freeze([
  'env',
  'vegetation',
  'props',
  'fbx',
  'textures',
  'shaders',
  'particles',
  'skyboxes',
  'audio'
]);

const SURFACE_ROLES = Object.freeze([
  'trunk',
  'bark',
  'leaves',
  'grass',
  'soil',
  'mud',
  'rock',
  'scree',
  'snow',
  'wet',
  'foam',
  'wall',
  'roof',
  'wood',
  'metal'
]);

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function positive(value, fallback = 0) {
  return Math.max(0, finite(value, fallback));
}

function normalize(value, fallback = 0) {
  return clamp(value, 0, 1) || fallback;
}

function normalizeVector(vector) {
  if (!vector || typeof vector !== 'object') return { x: 0, y: 0, z: 0 };
  const x = finite(vector.x);
  const y = finite(vector.y);
  const z = finite(vector.z);
  const length = Math.hypot(x, y, z);
  if (length < EPSILON) return { x: 0, y: 0, z: 0 };
  return { x: x / length, y: y / length, z: z / length };
}

function hashUnit(x, y, z, seed = 0) {
  let value = 2166136261 ^ Math.trunc(finite(seed));
  const values = [x, y, z];
  for (const item of values) {
    const bits = Math.trunc(finite(item) * 1000);
    value ^= bits;
    value = Math.imul(value, 16777619);
  }
  value += value << 13;
  value ^= value >>> 7;
  value += value << 3;
  value ^= value >>> 17;
  value += value << 5;
  return ((value >>> 0) % 100000) / 100000;
}

function stableNumber(value, digits = 6) {
  return Number(finite(value).toFixed(digits));
}

function stableString(value) {
  return JSON.stringify(value, Object.keys(value || {}).sort());
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function distanceFromCamera(sample, camera) {
  const point = sample?.position || sample || {};
  const eye = camera?.position || camera || {};
  const dx = finite(point.x) - finite(eye.x);
  const dy = finite(point.y) - finite(eye.y);
  const dz = finite(point.z) - finite(eye.z);
  return clamp(Math.hypot(dx, dy, dz), 0, MAX_DISTANCE);
}

function familyFor(sample) {
  const family = String(sample?.family || sample?.assetFamily || '').toLowerCase();
  if (ASSET_FAMILIES.includes(family)) return family;
  const kind = String(sample?.kind || sample?.category || '').toLowerCase();
  if (kind.includes('tree') || kind.includes('grass') || kind.includes('shrub')) return 'vegetation';
  if (kind.includes('rock') || kind.includes('cliff') || kind.includes('boulder')) return 'env';
  if (kind.includes('house') || kind.includes('bridge') || kind.includes('prop')) return 'props';
  return 'env';
}

function surfaceRoles(sample) {
  const roles = Array.isArray(sample?.surfaceRoles)
    ? sample.surfaceRoles
    : Array.isArray(sample?.materials)
      ? sample.materials.map((item) => item?.role || item?.name)
      : [];
  const normalized = roles
    .map((role) => String(role || '').toLowerCase())
    .filter((role) => SURFACE_ROLES.includes(role));
  return [...new Set(normalized)].sort();
}

function contextGate(sample) {
  const slope = normalize(sample?.slope);
  const moisture = normalize(sample?.moisture);
  const waterDistance = positive(sample?.waterDistance, MAX_DISTANCE);
  const snow = normalize(sample?.snowCover);
  const road = normalize(sample?.roadMask);
  const settlement = normalize(sample?.settlementMask);
  const invalid = Boolean(sample?.invalid || sample?.floating || sample?.interpenetrating);
  const underwater = Boolean(sample?.underwater) || waterDistance < 0.75;
  const cliff = slope > 0.82;
  const permanentSnow = snow > 0.88;
  const clearing = Math.max(road, settlement);
  const eligibility = !invalid && !underwater && !cliff && !permanentSnow;
  return {
    eligibility,
    invalid,
    underwater,
    cliff,
    permanentSnow,
    clearing,
    slope,
    moisture,
    waterDistance,
    snow,
    road,
    settlement
  };
}

function roleCompatible(family, roles, gate) {
  if (!gate.eligibility) return false;
  if (family === 'vegetation') {
    if (roles.includes('trunk') || roles.includes('bark')) return gate.snow < 0.72 && gate.slope < 0.72;
    if (roles.includes('leaves') || roles.includes('grass')) return gate.snow < 0.82 && gate.road < 0.94;
  }
  if (family === 'env') {
    if (roles.includes('rock') || roles.includes('scree')) return gate.slope > 0.25 || gate.snow > 0.4;
    if (roles.includes('snow')) return gate.snow > 0.35;
  }
  return true;
}

function chooseLod(distance, radius, budgetPressure = 0) {
  const d = positive(distance);
  const r = Math.max(1, positive(radius, 10));
  const normalizedDistance = clamp(d / (r * 8), 0, 1);
  const pressure = normalize(budgetPressure);
  const adjusted = clamp(normalizedDistance + pressure * 0.35, 0, 1);
  if (adjusted < 0.2) return 0;
  if (adjusted < 0.48) return 1;
  if (adjusted < 0.76) return 2;
  return 3;
}

function visibilityScore(sample, gate, distance, camera) {
  const radius = Math.max(1, positive(sample?.boundsRadius, 10));
  const distanceWeight = 1 - clamp(distance / (radius * 30), 0, 1);
  const slopeWeight = 1 - Math.abs(normalize(sample?.slope) - 0.42);
  const moistureWeight = 0.65 + normalize(sample?.moisture) * 0.35;
  const direction = normalizeVector(sample?.normal);
  const view = normalizeVector({
    x: finite(camera?.position?.x) - finite(sample?.position?.x),
    y: finite(camera?.position?.y) - finite(sample?.position?.y),
    z: finite(camera?.position?.z) - finite(sample?.position?.z)
  });
  const facing = 0.5 + 0.5 * clamp(direction.x * view.x + direction.y * view.y + direction.z * view.z, -1, 1);
  const hash = 0.9 + hashUnit(sample?.position?.x, sample?.position?.y, sample?.position?.z, sample?.seed) * 0.1;
  const clearingPenalty = 1 - gate.clearing * 0.78;
  return clamp(distanceWeight * slopeWeight * moistureWeight * facing * hash * clearingPenalty, 0, 1);
}

function safeScale(sample, lod) {
  const base = clamp(sample?.scale, MIN_SCALE, MAX_SCALE) || 1;
  const variation = 0.92 + hashUnit(sample?.position?.x, sample?.position?.y, sample?.position?.z, sample?.seed) * 0.16;
  const lodScale = lod === 3 ? 0.96 : lod === 2 ? 0.98 : 1;
  return stableNumber(clamp(base * variation * lodScale, MIN_SCALE, MAX_SCALE));
}

function materialManifest(sample, roles) {
  const explicit = Array.isArray(sample?.materialManifest) ? sample.materialManifest : [];
  const manifest = explicit
    .map((entry) => ({
      slot: String(entry?.slot || entry?.name || 'surface'),
      role: String(entry?.role || 'soil').toLowerCase(),
      hydrated: entry?.hydrated !== false,
      placeholder: Boolean(entry?.placeholder),
      source: String(entry?.source || 'caller-owned')
    }))
    .filter((entry) => SURFACE_ROLES.includes(entry.role));
  if (manifest.length) return manifest.sort((a, b) => a.slot.localeCompare(b.slot));
  return roles.map((role) => ({
    slot: role,
    role,
    hydrated: false,
    placeholder: false,
    source: 'caller-owned'
  }));
}

function createPlacementRecord(sample, camera, options) {
  const gate = contextGate(sample);
  const family = familyFor(sample);
  const roles = surfaceRoles(sample);
  const distance = distanceFromCamera(sample, camera);
  const budgetPressure = normalize(options?.budgetPressure);
  const lod = chooseLod(distance, sample?.boundsRadius, budgetPressure);
  const compatible = roleCompatible(family, roles, gate);
  const score = visibilityScore(sample, gate, distance, camera);
  const radius = Math.max(1, positive(sample?.boundsRadius, 10));
  const phase = {
    u: stableNumber((finite(sample?.position?.x) * 0.013 + finite(sample?.position?.z) * 0.007) % 1),
    v: stableNumber((finite(sample?.position?.x) * 0.009 - finite(sample?.position?.z) * 0.011) % 1)
  };
  const material = materialManifest(sample, roles);
  const placement = {
    assetId: String(sample?.assetId || sample?.id || 'unidentified'),
    family,
    sourcePath: String(sample?.sourcePath || sample?.path || ''),
    surfaceRoles: roles,
    materialManifest: material,
    position: {
      x: stableNumber(finite(sample?.position?.x)),
      y: stableNumber(finite(sample?.position?.y)),
      z: stableNumber(finite(sample?.position?.z))
    },
    distance: stableNumber(distance),
    lod,
    scale: safeScale(sample, lod),
    visibilityScore: stableNumber(score),
    antiTilingPhase: phase,
    grounded: Boolean(sample?.grounded) && !gate.invalid,
    eligible: compatible,
    exclusion: !compatible ? {
      invalid: gate.invalid,
      underwater: gate.underwater,
      cliff: gate.cliff,
      permanentSnow: gate.permanentSnow,
      unsupportedSurface: roles.length === 0
    } : null,
    instancingKey: compatible ? `${family}:${roles.join('+') || 'default'}:lod${lod}` : null,
    estimatedCost: {
      triangles: Math.round(clamp(positive(sample?.triangleCount, 0) * (lod === 0 ? 1 : lod === 1 ? 0.55 : lod === 2 ? 0.24 : 0.08), 0, 50_000_000)),
      drawCalls: Math.round(clamp(positive(sample?.drawCalls, roles.length > 1 ? 2 : 1), 1, 32)),
      memoryMb: stableNumber(clamp(positive(sample?.memoryMb, 0.5) * (lod === 0 ? 1 : lod === 1 ? 0.7 : lod === 2 ? 0.4 : 0.2), 0.01, 4096), 3)
    },
    boundsRadius: stableNumber(radius),
    provenance: {
      canonical: sample?.canonical === true,
      owner: String(sample?.owner || 'caller-owned'),
      sharedMaterialPlacementContract: Boolean(sample?.sharedMaterialPlacementContract)
    }
  };
  return placement;
}

function groupPlacements(records) {
  const groups = new Map();
  for (const record of records) {
    if (!record.eligible || !record.instancingKey) continue;
    const key = record.instancingKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record.assetId);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, assetIds]) => ({ key, count: assetIds.length, assetIds: [...assetIds].sort() }));
}

function summarize(records, groups, options) {
  const visible = records.filter((record) => record.eligible && record.visibilityScore > 0.02);
  const excluded = records.filter((record) => !record.eligible);
  const drawCalls = visible.reduce((total, record) => total + record.estimatedCost.drawCalls, 0);
  const triangles = visible.reduce((total, record) => total + record.estimatedCost.triangles, 0);
  const memoryMb = visible.reduce((total, record) => total + record.estimatedCost.memoryMb, 0);
  const budgetPressure = normalize(options?.budgetPressure);
  const pressure = clamp(
    drawCalls / Math.max(1, finite(options?.drawCallBudget, MAX_DRAWCALLS)) * 0.55 +
      memoryMb / Math.max(1, finite(options?.memoryBudgetMb, 1024)) * 0.3 +
      budgetPressure * 0.15,
    0,
    1
  );
  return {
    samples: records.length,
    visible: visible.length,
    excluded: excluded.length,
    instancingGroups: groups.length,
    drawCalls: Math.round(drawCalls),
    triangles: Math.round(triangles),
    memoryMb: stableNumber(memoryMb, 3),
    pressure: stableNumber(pressure),
    degradationTier: pressure > 0.9 ? 3 : pressure > 0.72 ? 2 : pressure > 0.48 ? 1 : 0,
    targets: {
      missingAsset: 0,
      placeholder: 0,
      floating: 0,
      interpenetrating: 0,
      invalidWaterPlacement: 0,
      invalidCliffPlacement: 0,
      visibleTileRisk: 0,
      maxDrawCalls: Math.round(finite(options?.drawCallBudget, MAX_DRAWCALLS)),
      maxMemoryMb: Math.round(finite(options?.memoryBudgetMb, 1024))
    }
  };
}

function normalizeSamples(samples) {
  if (!Array.isArray(samples)) return [];
  return samples.map((sample, index) => ({
    ...sample,
    id: String(sample?.id || sample?.assetId || `sample-${index}`),
    position: {
      x: finite(sample?.position?.x),
      y: finite(sample?.position?.y),
      z: finite(sample?.position?.z)
    }
  }));
}

export function buildEnvironmentAssetLodContract(input = {}) {
  const camera = input?.camera || { position: { x: 0, y: 0, z: 0 } };
  const options = input?.options || {};
  const samples = normalizeSamples(input?.samples);
  const records = samples
    .map((sample) => createPlacementRecord(sample, camera, options))
    .sort((a, b) => a.assetId.localeCompare(b.assetId));
  const groups = groupPlacements(records);
  const summary = summarize(records, groups, options);
  const manifest = {
    version: 33,
    contract: 'asset-first-environment-lod',
    camera: {
      position: {
        x: stableNumber(finite(camera?.position?.x)),
        y: stableNumber(finite(camera?.position?.y)),
        z: stableNumber(finite(camera?.position?.z))
      },
      projection: String(camera?.projection || 'orthographic'),
      viewport: {
        width: Math.max(1, Math.round(finite(camera?.viewport?.width, 1536))),
        height: Math.max(1, Math.round(finite(camera?.viewport?.height, 1024)))
      }
    },
    assetFamilies: ASSET_FAMILIES,
    placements: records,
    instancingGroups: groups,
    summary,
    acceptance: {
      actualShippedSceneRequired: true,
      beforeAfterSameSeedRequired: true,
      modelBearingPlacementMustUseSharedContract: true,
      editorRuntimeImportForbidden: true,
      canonicalGeographyMutationForbidden: true
    }
  };
  const digest = stableString({
    version: manifest.version,
    camera: manifest.camera,
    placements: manifest.placements,
    groups: manifest.instancingGroups,
    summary: manifest.summary
  });
  return deepFreeze({ ...manifest, digest });
}

export function applyEnvironmentAssetLodContract(materialOrObject, profile = {}) {
  if (!materialOrObject || typeof materialOrObject !== 'object') return materialOrObject;
  const target = materialOrObject.material || materialOrObject;
  if (target && typeof target === 'object') {
    if ('roughness' in target) target.roughness = clamp(profile.roughness, 0.08, 1);
    if ('normalScale' in target && target.normalScale && typeof target.normalScale === 'object') {
      const energy = clamp(profile.normalEnergy, 0.05, 1);
      target.normalScale.x = energy;
      target.normalScale.y = energy;
    }
    if ('opacity' in target) target.opacity = clamp(profile.opacity, 0.05, 1);
    target.userData = {
      ...(target.userData || {}),
      environmentAssetLodContract: {
        version: 33,
        antiTilingPhase: profile.antiTilingPhase || { u: 0, v: 0 },
        lod: clamp(profile.lod, 0, MAX_LOD_LEVEL),
        instancingKey: profile.instancingKey || null,
        sharedMaterialPlacementContract: profile.sharedMaterialPlacementContract === true
      }
    };
  }
  return materialOrObject;
}

export function getEnvironmentAssetLodConstants() {
  return Object.freeze({
    version: 33,
    maxDistance: MAX_DISTANCE,
    minScale: MIN_SCALE,
    maxScale: MAX_SCALE,
    maxDrawCalls: MAX_DRAWCALLS,
    maxVisibleInstances: MAX_VISIBLE_INSTANCES,
    maxLodLevel: MAX_LOD_LEVEL,
    assetFamilies: ASSET_FAMILIES,
    surfaceRoles: SURFACE_ROLES
  });
}

export default buildEnvironmentAssetLodContract;
