/**
 * Environment Material Application V57
 *
 * Applies bounded PBR response to already-hydrated shipped environment materials.
 * Caller owns canonical sampling, asset hydration, shared material assignment,
 * ground transform, manifest and scene attach. No geometry or geography is created.
 */

export const ENVIRONMENT_MATERIAL_APPLICATION_V57_ID = 'environment-material-application-v57';

const LIMITS = Object.freeze({ maxMaterials: 4096, maxTextureScale: 64 });
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const clamp01 = (value) => clamp(value, 0, 1);
const asRole = (value) => typeof value === 'string' ? value.trim().toLowerCase().slice(0, 64) : 'unknown';
const round = (value, digits = 5) => {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
};

function roleProfile(role, context) {
  const r = asRole(role);
  const wet = clamp01(context.wetEdge);
  const snow = clamp01(context.snow);
  const slope = clamp01(context.slope);
  const distance = Math.max(0, finite(context.cameraDistance, 100));
  const near = distance <= 55;
  const rockLike = /rock|cliff|scree|stone/.test(r);
  const vegetation = /leaf|foliage|grass|shrub|moss/.test(r);
  const bark = /bark|trunk|wood/.test(r);
  const snowLike = /snow|ice|frost/.test(r);
  const waterLike = /water|wet|foam|shore/.test(r);
  const roughness = clamp(
    (rockLike ? 0.84 : vegetation ? 0.68 : bark ? 0.78 : snowLike ? 0.62 : waterLike ? 0.22 : 0.72)
      - wet * 0.16 + snow * 0.05 + slope * 0.04,
    0.16,
    0.97,
  );
  const normalScale = clamp(
    (rockLike ? 0.82 : vegetation ? 0.58 : bark ? 0.66 : snowLike ? 0.42 : waterLike ? 0.26 : 0.52)
      * (near ? 1 : 0.72) * (1 - wet * 0.2),
    0,
    1,
  );
  const ao = clamp((rockLike ? 0.86 : vegetation ? 0.58 : 0.7) + slope * 0.08, 0, 1);
  const repeatScale = clamp(near ? 7.5 : 4.5, 1, LIMITS.maxTextureScale);
  const macroContrast = clamp((rockLike ? 0.26 : vegetation ? 0.18 : 0.22) + (1 - wet) * 0.08, 0.06, 0.42);
  return { role: r, roughness: round(roughness), normalScale: round(normalScale), ao: round(ao), repeatScale: round(repeatScale), macroContrast: round(macroContrast), antiTilingPhase: round((finite(context.worldX) * 0.013 + finite(context.worldZ) * 0.017) % 1) };
}

function materialRole(material) {
  if (!material || typeof material !== 'object') return 'unknown';
  const tags = [material.role, material.name, material.userData?.surfaceRole, material.userData?.materialRole].filter(Boolean);
  return asRole(tags[0] || 'unknown');
}

function applyOne(material, profile) {
  if (!material || typeof material !== 'object') return { applied: false, reason: 'missing-material' };
  const before = { roughness: material.roughness, normalScale: material.normalScale, aoMapIntensity: material.aoMapIntensity };
  if ('roughness' in material) material.roughness = profile.roughness;
  if ('normalScale' in material && material.normalScale && typeof material.normalScale.set === 'function') material.normalScale.set(profile.normalScale, profile.normalScale);
  if ('aoMapIntensity' in material) material.aoMapIntensity = profile.ao;
  material.userData = { ...(material.userData || {}), environmentVisualAdoptionV57: profile };
  return { applied: true, before, after: profile };
}

export function buildEnvironmentMaterialApplicationV57(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const context = {
    slope: clamp01(source.slope),
    snow: clamp01(source.snow),
    wetEdge: clamp01(source.wetEdge),
    cameraDistance: clamp(source.cameraDistance, 0, 100000),
    worldX: finite(source.worldX),
    worldZ: finite(source.worldZ),
  };
  const materials = Array.isArray(source.materials) ? source.materials.slice(0, LIMITS.maxMaterials) : [];
  const plans = materials.map((material) => roleProfile(materialRole(material), context));
  return Object.freeze({
    id: ENVIRONMENT_MATERIAL_APPLICATION_V57_ID,
    context: Object.freeze(context),
    count: plans.length,
    plans: Object.freeze(plans.map((plan) => Object.freeze(plan))),
    sharedContract: Object.freeze({ authority: ['MaterialAssignmentCore.js', 'WorldAssetPlacementPipeline.js'], callerOwnsHydrateLoad: true, callerOwnsSceneAttach: true, editorRuntimeImport: false }),
  });
}

export function applyEnvironmentMaterialApplicationV57(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const plan = source.plan || buildEnvironmentMaterialApplicationV57(source);
  const materials = Array.isArray(source.materials) ? source.materials.slice(0, LIMITS.maxMaterials) : [];
  const results = materials.map((material, index) => applyOne(material, plan.plans[index] || roleProfile(materialRole(material), plan.context)));
  return { id: ENVIRONMENT_MATERIAL_APPLICATION_V57_ID, applied: results.filter((result) => result.applied).length, skipped: results.filter((result) => !result.applied).length, results, plan };
}
