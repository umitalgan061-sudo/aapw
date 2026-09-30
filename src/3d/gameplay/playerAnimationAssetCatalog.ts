/** Production TypeScript owner for src/3d/gameplay/playerAnimationAssetCatalog.js. Legacy .js remains compatibility-only. */

export interface PlayerAnimationClip {
  readonly semantic: string;
  readonly action: string;
  readonly path: string | null;
  readonly authored: boolean;
  readonly inPlace: boolean;
  readonly required: boolean;
}

export interface PlayerAnimationCatalog {
  readonly version: number;
  readonly familyId: string;
  readonly modelPath: string;
  readonly source: string;
  readonly rigFamily: string;
  readonly clips: Readonly<Record<string, PlayerAnimationClip>>;
}

export interface PlayerAnimationAssetResolution {
  readonly requestedSemantic: string;
  readonly resolvedSemantic: string | null;
  readonly action: string | null;
  readonly key: string | null;
  readonly path: string | null;
  readonly authored: boolean;
  readonly inPlace: boolean;
  readonly fallback: boolean;
}

export interface PlayerAnimationAvailabilityItem extends PlayerAnimationClip {
  readonly hydrated: boolean;
  readonly loadable: boolean;
}

export interface PlayerAnimationAudit {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly totalSlots: number;
  readonly authoredSlots: number;
  readonly requiredSlots: number;
  readonly authoredRequiredSlots: number;
}

export interface PlayerAnimationProvenanceEvidence {
  readonly version: number;
  readonly familyId: string;
  readonly headSha: string;
  readonly mainSha: string;
  readonly requiredPaths: readonly string[];
  readonly missingRequired: readonly string[];
  readonly allRequiredHydrated: boolean;
  readonly optionalCombatSlots: readonly string[];
  readonly hydratedModel: boolean;
}

export const PLAYER_ANIMATION_ASSET_CATALOG: PlayerAnimationCatalog = Object.freeze({
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

const SEMANTIC_TO_KEY: Readonly<Record<string, string>> = Object.freeze({
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

const FALLBACK_BY_SEMANTIC: Readonly<Record<string, readonly string[]>> = Object.freeze({
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

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const semanticKey = (semanticState: unknown): string => {
  const normalized = String(semanticState ?? 'idle').trim().toLowerCase();
  return SEMANTIC_TO_KEY[normalized] ?? 'idle';
};

const finite = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const cleanPath = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const cloneClip = (clip: unknown): PlayerAnimationClip | null => {
  if (!clip || typeof clip !== 'object') return null;
  const source = asRecord(clip);
  return Object.freeze({
    semantic: String(source.semantic ?? ''),
    action: String(source.action ?? ''),
    path: cleanPath(source.path),
    authored: Boolean(source.authored),
    inPlace: source.inPlace !== false,
    required: Boolean(source.required),
  });
};

const readCatalog = (catalog: PlayerAnimationCatalog | unknown): PlayerAnimationCatalog => {
  const source = asRecord(catalog);
  const clips = Object.fromEntries(
    Object.entries(asRecord(source.clips))
      .map(([key, value]) => [key, cloneClip(value)])
      .filter((entry): entry is [string, PlayerAnimationClip] => entry[1] !== null),
  );
  return Object.freeze({
    version: Math.max(1, Math.floor(finite(source.version, 1))),
    familyId: String(source.familyId ?? ''),
    modelPath: cleanPath(source.modelPath) ?? '',
    source: String(source.source ?? ''),
    rigFamily: String(source.rigFamily ?? ''),
    clips: Object.freeze(clips),
  });
};

export function listPlayerAnimationAssets(catalog: PlayerAnimationCatalog | unknown = PLAYER_ANIMATION_ASSET_CATALOG): readonly PlayerAnimationClip[] {
  return Object.freeze(Object.values(readCatalog(catalog).clips).map(cloneClip).filter((clip): clip is PlayerAnimationClip => clip !== null));
}

export function getPlayerAnimationClip(key: string, catalog: PlayerAnimationCatalog | unknown = PLAYER_ANIMATION_ASSET_CATALOG): PlayerAnimationClip | null {
  const clips = readCatalog(catalog).clips;
  return cloneClip(clips[key] ?? null);
}

export function resolvePlayerAnimationAsset(
  semanticState = 'idle',
  {
    catalog = PLAYER_ANIMATION_ASSET_CATALOG,
    availableActions = null,
  }: {
    catalog?: PlayerAnimationCatalog | unknown;
    availableActions?: Record<string, unknown> | null;
  } = {},
): PlayerAnimationAssetResolution {
  const normalizedSemantic = String(semanticState ?? 'idle').trim().toLowerCase();
  const catalogValue = readCatalog(catalog);
  const clips = catalogValue.clips;
  const requestedKey = semanticKey(normalizedSemantic);
  const available = availableActions && typeof availableActions === 'object' ? availableActions : null;
  const candidates = FALLBACK_BY_SEMANTIC[normalizedSemantic] ?? [requestedKey, 'idle'];
  for (const key of candidates) {
    const clip = clips[key];
    if (!clip) continue;
    const action = available
      ? String(available[clip.semantic] ?? available[clip.action] ?? available[key] ?? '')
      : clip.action;
    if (!action) continue;
    if (clip.authored && !clip.path) continue;
    return Object.freeze({
      requestedSemantic: normalizedSemantic,
      resolvedSemantic: clip.semantic,
      action,
      key,
      path: cleanPath(clip.path),
      authored: clip.authored,
      inPlace: clip.inPlace,
      fallback: key !== requestedKey,
    });
  }
  const idleAction = available ? available.idle : null;
  if (idleAction) {
    const idle = clips.idle;
    return Object.freeze({
      requestedSemantic: normalizedSemantic,
      resolvedSemantic: idle?.semantic ?? 'idle',
      action: String(idleAction),
      key: 'idle',
      path: cleanPath(idle?.path),
      authored: Boolean(idle?.authored),
      inPlace: idle?.inPlace !== false,
      fallback: true,
    });
  }
  return Object.freeze({
    requestedSemantic: normalizedSemantic,
    resolvedSemantic: null,
    action: null,
    key: null,
    path: null,
    authored: false,
    inPlace: true,
    fallback: true,
  });
}

export function requiredPlayerAnimationPaths(catalog: PlayerAnimationCatalog | unknown = PLAYER_ANIMATION_ASSET_CATALOG): readonly string[] {
  return Object.freeze(listPlayerAnimationAssets(catalog)
    .filter((clip) => clip.required)
    .map((clip) => clip.path)
    .filter((path): path is string => Boolean(path))
    .sort());
}

export function unavailablePlayerAnimationSlots(catalog: PlayerAnimationCatalog | unknown = PLAYER_ANIMATION_ASSET_CATALOG): readonly string[] {
  return Object.freeze(listPlayerAnimationAssets(catalog)
    .filter((clip) => !clip.authored)
    .map((clip) => clip.semantic)
    .sort());
}

export function auditPlayerAnimationCatalog(catalog: PlayerAnimationCatalog | unknown = PLAYER_ANIMATION_ASSET_CATALOG): PlayerAnimationAudit {
  const errors: string[] = [];
  const warnings: string[] = [];
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
}: {
  catalog?: PlayerAnimationCatalog | unknown;
  hydratedPaths?: readonly unknown[];
} = {}) {
  const hydrated = new Set(hydratedPaths.map(cleanPath).filter((path): path is string => Boolean(path)));
  const assets: readonly PlayerAnimationAvailabilityItem[] = Object.freeze(listPlayerAnimationAssets(catalog).map((clip) => Object.freeze({
    ...clip,
    hydrated: Boolean(clip.path && hydrated.has(clip.path)),
    loadable: Boolean(clip.authored && clip.path && hydrated.has(clip.path)),
  })));
  return Object.freeze({
    assets,
    requiredMissing: Object.freeze(assets.filter((clip) => clip.required && !clip.loadable).map((clip) => clip.path).filter((path): path is string => Boolean(path)).sort()),
    optionalMissing: Object.freeze(assets.filter((clip) => !clip.required && clip.authored && !clip.loadable).map((clip) => clip.path).filter((path): path is string => Boolean(path)).sort()),
  });
}

export function summarizePlayerAnimationAssets(catalog: PlayerAnimationCatalog | unknown = PLAYER_ANIMATION_ASSET_CATALOG) {
  const normalized = readCatalog(catalog);
  const audit = auditPlayerAnimationCatalog(normalized);
  return Object.freeze({
    familyId: normalized.familyId,
    modelPath: cleanPath(normalized.modelPath),
    source: normalized.source,
    rigFamily: normalized.rigFamily,
    required: audit.requiredSlots,
    authored: audit.authoredSlots,
    missingOptionalSemantics: unavailablePlayerAnimationSlots(normalized),
    requiredPaths: requiredPlayerAnimationPaths(normalized),
  });
}

export function getPlayerAnimationLoadPlan({
  catalog = PLAYER_ANIMATION_ASSET_CATALOG,
  availableActions = null,
}: {
  catalog?: PlayerAnimationCatalog | unknown;
  availableActions?: Record<string, unknown> | null;
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
}: {
  catalog?: PlayerAnimationCatalog | unknown;
  hydratedPaths?: readonly unknown[];
  headSha?: string;
  mainSha?: string;
} = {}): PlayerAnimationProvenanceEvidence {
  const normalized = readCatalog(catalog);
  const availability = buildPlayerAnimationAvailability({ catalog: normalized, hydratedPaths });
  return Object.freeze({
    version: normalized.version,
    familyId: normalized.familyId,
    headSha: String(headSha || ''),
    mainSha: String(mainSha || ''),
    requiredPaths: Object.freeze(requiredPlayerAnimationPaths(normalized)),
    missingRequired: availability.requiredMissing,
    allRequiredHydrated: availability.requiredMissing.length === 0,
    optionalCombatSlots: Object.freeze(unavailablePlayerAnimationSlots(normalized)),
    hydratedModel: hydratedPaths.map(cleanPath).includes(normalized.modelPath),
  });
}

export function scoreAnimationAssetCompleteness(catalog: PlayerAnimationCatalog | unknown = PLAYER_ANIMATION_ASSET_CATALOG) {
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
