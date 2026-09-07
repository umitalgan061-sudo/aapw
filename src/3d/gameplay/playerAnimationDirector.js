/**
 * Deterministic presentation bridge for the existing player action state machine.
 *
 * Player state, movement, collision and combat timing remain owned by player.js. This module only
 * resolves an existing action, asset provenance, and environment-aware presentation values.
 *
 * @module gameplay/playerAnimationDirector
 */
import {
  PLAYER_ANIMATION_ASSET_CATALOG,
  auditPlayerAnimationCatalog,
  buildPlayerAnimationProvenanceEvidence,
  getPlayerAnimationLoadPlan,
  resolvePlayerAnimationAsset,
} from './playerAnimationAssetCatalog.js';
import {
  resolveEnvironmentalAnimationProfile,
  resolveGroundContactPresentation,
  resolveLocomotionBlendProfile,
  validateEnvironmentalAnimationContext,
} from './playerEnvironmentalAnimationProfile.js';
import {
  inspectPlayerSurfaceEvidence,
  buildPlayerSurfaceManifest,
  summarizePlayerSurfaceQuality,
} from './playerAnimationSurfaceEvidence.js';

export const PLAYER_ANIMATION_DIRECTOR_VERSION = '2026-09-07-v2';

const FALLBACK_ACTIONS = Object.freeze({ idle: 'idle', locomotion: 'walking', sprint: 'running' });

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resolvePreferredSemantic({
  planarSpeedMps = 0,
  runIntent = false,
  attackKind = 'none',
  guarding = false,
  dodgeRemaining = 0,
  hitStaggerRemaining = 0,
} = {}) {
  const speed = Math.max(0, finite(planarSpeedMps));
  if (hitStaggerRemaining > 0) return 'hit-stagger';
  if (dodgeRemaining > 0) return 'dodge';
  if (attackKind === 'heavy') return 'heavy-attack';
  if (attackKind === 'light') return 'light-attack';
  if (guarding) return 'guard';
  if (runIntent || speed >= 5.6) return 'sprint';
  if (speed >= 0.15) return 'locomotion';
  return 'idle';
}

export function resolvePlayerAnimationIntent({
  movementState = 'idle',
  planarSpeedMps = 0,
  runIntent = false,
  attackKind = 'none',
  guarding = false,
  dodgeRemaining = 0,
  hitStaggerRemaining = 0,
  availableActions = FALLBACK_ACTIONS,
} = {}) {
  const actions = availableActions && typeof availableActions === 'object' ? availableActions : FALLBACK_ACTIONS;
  const preferred = resolvePreferredSemantic({ planarSpeedMps, runIntent, attackKind, guarding, dodgeRemaining, hitStaggerRemaining });
  const asset = resolvePlayerAnimationAsset(preferred, {
    availableActions: actions,
    catalog: PLAYER_ANIMATION_ASSET_CATALOG,
  });
  const speed = Math.max(0, finite(planarSpeedMps));
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
    movementState: String(movementState),
    speedMps: Number(speed.toFixed(3)),
    timeScale: Number(timeScale.toFixed(3)),
  });
}

export function resolvePlayerAnimationPresentation({
  movementState = 'idle',
  planarSpeedMps = 0,
  runIntent = false,
  attackKind = 'none',
  guarding = false,
  dodgeRemaining = 0,
  hitStaggerRemaining = 0,
  availableActions = FALLBACK_ACTIONS,
  environment = {},
  baseSpeedMps = 6.5,
  leftFootGroundDeltaMeters = 0,
  rightFootGroundDeltaMeters = 0,
  pelvisGroundDeltaMeters = 0,
  walkSpeedMps = 3.2,
  runSpeedMps = 6.5,
} = {}) {
  const intent = resolvePlayerAnimationIntent({ movementState, planarSpeedMps, runIntent, attackKind, guarding, dodgeRemaining, hitStaggerRemaining, availableActions });
  const environmentValidation = validateEnvironmentalAnimationContext(environment);
  const environmental = resolveEnvironmentalAnimationProfile(environmentValidation.normalized, intent.semanticState, { baseSpeedMps });
  const blend = resolveLocomotionBlendProfile({ planarSpeedMps, walkSpeedMps, runSpeedMps, footPlantWeight: environmental.footPlantWeight, stepConfidence: environmental.stepConfidence });
  const contact = resolveGroundContactPresentation({ leftFootGroundDeltaMeters, rightFootGroundDeltaMeters, pelvisGroundDeltaMeters });
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
  actions = {},
  playAction,
  onPresentation = null,
} = {}) {
  if (typeof playAction !== 'function') throw new TypeError('playAction callback is required');
  let lastSemanticState = null;
  let lastPresentationSignature = null;
  return Object.freeze({
    update(input = {}) {
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

export function inspectPlayerModelSurfaceEvidence(root, metadata = {}) {
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
