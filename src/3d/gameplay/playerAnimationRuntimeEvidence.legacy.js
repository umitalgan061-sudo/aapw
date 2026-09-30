/**
 * Runtime evidence helpers for the existing Three.js player animation setup.
 *
 * These helpers do not create a controller, loader, mixer, renderer, or combat framework. They
 * inspect objects already produced by the shipped player path and turn them into deterministic QA
 * evidence: action availability, clip health, model surface evidence and fallback coverage.
 *
 * @module gameplay/playerAnimationRuntimeEvidence
 */
import {
  PLAYER_ANIMATION_ASSET_CATALOG,
  listPlayerAnimationAssets,
  resolvePlayerAnimationAsset,
} from './playerAnimationAssetCatalog.js';
import { inspectPlayerSurfaceEvidence } from './playerAnimationSurfaceEvidence.js';

const MAX_CLIP_DURATION_SECONDS = 30;
const MIN_CLIP_DURATION_SECONDS = 0.01;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sortedStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))].sort();
}

function actionNames(actions) {
  return sortedStrings(Object.keys(actions || {}));
}

function clipDuration(clip) {
  return finite(clip?.duration, 0);
}

function trackCount(clip) {
  return Array.isArray(clip?.tracks) ? clip.tracks.length : 0;
}

function validateClip(clip, label) {
  const errors = [];
  const duration = clipDuration(clip);
  if (!(duration >= MIN_CLIP_DURATION_SECONDS && duration <= MAX_CLIP_DURATION_SECONDS)) errors.push(`invalid-duration:${label}`);
  if (trackCount(clip) <= 0) errors.push(`no-tracks:${label}`);
  return Object.freeze({
    label,
    duration: Number(duration.toFixed(4)),
    trackCount: trackCount(clip),
    ok: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

function summarizeAction(action, label) {
  const hasAction = Boolean(action && typeof action === 'object');
  const clip = action?._clip || action?.clip || null;
  return Object.freeze({
    label,
    present: hasAction,
    running: typeof action?.isRunning === 'function' ? Boolean(action.isRunning()) : null,
    enabled: action?.enabled !== false,
    weight: Number.isFinite(Number(action?.weight)) ? Number(action.weight) : null,
    timeScale: Number.isFinite(Number(action?.timeScale)) ? Number(action.timeScale) : null,
    clip: clip ? validateClip(clip, label) : null,
  });
}

function modelSurfaceCount(root) {
  return inspectPlayerSurfaceEvidence(root);
}

export function inspectPlayerRuntimeAnimationSetup({
  model = null,
  mixer = null,
  actions = {},
  availableActions = null,
} = {}) {
  const errors = [];
  const warnings = [];
  if (!model || typeof model !== 'object') errors.push('player-model-missing');
  if (!mixer || typeof mixer !== 'object') errors.push('animation-mixer-missing');

  const names = actionNames(actions);
  const actionEvidence = names.map((name) => summarizeAction(actions[name], name));
  const presentCount = actionEvidence.filter((entry) => entry.present).length;
  const unhealthyClips = actionEvidence.filter((entry) => entry.clip && !entry.clip.ok).map((entry) => entry.label);
  if (unhealthyClips.length) errors.push(...unhealthyClips.map((label) => `unhealthy-clip:${label}`));

  const catalog = listPlayerAnimationAssets(PLAYER_ANIMATION_ASSET_CATALOG);
  const actualAvailable = availableActions && typeof availableActions === 'object'
    ? availableActions
    : Object.fromEntries(names.map((name) => [name, actions[name]]));
  const fallbackCoverage = [];
  for (const entry of catalog) {
    const resolved = resolvePlayerAnimationAsset(entry.semantic, {
      catalog: PLAYER_ANIMATION_ASSET_CATALOG,
      availableActions: actualAvailable,
    });
    fallbackCoverage.push(Object.freeze({
      semantic: entry.semantic,
      action: resolved.action || null,
      resolvedSemantic: resolved.resolvedSemantic,
      authored: resolved.authored,
      fallback: resolved.fallback,
    }));
  }

  const surface = modelSurfaceCount(model);
  if (!surface.ok) errors.push('player-surface-validation-failed');
  if (surface.meshCount === 1 && surface.surfaceCount === 1 && surface.textureBearingSurfaceCount === 0) warnings.push('single-flat-player-surface');
  if (!presentCount) warnings.push('no-animation-actions-present');

  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze([...new Set(errors)]),
    warnings: Object.freeze([...new Set(warnings)]),
    actionNames: Object.freeze(names),
    actionCount: presentCount,
    actionEvidence: Object.freeze(actionEvidence),
    fallbackCoverage: Object.freeze(fallbackCoverage),
    surfaceEvidence: surface,
    mixerPresent: Boolean(mixer && typeof mixer === 'object'),
    modelPresent: Boolean(model && typeof model === 'object'),
  });
}

export function buildPlayerRuntimeAnimationManifest(setup, {
  headSha = '',
  mainSha = '',
  assetFamilyId = PLAYER_ANIMATION_ASSET_CATALOG.familyId,
} = {}) {
  const evidence = setup || inspectPlayerRuntimeAnimationSetup();
  return Object.freeze({
    version: 1,
    headSha: String(headSha || ''),
    mainSha: String(mainSha || ''),
    assetFamilyId: String(assetFamilyId || ''),
    ok: Boolean(evidence.ok),
    actionNames: evidence.actionNames || Object.freeze([]),
    fallbackCoverage: evidence.fallbackCoverage || Object.freeze([]),
    surface: evidence.surfaceEvidence || null,
    errors: evidence.errors || Object.freeze([]),
    warnings: evidence.warnings || Object.freeze([]),
  });
}

export function auditPlayerRuntimeActionCoverage(actions = {}, {
  requireIdle = true,
  requireLocomotion = true,
  requireSprint = true,
} = {}) {
  const errors = [];
  const names = new Set(actionNames(actions));
  if (requireIdle && !names.has('idle')) errors.push('missing-idle-action');
  if (requireLocomotion && !names.has('walking')) errors.push('missing-walking-action');
  if (requireSprint && !names.has('running')) errors.push('missing-running-action');
  const optionalMissing = ['guard', 'parry', 'dodge', 'light-attack', 'heavy-attack', 'hit-stagger']
    .filter((name) => !names.has(name))
    .sort();
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    present: Object.freeze([...names].sort()),
    optionalMissing: Object.freeze(optionalMissing),
    requiredCount: [requireIdle, requireLocomotion, requireSprint].filter(Boolean).length,
  });
}

export function isFiniteAnimationManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return false;
  if (typeof manifest.ok !== 'boolean') return false;
  const lists = [manifest.actionNames, manifest.errors, manifest.warnings, manifest.fallbackCoverage];
  if (lists.some((list) => !Array.isArray(list))) return false;
  for (const entry of manifest.fallbackCoverage || []) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.action !== null && typeof entry.action !== 'string' && typeof entry.action !== 'object') return false;
    if (typeof entry.authored !== 'boolean') return false;
    if (typeof entry.fallback !== 'boolean') return false;
  }
  return true;
}
