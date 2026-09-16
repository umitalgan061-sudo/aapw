/**
 * Material migration/readiness registry for the WebGPURenderer transition.
 *
 * WebGPURenderer does not support ShaderMaterial/RawShaderMaterial/onBeforeCompile in the same way
 * as WebGLRenderer. The registry records migration readiness and preferred implementation style while
 * keeping actual material construction with the owning scene/asset layer.
 *
 * @module renderMaterialMigrationRegistry
 */

const freeze = Object.freeze;
const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const text = (v, f = '') => String(v ?? f).slice(0, 96);

export const MATERIAL_MIGRATION_STATUSES = freeze(['native-node', 'tsl-ready', 'legacy-webgl', 'blocked', 'unknown']);
export const MATERIAL_MIGRATION_POLICIES = freeze(['standard', 'node', 'tsl', 'fallback']);

export const RENDER_MATERIAL_MIGRATION_POLICY = freeze({
  id: 'render-material-migration-registry-2026-09-v1',
  maxEntries: 1024,
  maxNotes: 6,
  maxMaterialNameLength: 96,
});

function normalizeStatus(value) {
  const status = text(value, 'unknown').toLowerCase();
  return MATERIAL_MIGRATION_STATUSES.includes(status) ? status : 'unknown';
}

function normalizePreferred(value) {
  const preferred = text(value, 'standard').toLowerCase();
  return MATERIAL_MIGRATION_POLICIES.includes(preferred) ? preferred : 'standard';
}

export function classifyLegacyMaterial(material = {}) {
  const shaderMaterial = material.shaderMaterial === true;
  const rawShader = material.rawShaderMaterial === true;
  const beforeCompile = material.onBeforeCompile === true;
  if (rawShader || beforeCompile) return 'blocked';
  if (shaderMaterial) return 'legacy-webgl';
  if (material.nodeMaterial || material.tsl === true) return 'tsl-ready';
  return 'unknown';
}

export function createRenderMaterialMigrationRegistry(options = {}) {
  const policy = freeze({ ...RENDER_MATERIAL_MIGRATION_POLICY, ...(options.policy || {}) });
  const entries = new Map();
  let revision = 0;

  function register(material = {}) {
    if (entries.size >= policy.maxEntries && !entries.has(material.id)) return false;
    const id = text(material.id || material.name || `material-${entries.size}`);
    const previous = entries.get(id);
    const status = normalizeStatus(material.status || classifyLegacyMaterial(material));
    const entry = freeze({
      id,
      name: text(material.name || id),
      family: text(material.family || 'standard'),
      status,
      preferred: normalizePreferred(material.preferred),
      webgpuReady: status === 'native-node' || status === 'tsl-ready',
      fallbackAllowed: material.fallbackAllowed !== false,
      shaderMaterial: material.shaderMaterial === true,
      onBeforeCompile: material.onBeforeCompile === true,
      estimatedVariants: Math.max(0, Math.min(128, Math.floor(finite(material.estimatedVariants, previous?.estimatedVariants || 1)))),
      notes: freeze((Array.isArray(material.notes) ? material.notes : []).slice(0, policy.maxNotes).map((value) => text(value))),
      revision: revision + 1,
    });
    entries.set(id, entry);
    revision += 1;
    return true;
  }

  function registerMany(materials = []) {
    let accepted = 0;
    for (const material of Array.isArray(materials) ? materials : []) if (register(material)) accepted += 1;
    return freeze({ accepted, total: Array.isArray(materials) ? materials.length : 0, revision });
  }

  function get(id) { return entries.get(text(id)) || null; }

  function migrationQueue({ limit = 64, includeUnknown = true } = {}) {
    const queue = [...entries.values()].filter((entry) => entry.status === 'legacy-webgl' || entry.status === 'blocked' || (includeUnknown && entry.status === 'unknown'));
    queue.sort((a, b) => {
      const weight = (entry) => entry.status === 'blocked' ? 3 : entry.status === 'legacy-webgl' ? 2 : 1;
      return (weight(b) - weight(a)) || (b.estimatedVariants - a.estimatedVariants) || a.id.localeCompare(b.id);
    });
    return freeze(queue.slice(0, Math.max(1, Math.min(256, Math.floor(finite(limit, 64))))));
  }

  function readinessSummary() {
    const summary = { total: entries.size, webgpuReady: 0, legacy: 0, blocked: 0, unknown: 0 };
    for (const entry of entries.values()) {
      if (entry.webgpuReady) summary.webgpuReady += 1;
      if (entry.status === 'legacy-webgl') summary.legacy += 1;
      if (entry.status === 'blocked') summary.blocked += 1;
      if (entry.status === 'unknown') summary.unknown += 1;
    }
    return freeze(summary);
  }

  function snapshot() { return freeze({ policy, revision, entries: freeze([...entries.values()].sort((a, b) => a.id.localeCompare(b.id))), readiness: readinessSummary(), migrationQueue: migrationQueue({ limit: 64 }) }); }
  function reset() { entries.clear(); revision += 1; }

  return freeze({ register, registerMany, get, migrationQueue, readinessSummary, snapshot, reset, get revision() { return revision; } });
}

export function materialMigrationRisk(entry) {
  if (!entry) return 'unknown';
  if (entry.status === 'blocked') return 'critical';
  if (entry.status === 'legacy-webgl') return entry.estimatedVariants > 16 ? 'high' : 'medium';
  if (entry.status === 'unknown') return 'medium';
  return 'low';
}
