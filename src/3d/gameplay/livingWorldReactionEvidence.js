/**
 * Evidence-only contract for the Living World Reaction Runtime.
 *
 * This module reads runtime telemetry and existing asset/placement evidence. It never loads
 * models, assigns materials, places assets, owns navigation, mutates factions, or persists
 * world state. The shared #590 MaterialAssignmentCore / WorldAssetPlacementPipeline remain
 * authoritative whenever new assets are introduced elsewhere.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const asString = (value, fallback = '') => value == null ? fallback : String(value);

export const LIVING_WORLD_REACTION_EVIDENCE_POLICY = freeze({
  id: 'living-world-reaction-evidence-2026-09-08-v1',
  maxActors: 128,
  maxHistoryEntries: 8,
  maxMaterialSurfaces: 12,
  maxTextureResolution: 8192,
  requiredNpcRoles: ['skin', 'hair', 'cloth', 'boots', 'gear'],
  requiredFaunaRoles: ['fur', 'eye', 'claw', 'tooth'],
  sharedMaterialCore: 'src/3d/materials/MaterialAssignmentCore.js',
  sharedPlacementCore: 'src/3d/world/WorldAssetPlacementPipeline.js',
});

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function digest(value) {
  return stableHash(JSON.stringify(value ?? null)).toString(16).padStart(8, '0');
}

function normalizeRoles(value) {
  return Array.isArray(value) ? [...new Set(value.map(String))].sort() : [];
}

function validateTexture(texture) {
  const width = Math.max(0, finite(texture?.width));
  const height = Math.max(0, finite(texture?.height));
  const map = asString(texture?.map, 'unknown');
  return freeze({
    name: asString(texture?.name, 'texture'),
    map,
    width,
    height,
    supported: width > 0 && height > 0 && width <= LIVING_WORLD_REACTION_EVIDENCE_POLICY.maxTextureResolution && height <= LIVING_WORLD_REACTION_EVIDENCE_POLICY.maxTextureResolution,
  });
}

function validateMaterialEvidence(actor, kind) {
  const evidence = actor?.object3D?.userData?.materialEvidence ?? actor?.materialEvidence ?? null;
  if (!evidence || evidence.validated !== true) {
    return freeze({ accepted: false, reason: 'missing-or-unvalidated-material-evidence', roles: [], textures: [], surfaceCount: 0, sharedCore: LIVING_WORLD_REACTION_EVIDENCE_POLICY.sharedMaterialCore });
  }
  const roles = normalizeRoles(evidence.roles);
  const textures = Array.isArray(evidence.textures) ? evidence.textures.slice(0, LIVING_WORLD_REACTION_EVIDENCE_POLICY.maxMaterialSurfaces).map(validateTexture) : [];
  const required = kind === 'npc' || kind === 'character'
    ? LIVING_WORLD_REACTION_EVIDENCE_POLICY.requiredNpcRoles
    : LIVING_WORLD_REACTION_EVIDENCE_POLICY.requiredFaunaRoles;
  const missingRoles = required.filter((role) => !roles.includes(role));
  const placeholder = roles.length === 0 || roles.every((role) => role === 'body' || role === 'default');
  const accepted = missingRoles.length === 0 && !placeholder && textures.every((texture) => texture.supported);
  return freeze({
    accepted,
    reason: accepted ? 'validated' : 'role-or-texture-gap',
    roles,
    missingRoles: freeze(missingRoles),
    textures: freeze(textures),
    surfaceCount: Math.max(0, finite(evidence.surfaceCount)),
    materialSlotCount: Math.max(0, finite(evidence.materialSlotCount)),
    paletteIds: freeze(Array.isArray(evidence.paletteIds) ? evidence.paletteIds.map(String).sort() : []),
    layeredFallback: Boolean(evidence.layeredFallback),
    sharedCore: LIVING_WORLD_REACTION_EVIDENCE_POLICY.sharedMaterialCore,
  });
}

function validatePlacementEvidence(actor) {
  const evidence = actor?.object3D?.userData?.placementEvidence ?? actor?.placementEvidence ?? null;
  if (!evidence || evidence.accepted !== true) {
    return freeze({ accepted: false, reason: 'missing-placement-evidence', sharedCore: LIVING_WORLD_REACTION_EVIDENCE_POLICY.sharedPlacementCore });
  }
  const groundAligned = evidence.groundAligned === true;
  const navAligned = evidence.navAligned === true;
  const habitatAccepted = evidence.habitatAccepted === true;
  const waterSafe = evidence.waterSafe !== false;
  const slopeSafe = evidence.slopeSafe !== false;
  const accepted = groundAligned && navAligned && habitatAccepted && waterSafe && slopeSafe;
  return freeze({
    accepted,
    reason: accepted ? 'validated' : 'alignment-or-habitat-gap',
    groundAligned,
    navAligned,
    habitatAccepted,
    waterSafe,
    slopeSafe,
    placementDigest: asString(evidence.placementDigest, ''),
    materialDigest: asString(evidence.materialDigest, ''),
    provenance: asString(evidence.provenance, ''),
    sharedCore: LIVING_WORLD_REACTION_EVIDENCE_POLICY.sharedPlacementCore,
  });
}

function validateTelemetry(actor) {
  const telemetry = actor?.object3D?.userData?.livingWorldReaction ?? null;
  if (!telemetry) return freeze({ accepted: false, reason: 'missing-runtime-telemetry' });
  const phase = asString(telemetry.phase, 'unknown');
  const lod = asString(telemetry.lod, 'unknown');
  const allowedPhases = ['patrol', 'detect', 'investigate', 'chase', 'attack', 'return', 'flee'];
  const allowedLod = ['near', 'distant', 'far', 'culled'];
  const history = Array.isArray(telemetry.history) ? telemetry.history.slice(-LIVING_WORLD_REACTION_EVIDENCE_POLICY.maxHistoryEntries) : [];
  return freeze({
    accepted: allowedPhases.includes(phase) && allowedLod.includes(lod),
    phase,
    lod,
    targetId: asString(telemetry.targetId, ''),
    relation: telemetry.relation ?? null,
    directive: telemetry.directive ?? null,
    occupation: telemetry.occupation ?? null,
    digest: asString(telemetry.digest, ''),
    historyCount: history.length,
  });
}

function summarizeActor(actor, index, options) {
  const kind = asString(actor?.kind ?? actor?.object3D?.userData?.kind, 'unknown');
  const telemetry = validateTelemetry(actor);
  const material = validateMaterialEvidence(actor, kind);
  const placement = validatePlacementEvidence(actor);
  const position = actor?.object3D?.position ?? actor?.position ?? null;
  const x = finite(position?.x);
  const z = finite(position?.z);
  const playerX = finite(options?.playerPosition?.x);
  const playerZ = finite(options?.playerPosition?.z);
  const distanceMeters = Math.hypot(x - playerX, z - playerZ);
  return freeze({
    index,
    actorId: asString(actor?.id ?? actor?.actorId ?? actor?.object3D?.uuid, `actor-${index}`),
    kind,
    distanceMeters,
    telemetry,
    material,
    placement,
    accepted: telemetry.accepted && material.accepted && placement.accepted,
  });
}

export function collectLivingWorldReactionEvidence({ actors = [], playerPosition = null, frameMs = 0, tickMs = 0, sceneAssetCount = 0 } = {}) {
  const safeActors = Array.isArray(actors) ? actors.slice(0, LIVING_WORLD_REACTION_EVIDENCE_POLICY.maxActors) : [];
  const actorEvidence = safeActors.map((actor, index) => summarizeActor(actor, index, { playerPosition }));
  const accepted = actorEvidence.filter((entry) => entry.accepted).length;
  const near = actorEvidence.filter((entry) => entry.telemetry.lod === 'near').length;
  const distant = actorEvidence.filter((entry) => entry.telemetry.lod === 'distant').length;
  const far = actorEvidence.filter((entry) => entry.telemetry.lod === 'far').length;
  const culled = actorEvidence.filter((entry) => entry.telemetry.lod === 'culled').length;
  const summary = {
    actorCount: safeActors.length,
    acceptedActors: accepted,
    rejectedActors: safeActors.length - accepted,
    lod: { near, distant, far, culled },
    performance: {
      frameMs: Math.max(0, finite(frameMs)),
      tickMs: Math.max(0, finite(tickMs)),
      sceneAssetCount: Math.max(0, finite(sceneAssetCount)),
    },
  };
  return freeze({
    policyId: LIVING_WORLD_REACTION_EVIDENCE_POLICY.id,
    actors: freeze(actorEvidence),
    summary: freeze(summary),
    sharedContract: freeze({ material: LIVING_WORLD_REACTION_EVIDENCE_POLICY.sharedMaterialCore, placement: LIVING_WORLD_REACTION_EVIDENCE_POLICY.sharedPlacementCore }),
    digest: digest({ actorEvidence, summary }),
  });
}

export function validateLivingWorldReactionEvidence(evidence) {
  const errors = [];
  if (!evidence || evidence.policyId !== LIVING_WORLD_REACTION_EVIDENCE_POLICY.id) errors.push('policy-mismatch');
  if (!Array.isArray(evidence?.actors)) errors.push('actors-missing');
  if (evidence?.actors?.length > LIVING_WORLD_REACTION_EVIDENCE_POLICY.maxActors) errors.push('actor-overflow');
  for (const actor of evidence?.actors ?? []) {
    if (!actor.accepted) errors.push(`actor-rejected:${actor.actorId}`);
    if (actor.material?.surfaceCount > LIVING_WORLD_REACTION_EVIDENCE_POLICY.maxMaterialSurfaces) errors.push(`material-surface-overflow:${actor.actorId}`);
    if (actor.telemetry?.historyCount > LIVING_WORLD_REACTION_EVIDENCE_POLICY.maxHistoryEntries) errors.push(`history-overflow:${actor.actorId}`);
  }
  const shared = evidence?.sharedContract;
  if (shared?.material !== LIVING_WORLD_REACTION_EVIDENCE_POLICY.sharedMaterialCore) errors.push('shared-material-core-mismatch');
  if (shared?.placement !== LIVING_WORLD_REACTION_EVIDENCE_POLICY.sharedPlacementCore) errors.push('shared-placement-core-mismatch');
  return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: digest(evidence) });
}

export function buildLivingWorldReactionAcceptanceSummary(evidence, runtimeResult) {
  const validation = validateLivingWorldReactionEvidence(evidence);
  const runtimeAccepted = runtimeResult?.accepted === true;
  const runtimeAudit = runtimeResult?.results?.every((result) => result?.relation && result?.directive) ?? false;
  const zeroRejected = evidence?.summary?.rejectedActors === 0;
  const summary = freeze({
    accepted: validation.ok && runtimeAccepted && runtimeAudit && zeroRejected,
    runtimeAccepted,
    runtimeAudit,
    zeroRejected,
    proof: freeze({
      assetMaterialValidated: evidence?.actors?.every((actor) => actor.material.accepted) ?? false,
      placementValidated: evidence?.actors?.every((actor) => actor.placement.accepted) ?? false,
      lodBounded: evidence?.summary?.lod?.culled >= 0,
      frameMs: evidence?.summary?.performance?.frameMs ?? 0,
      tickMs: evidence?.summary?.performance?.tickMs ?? 0,
    }),
    digest: digest({ evidence, runtimeResult, validation }),
  });
  return summary;
}

export function livingWorldReactionEvidenceDigest(value) {
  return digest(value);
}

export function auditLivingWorldReactionEvidencePolicy(value) {
  const errors = [];
  if (!value || typeof value !== 'object') errors.push('missing-value');
  if (value?.policyId != null && value.policyId !== LIVING_WORLD_REACTION_EVIDENCE_POLICY.id) errors.push('policy-mismatch');
  if (value?.summary?.actorCount > LIVING_WORLD_REACTION_EVIDENCE_POLICY.maxActors) errors.push('actor-count-overflow');
  return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: digest(value) });
}
