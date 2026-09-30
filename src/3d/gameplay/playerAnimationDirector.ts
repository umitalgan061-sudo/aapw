/** Production TypeScript owner for src/3d/gameplay/playerAnimationDirector.js. Legacy .js remains compatibility-only. */

import {
  PLAYER_ANIMATION_ASSET_CATALOG,
  auditPlayerAnimationCatalog,
  buildPlayerAnimationProvenanceEvidence,
  getPlayerAnimationLoadPlan,
  resolvePlayerAnimationAsset,
} from './playerAnimationAssetCatalog.ts';
import {
  resolveEnvironmentalAnimationProfile,
  resolveGroundContactPresentation,
  resolveLocomotionBlendProfile,
  validateEnvironmentalAnimationContext,
} from './playerEnvironmentalAnimationProfile.ts';
import {
  inspectPlayerSurfaceEvidence,
  buildPlayerSurfaceManifest,
  summarizePlayerSurfaceQuality,
} from './playerAnimationSurfaceEvidence.ts';

export const PLAYER_ANIMATION_DIRECTOR_VERSION = '2026-09-30-v3' as const;

const FALLBACK_ACTIONS = Object.freeze({ idle: 'idle', locomotion: 'walking', sprint: 'running' });

type NumericLike = number | string | null | undefined;
export interface PlayerAnimationActionMap {
  readonly [name: string]: unknown;
}
export interface PlayerAnimationInput {
  readonly movementState?: string;
  readonly planarSpeedMps?: NumericLike;
  readonly runIntent?: boolean;
  readonly attackKind?: 'none' | 'light' | 'heavy' | string;
  readonly guarding?: boolean;
  readonly dodgeRemaining?: NumericLike;
  readonly hitStaggerRemaining?: NumericLike;
  readonly availableActions?: PlayerAnimationActionMap;
  readonly environment?: Record<string, unknown>;
  readonly baseSpeedMps?: NumericLike;
  readonly leftFootGroundDeltaMeters?: NumericLike;
  readonly rightFootGroundDeltaMeters?: NumericLike;
  readonly pelvisGroundDeltaMeters?: NumericLike;
  readonly walkSpeedMps?: NumericLike;
  readonly runSpeedMps?: NumericLike;
}
export interface PlayerAnimationPresentation {
  readonly version: typeof PLAYER_ANIMATION_DIRECTOR_VERSION;
  readonly action: string;
  readonly semanticState: string;
  readonly resolvedSemanticState: string;
  readonly assetKey: string;
  readonly assetPath: string;
  readonly authoredAsset: boolean;
  readonly fallback: boolean;
  readonly movementState: string;
  readonly speedMps: number;
  readonly timeScale: number;
  readonly environmental: unknown;
  readonly blend: unknown;
  readonly contact: unknown;
  readonly environmentValid: boolean;
}
export interface PlayerAnimationDirectorOptions {
  readonly actions?: PlayerAnimationActionMap;
  readonly playAction: (name: string, timeScale?: number) => void;
  readonly onPresentation?: ((presentation: PlayerAnimationPresentation) => void) | null;
}
export interface PlayerAnimationDirector {
  readonly update: (input?: PlayerAnimationInput) => PlayerAnimationPresentation;
  readonly reset: () => void;
}

const finite = (value: NumericLike, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
const clamp = (value: NumericLike, min: number, max: number): number => Math.max(min, Math.min(max, finite(value, min)));

function resolvePreferredSemantic({
  planarSpeedMps = 0,
  runIntent = false,
  attackKind = 'none',
  guarding = false,
  dodgeRemaining = 0,
  hitStaggerRemaining = 0,
}: Pick<PlayerAnimationInput, 'planarSpeedMps' | 'runIntent' | 'attackKind' | 'guarding' | 'dodgeRemaining' | 'hitStaggerRemaining'> = {}): string {
  const speed = Math.max(0, finite(planarSpeedMps, 0));
  if (finite(hitStaggerRemaining) > 0) return 'hit-stagger';
  if (finite(dodgeRemaining) > 0) return 'dodge';
  if (attackKind === 'heavy') return 'heavy-attack';
  if (attackKind === 'light') return 'light-attack';
  if (guarding) return 'guard';
  if (runIntent || speed >= 5.6) return 'sprint';
  if (speed >= 0.15) return 'locomotion';
  return 'idle';
}

export function resolvePlayerAnimationIntent(input: PlayerAnimationInput = {}) {
  const actions = input.availableActions && typeof input.availableActions === 'object' ? input.availableActions : FALLBACK_ACTIONS;
  const preferred = resolvePreferredSemantic(input);
  const asset = resolvePlayerAnimationAsset(preferred, {
    availableActions: actions,
    catalog: PLAYER_ANIMATION_ASSET_CATALOG,
  });
  const speed = Math.max(0, finite(input.planarSpeedMps, 0));
  const timeScale = preferred === 'sprint'
    ? clamp(speed / 6.5, 0.9, 1.35)
    : preferred === 'dodge' ? 1.45 : 1;
  return Object.freeze({
    action: asset.action,
    semanticState: preferred,
    resolvedSemanticState: asset.resolvedSemantic,
    assetKey: asset.key,
    assetPath: asset.path,
    authoredAsset: asset.authored,
    fallback: asset.fallback,
    movementState: String(input.movementState ?? 'idle'),
    speedMps: Number(speed.toFixed(3)),
    timeScale: Number(timeScale.toFixed(3)),
  });
}

export function resolvePlayerAnimationPresentation(input: PlayerAnimationInput = {}) {
  const intent = resolvePlayerAnimationIntent(input);
  const environmentValidation = validateEnvironmentalAnimationContext(input.environment ?? {});
  const environmental = resolveEnvironmentalAnimationProfile(
    environmentValidation.normalized,
    intent.semanticState,
    { baseSpeedMps: finite(input.baseSpeedMps, 6.5) },
  );
  const blend = resolveLocomotionBlendProfile({
    planarSpeedMps: finite(input.planarSpeedMps, 0),
    walkSpeedMps: finite(input.walkSpeedMps, 3.2),
    runSpeedMps: finite(input.runSpeedMps, 6.5),
    footPlantWeight: environmental.footPlantWeight,
    stepConfidence: environmental.stepConfidence,
  });
  const contact = resolveGroundContactPresentation({
    leftFootGroundDeltaMeters: finite(input.leftFootGroundDeltaMeters, 0),
    rightFootGroundDeltaMeters: finite(input.rightFootGroundDeltaMeters, 0),
    pelvisGroundDeltaMeters: finite(input.pelvisGroundDeltaMeters, 0),
  });
  return Object.freeze({
    version: PLAYER_ANIMATION_DIRECTOR_VERSION,
    ...intent,
    environmental,
    blend,
    contact,
    environmentValid: environmentValidation.ok,
  });
}

export function createPlayerAnimationDirector({
  actions = FALLBACK_ACTIONS,
  playAction,
  onPresentation = null,
}: PlayerAnimationDirectorOptions): PlayerAnimationDirector {
  if (typeof playAction !== 'function') throw new TypeError('playAction callback is required');
  let lastSemanticState: string | null = null;
  let lastPresentationSignature: string | null = null;
  return Object.freeze({
    update(input: PlayerAnimationInput = {}) {
      const presentation = resolvePlayerAnimationPresentation({ ...input, availableActions: actions });
      if (presentation.semanticState !== lastSemanticState && presentation.action) {
        playAction(presentation.action, presentation.timeScale);
        lastSemanticState = presentation.semanticState;
      }
      const signature = JSON.stringify(presentation.environmental) + JSON.stringify(presentation.blend) + JSON.stringify(presentation.contact);
      if (signature !== lastPresentationSignature && typeof onPresentation === 'function') onPresentation(presentation);
      lastPresentationSignature = signature;
      return presentation;
    },
    reset() {
      lastSemanticState = null;
      lastPresentationSignature = null;
    },
  });
}

export function inspectPlayerModelSurfaceEvidence(root: unknown, metadata: Record<string, unknown> = {}) {
  const evidence = inspectPlayerSurfaceEvidence(root);
  const manifest = buildPlayerSurfaceManifest(root, metadata);
  return Object.freeze({
    evidence,
    manifest,
    quality: summarizePlayerSurfaceQuality(evidence),
  });
}

export function auditPlayerAnimationDirector({
  catalog = PLAYER_ANIMATION_ASSET_CATALOG,
  mainSha = '',
  headSha = '',
  hydratedPaths = [],
}: {
  catalog?: unknown;
  mainSha?: string;
  headSha?: string;
  hydratedPaths?: readonly string[];
} = {}) {
  const catalogAudit = auditPlayerAnimationCatalog(catalog);
  const evidence = buildPlayerAnimationProvenanceEvidence({ catalog, hydratedPaths, mainSha, headSha });
  return Object.freeze({
    version: PLAYER_ANIMATION_DIRECTOR_VERSION,
    ok: catalogAudit.ok && evidence.allRequiredHydrated,
    catalog: catalogAudit,
    provenance: evidence,
    loadPlan: getPlayerAnimationLoadPlan({ catalog }),
  });
}

export function resolvePlayerAnimationTransition({
  previousSemanticState = 'idle',
  planarSpeedMps = 0,
  runIntent = false,
  attackKind = 'none',
  guarding = false,
  dodgeRemaining = 0,
  hitStaggerRemaining = 0,
  sprintEnterSpeedMps = 5.6,
  sprintExitSpeedMps = 5.1,
}: Pick<PlayerAnimationInput, 'planarSpeedMps' | 'runIntent' | 'attackKind' | 'guarding' | 'dodgeRemaining' | 'hitStaggerRemaining'> & {
  previousSemanticState?: string;
  sprintEnterSpeedMps?: NumericLike;
  sprintExitSpeedMps?: NumericLike;
} = {}): string {
  const enter = Math.max(0, finite(sprintEnterSpeedMps, 5.6));
  const exit = clamp(sprintExitSpeedMps, 0, enter);
  const speed = Math.max(0, finite(planarSpeedMps, 0));
  const forced = resolvePreferredSemantic({ planarSpeedMps: speed, runIntent, attackKind, guarding, dodgeRemaining, hitStaggerRemaining });
  if (forced !== 'sprint' && forced !== 'locomotion') return forced;
  if (previousSemanticState === 'sprint') return speed >= exit || Boolean(runIntent) ? 'sprint' : forced;
  return speed >= enter || Boolean(runIntent) ? 'sprint' : forced;
}
