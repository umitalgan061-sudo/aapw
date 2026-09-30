/**
 * Asset-first inventory for the shipped player animation family.
 *
 * This module records what is actually authored in the repository today. It does not invent
 * combat clips that are not present on disk and it never treats a Git-LFS pointer as hydrated.
 *
 * @module gameplay/playerAnimationAssetCatalog
 */

export const PLAYER_ANIMATION_ASSET_CATALOG = Object.freeze({
  version: 2,
  familyId: 'peasant_girl_mixamo_inplace_v1',
  modelPath: 'assets/models/characters/peasant_girl.fbx',
  source: 'Adobe Mixamo',
  rigFamily: 'mixamo-standard',
  clips: Object.freeze({
    idle: Object.freeze({ semantic: 'idle', action: 'idle', path: 'assets/animations/peasant_girl/idle.fbx', authored: true, inPlace: false, required: true }),
    walking: Object.freeze({ semantic: 'locomotion', action: 'walking', path: 'assets/animations/peasant_girl/walking.fbx', authored: true, inPlace: true, required: true }),
    running: Object.freeze({ semantic: 'sprint', action: 'running', path: 'assets/animations/peasant_girl/running.fbx', authored: true, inPlace: true, required: true }),
    guard: Object.freeze({ semantic: 'guard', action: 'guard', path: null, authored: false, inPlace: true, required: false }),
    parry: Object.freeze({ semantic: 'parry', action: 'parry', path: null, authored: false, inPlace: true, required: false }),
    dodge: Object.freeze({ semantic: 'dodge', action: 'dodge', path: null, authored: false, inPlace: true, required: false }),
    lightAttack: Object.freeze({ semantic: 'light-attack', action: 'light-attack', path: null, authored: false, inPlace: true, required: false }),
    heavyAttack: Object.freeze({ semantic: 'heavy-attack', action: 'heavy-attack', path: null, authored: false, inPlace: true, required: false }),
    hitStagger: Object.freeze({ semantic: 'hit-stagger', action: 'hit-stagger', path: null, authored: false, inPlace: true, required: false }),
  }),
});

const SEMANTIC_TO_KEY = Object.freeze({
  idle: 'idle',
  locomotion: 'walking',
  sprint: 'running',
  guard: 'guard',
  parry: 'parry',
  dodge: 'dodge',
  'light-attack': 'lightAttack',
  'heavy-attack': 'heavyAttack',
  'hit-stagger': 'hitStagger',
});

const FALLBACK_BY_SEMANTIC = Object.freeze({
  'light-attack': ['lightAttack', 'idle'],
  'heavy-attack': ['heavyAttack', 'idle'],
  guard: ['guard', 'locomotion', 'idle'],
  parry: ['parry', 'guard', 'locomotion', 'idle'],
  dodge: ['dodge', 'locomotion', 'idle'],
  'hit-stagger': ['hitStagger', 'idle'],
  sprint: ['running', 'walking', 'idle'],
  locomotion: ['walking', 'idle'],
  idle: ['idle'],
});

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function semanticKey(semanticState) {
  const normalized = String(semanticState ?? 'idle').trim().toLowerCase();
  return SEMANTIC_TO_KEY[normalized] || 'idle';
}

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cleanPath(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cloneClip(clip) {
  if (!clip) return null;
  return Object.freeze({
    semantic: String(clip.semantic || ''),
    action: String(clip.action || ''),
    path: cleanPath(clip.path),
    authored: Boolean(clip.authored),
    inPlace: clip.inPlace !== false,
    required: Boolean(clip.required),
  });
}

export function listPlayerAnimationAssets(catalog = PLAYER_ANIMATION_ASSET_CATALOG) {
  const clips = asObject(catalog?.clips);
  return Object.values(clips).map(cloneClip).filter(Boolean);
}

export function getPlayerAnimationClip(key, catalog = PLAYER_ANIMATION_ASSET_CATALOG) {
  const clips = asObject(catalog?.clips);
  return cloneClip(clips[key] || null);
}

export function resolvePlayerAnimationAsset(semanticState = 'idle', {
  catalog = PLAYER_ANIMATION_ASSET_CATALOG,
  availableActions = null,
} = {}) {
  const clips = asObject(catalog?.clips);
  const requestedKey = semanticKey(semanticState);
  const available = availableActions && typeof availableActions === 'object' ? availableActions : null;
  const candidates = FALLBACK_BY_SEMANTIC[semanticState] || [requestedKey, 'idle'];
  for (const key of candidates) {
    const clip = clips[key];
    if (!clip) continue;
    const action = available ? available[clip.semantic] ?? available[clip.action] ?? available[key] : clip.action;
    if (!action) continue;
    if (clip.authored && !clip.path) continue;
    return Object.freeze({
      requestedSemantic: String(semanticState),
      resolvedSemantic: String(clip.semantic),
      action,
      key,
      path: cleanPath(clip.path),
      authored: Boolean(clip.authored),
      inPlace: clip.inPlace !== false,
      fallback: key !== requestedKey,
    });
  }
  if (available?.idle) {
    return Object.freeze({
      requestedSemantic: String(semanticState),
      resolvedSemantic: 'idle',
      action: available.idle,
      key: 'idle',
      path: cleanPath(clips.idle?.path),
      authored: Boolean(clips.idle?.authored),
      inPlace: clips.idle?.inPlace !== false,
      fallback: true,
    });
  }
  return Object.freeze({
    requestedSemantic: String(semanticState),
    resolvedSemantic: null,
    action: null,
    key: null,
    path: null,
    authored: false,
    inPlace: true,
    fallback: true,
  });
}

export function requiredPlayerAnimationPaths(catalog = PLAYER_ANIMATION_ASSET_CATALOG) {
  return listPlayerAnimationAssets(catalog)
    .filter((clip) => clip.required)
    .map((clip) => clip.path)
    .filter(Boolean)
    .sort();
}

export function unavailablePlayerAnimationSlots(catalog = PLAYER_ANIMATION_ASSET_CATALOG) {
  return listPlayerAnimationAssets(catalog)
    .filter((clip) => !clip.authored)
    .map((clip) => clip.semantic)
    .sort();
}

export function auditPlayerAnimationCatalog(catalog = PLAYER_ANIMATION_ASSET_CATALOG) {
  const errors = [];
  const warnings = [];
  const clips = listPlayerAnimationAssets(catalog);
  const required = clips.filter((clip) => clip.required);
  if (!required.some((clip) => clip.semantic === 'idle' && clip.authored && clip.path)) errors.push('required-idle-missing');
  if (!required.some((clip) => clip.semantic === 'locomotion' && clip.authored && clip.path && clip.inPlace)) errors.push('required-walking-missing');
  if (!required.some((clip) => clip.semantic === 'sprint' && clip.authored && clip.path && clip.inPlace)) errors.push('required-running-missing');
  for (const clip of clips) {
    if (clip.authored && !clip.path) errors.push(`authored-without-path:${clip.semantic}`);
    if (clip.required && !clip.authored) errors.push(`required-unauthored:${clip.semantic}`);
  }
  for (const semantic of unavailablePlayerAnimationSlots(catalog)) warnings.push(`optional-slot-unavailable:${semantic}`);
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    totalSlots: clips.length,
    authoredSlots: clips.filter((clip) => clip.authored).length,
    requiredSlots: required.length,
    authoredRequiredSlots: required.filter((clip) => clip.authored).length,
  });
}

export function buildPlayerAnimationAvailability({
  catalog = PLAYER_ANIMATION_ASSET_CATALOG,
  hydratedPaths = [],
} = {}) {
  const hydrated = new Set((Array.isArray(hydratedPaths) ? hydratedPaths : []).map(cleanPath).filter(Boolean));
  const assets = listPlayerAnimationAssets(catalog).map((clip) => Object.freeze({
    ...clip,
    hydrated: Boolean(clip.path && hydrated.has(clip.path)),
    loadable: Boolean(clip.authored && clip.path && hydrated.has(clip.path)),
  }));
  return Object.freeze({
    assets: Object.freeze(assets),
    requiredMissing: Object.freeze(assets.filter((clip) => clip.required && !clip.loadable).map((clip) => clip.path).filter(Boolean).sort()),
    optionalMissing: Object.freeze(assets.filter((clip) => !clip.required && clip.authored && !clip.loadable).map((clip) => clip.path).filter(Boolean).sort()),
  });
}

export function summarizePlayerAnimationAssets(catalog = PLAYER_ANIMATION_ASSET_CATALOG) {
  const audit = auditPlayerAnimationCatalog(catalog);
  return Object.freeze({
    familyId: String(catalog?.familyId || ''),
    modelPath: cleanPath(catalog?.modelPath),
    source: String(catalog?.source || ''),
    rigFamily: String(catalog?.rigFamily || ''),
    required: audit.requiredSlots,
    authored: audit.authoredSlots,
    missingOptionalSemantics: unavailablePlayerAnimationSlots(catalog),
    requiredPaths: requiredPlayerAnimationPaths(catalog),
  });
}

export function getPlayerAnimationLoadPlan({
  catalog = PLAYER_ANIMATION_ASSET_CATALOG,
  availableActions = null,
} = {}) {
  const plan = [];
  for (const semantic of ['idle', 'locomotion', 'sprint', 'guard', 'parry', 'dodge', 'light-attack', 'heavy-attack', 'hit-stagger']) {
    const resolved = resolvePlayerAnimationAsset(semantic, { catalog, availableActions });
    plan.push(Object.freeze({
      semantic,
      action: resolved.action,
      path: resolved.path,
      authored: resolved.authored,
      fallback: resolved.fallback,
      resolvedSemantic: resolved.resolvedSemantic,
    }));
  }
  return Object.freeze(plan);
}

export function buildPlayerAnimationProvenanceEvidence({
  catalog = PLAYER_ANIMATION_ASSET_CATALOG,
  hydratedPaths = [],
  headSha = '',
  mainSha = '',
} = {}) {
  const availability = buildPlayerAnimationAvailability({ catalog, hydratedPaths });
  return Object.freeze({
    version: Number(catalog?.version || 1),
    familyId: String(catalog?.familyId || ''),
    headSha: String(headSha || ''),
    mainSha: String(mainSha || ''),
    requiredPaths: Object.freeze(requiredPlayerAnimationPaths(catalog)),
    missingRequired: availability.requiredMissing,
    allRequiredHydrated: availability.requiredMissing.length === 0,
    optionalCombatSlots: Object.freeze(unavailablePlayerAnimationSlots(catalog)),
    hydratedModel: hydratedPaths.includes(catalog?.modelPath),
  });
}

export function scoreAnimationAssetCompleteness(catalog = PLAYER_ANIMATION_ASSET_CATALOG) {
  const clips = listPlayerAnimationAssets(catalog);
  const required = clips.filter((clip) => clip.required);
  const authoredRequired = required.filter((clip) => clip.authored && clip.path);
  const authoredAll = clips.filter((clip) => clip.authored && clip.path);
  return Object.freeze({
    totalSlots: clips.length,
    authoredSlots: authoredAll.length,
    requiredSlots: required.length,
    authoredRequiredSlots: authoredRequired.length,
    requiredRatio: required.length ? authoredRequired.length / required.length : 1,
    overallRatio: clips.length ? authoredAll.length / clips.length : 1,
    combatOptionalSlots: clips.filter((clip) => !clip.required).length,
  });
}
