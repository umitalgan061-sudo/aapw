/**
 * Runtime-facing bridge for Player World Coverage.
 *
 * Composition only: shipped player, world sampler, equipment, combat and interaction owners are
 * injected. This adapter observes them, derives the world context and publishes bounded events.
 * It owns no terrain, actor AI, combat state machine, asset loader, material authoring or DOM UI.
 *
 * @module gameplay/playerWorldCoverageRuntimeAdapter
 */

import {
  PLAYER_WORLD_COVERAGE_VERSION,
  applyPlayerWorldCoveragePresentation,
  buildCoverageViewportSchedule,
  buildWorldCoveragePerformanceBudget,
  buildWorldCoverageAcceptanceManifest,
  derivePlayerWorldContext,
  validatePlayerWorldContext,
} from './playerWorldCoverageDirector.js';
import { normalizePlayerWorldCoverageInput } from './playerWorldCoverageInputParity.js';

export const PLAYER_WORLD_COVERAGE_EVENT = 'aapw:player-world-coverage';
export const PLAYER_WORLD_COVERAGE_FOCUS_EVENT = 'aapw:player-world-coverage-focus';
export const PLAYER_WORLD_COVERAGE_ERROR_EVENT = 'aapw:player-world-coverage-error';

const MAX_HISTORY = 32;
const MAX_FOCUS_TARGETS = 24;
const MAX_SAMPLE_BATCH = 96;
const MAX_EVENTS_PER_SECOND = 20;
const MIN_PUBLISH_INTERVAL_SECONDS = 1 / MAX_EVENTS_PER_SECOND;
const DEFAULT_RADIUS_METERS = 140;

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((child) => freeze(child, seen));
  return Object.freeze(value);
}

function bindMethod(source, names) {
  if (!source || typeof source !== 'object') return null;
  for (const name of names) if (typeof source[name] === 'function') return source[name].bind(source);
  return null;
}

function readPosition(value) {
  return { x: finite(value?.x), y: finite(value?.y), z: finite(value?.z) };
}

function readPlayer(player) {
  const object3D = player?.object3D ?? player?.model ?? player?.root ?? player;
  const state = player?.getState?.() ?? player?.state ?? {};
  const position = readPosition(object3D?.position ?? player?.position);
  const yaw = finite(object3D?.rotation?.y ?? player?.rotationY);
  return {
    position,
    headingDegrees: yaw * 180 / Math.PI,
    speedMps: Math.max(0, finite(state.speedMps ?? player?.speedMps)),
    locomotion: state.movementState ?? state.locomotion ?? player?.movementState ?? 'idle',
    isGrounded: state.isGrounded ?? player?.isGrounded ?? true,
    inAttack: state.attackActive === true || state.inAttack === true,
    attackWeight: clamp(state.attackWeight ?? player?.attackWeight, 0, 1),
    inGuard: state.guarding === true || state.inGuard === true,
    lockOn: state.lockOn === true || player?.lockOn === true,
    rangedReady: state.rangedReady === true || player?.rangedReady === true,
    stance: state.stance ?? player?.stance ?? 'neutral',
    camera: {
      distanceMeters: clamp(player?.cameraDistanceMeters ?? state.cameraDistanceMeters ?? 4.6, 2.5, 8),
      combat: state.attackActive === true || state.guarding === true,
      lockOn: state.lockOn === true,
      terrainNear: false,
      fogAmount: 0,
      acceptanceOrthographic: true,
      targetVisible: state.lockOn !== false,
    },
  };
}

function readEquipment(equipment) {
  const snapshot = equipment?.getSnapshot?.() ?? equipment?.snapshot ?? equipment ?? {};
  const totals = snapshot.totals ?? snapshot.stats ?? {};
  const armor = Array.isArray(snapshot.armor) ? snapshot.armor : [];
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const rows = [...items, ...armor];
  const weight = Math.max(0, finite(totals.weight ?? snapshot.weight));
  const maxWeight = Math.max(1, finite(totals.maxWeight ?? snapshot.maxWeight, Math.max(weight, 1)));
  const metal = rows.reduce((sum, row) => sum + Math.max(0, finite(row.metalWeight ?? (row.materialType === 'metal' ? row.weight : 0))), 0);
  const leather = rows.reduce((sum, row) => sum + Math.max(0, finite(row.leatherWeight ?? (row.materialType === 'leather' ? row.weight : 0))), 0);
  return {
    encumbranceRatio: clamp(weight / maxWeight, 0, 1),
    weaponReachMeters: finite(snapshot.weapon?.reachMeters ?? snapshot.mainHand?.reachMeters ?? snapshot.weaponReachMeters, 1.6),
    metalWeightRatio: weight ? clamp(metal / weight, 0, 1) : 0,
    leatherWeightRatio: weight ? clamp(leather / weight, 0, 1) : 0,
    socketReady: snapshot.socketReady !== false,
    assetReady: snapshot.assetReady !== false,
    stance: snapshot.stance ?? 'neutral',
    surfaceRoles: rows.flatMap((row) => Array.isArray(row.surfaceRoles) ? row.surfaceRoles : []),
  };
}

function readCombat(combat, playerState) {
  const snapshot = combat?.getSnapshot?.() ?? combat?.snapshot ?? combat ?? {};
  return {
    stance: snapshot.stance ?? playerState.stance ?? 'neutral',
    isGrounded: snapshot.isGrounded ?? playerState.isGrounded,
    lockOn: snapshot.lockOn ?? playerState.lockOn,
    rangedReady: snapshot.rangedReady ?? playerState.rangedReady,
  };
}

function readInteraction(interaction) {
  const snapshot = interaction?.getSnapshot?.() ?? interaction?.snapshot ?? interaction ?? {};
  return { disabled: snapshot.disabled === true };
}

function normalizeMovement(playerState, input) {
  const speedMps = Math.max(0, finite(input?.speedMps ?? playerState.speedMps));
  return {
    speedMps,
    locomotion: input?.locomotion ?? playerState.locomotion ?? (speedMps > 5.5 ? 'sprint' : speedMps > 0.05 ? 'run' : 'idle'),
    inAttack: input?.inAttack ?? playerState.inAttack,
    attackWeight: clamp(input?.attackWeight ?? playerState.attackWeight, 0, 1),
    inGuard: input?.inGuard ?? playerState.inGuard,
  };
}

function readWorld(world) {
  return {
    observe: bindMethod(world, ['observePlayerWorldCoverage', 'observePlayer']),
    batch: bindMethod(world, ['sampleBatch', 'sampleMany', 'getWorldObservations']),
    sample: bindMethod(world, ['samplePlayer', 'sampleAt', 'getWorldObservation', 'sample']),
  };
}

function sampleWorld(sources, playerState, radiusMeters, explicitSamples) {
  if (Array.isArray(explicitSamples)) return explicitSamples.slice(0, MAX_SAMPLE_BATCH);
  if (sources.observe) {
    const value = sources.observe({ position: playerState.position, radiusMeters, maxSamples: MAX_SAMPLE_BATCH });
    if (Array.isArray(value)) return value.slice(0, MAX_SAMPLE_BATCH);
    if (Array.isArray(value?.samples)) return value.samples.slice(0, MAX_SAMPLE_BATCH);
  }
  if (sources.batch) {
    const value = sources.batch({ position: playerState.position, radiusMeters, maxSamples: MAX_SAMPLE_BATCH });
    if (Array.isArray(value)) return value.slice(0, MAX_SAMPLE_BATCH);
  }
  if (sources.sample) {
    const value = sources.sample(playerState.position, radiusMeters);
    if (Array.isArray(value)) return value.slice(0, MAX_SAMPLE_BATCH);
    if (value) return [value];
  }
  return [];
}

function normalizeTargets(targets, playerPosition) {
  return (Array.isArray(targets) ? targets : []).map((target, index) => {
    const object = target?.object3D ?? target;
    const pos = readPosition(object?.position ?? target?.position);
    const id = String(target?.id ?? target?.actorId ?? target?.name ?? `target-${index}`);
    return {
      id,
      position: pos,
      distanceMeters: Math.hypot(pos.x - playerPosition.x, pos.z - playerPosition.z),
      hostile: target?.hostile === true || target?.factionRelation === 'hostile',
      visible: target?.visible !== false && target?.culled !== true,
      lockOnEligible: target?.lockOnEligible !== false,
      lineOfSight: target?.lineOfSight !== false,
      threat: clamp(target?.threat, 0, 1),
    };
  });
}

function chooseTarget(targets, playerPosition, maxRange = 8) {
  const ranked = normalizeTargets(targets, playerPosition)
    .filter((target) => target.visible && target.lineOfSight && target.lockOnEligible && target.distanceMeters <= maxRange)
    .sort((a, b) => Number(b.hostile) - Number(a.hostile) || b.threat - a.threat || a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id))
    .slice(0, MAX_FOCUS_TARGETS);
  return { target: ranked[0] ?? null, candidates: ranked };
}

function dispatch(target, type, detail) {
  if (!target || typeof target.dispatchEvent !== 'function' || typeof target.CustomEvent !== 'function') return false;
  target.dispatchEvent(new target.CustomEvent(type, { detail: freeze(clone(detail)) }));
  return true;
}

export function createPlayerWorldCoverageRuntimeAdapter({
  player,
  world,
  equipment = null,
  combat = null,
  interaction = null,
  eventTarget = globalThis,
  now = () => 0,
  radiusMeters = DEFAULT_RADIUS_METERS,
  config,
} = {}) {
  const sources = readWorld(world);
  const history = [];
  let revision = 0;
  let lastPublishedSeconds = -Infinity;
  let lastSnapshot = null;
  let disposed = false;

  function active() {
    if (disposed) throw new Error('player-world-coverage-runtime-disposed');
  }

  function collect(input = {}) {
    active();
    const playerState = { ...readPlayer(player), ...input.player };
    const movement = normalizeMovement(playerState, input.movement);
    const snapshot = derivePlayerWorldContext({
      player: playerState,
      movement,
      combat: input.combat ?? readCombat(combat, playerState),
      equipment: input.equipment ?? readEquipment(equipment),
      interaction: input.interaction ?? readInteraction(interaction),
      samples: sampleWorld(sources, playerState, radiusMeters, input.samples),
      nowSeconds: finite(input.nowSeconds, now()),
      config,
    });
    revision += 1;
    lastSnapshot = snapshot;
    return snapshot;
  }

  function publish(snapshot, force = false) {
    active();
    if (!force && snapshot.nowSeconds - lastPublishedSeconds < MIN_PUBLISH_INTERVAL_SECONDS) return false;
    lastPublishedSeconds = snapshot.nowSeconds;
    const record = Object.freeze({ revision, time: snapshot.nowSeconds, fingerprint: snapshot.fingerprint, playerCellId: snapshot.coverage.playerCell.id });
    history.push(record);
    while (history.length > MAX_HISTORY) history.shift();
    return dispatch(eventTarget, PLAYER_WORLD_COVERAGE_EVENT, { revision, fingerprint: snapshot.fingerprint, context: snapshot, history: history.slice(-8) });
  }

  function update(input = {}) {
    const snapshot = collect(input);
    publish(snapshot, input.forcePublish === true);
    return freeze({ snapshot, validation: validatePlayerWorldContext(snapshot, input.validationOptions) });
  }

  function applyTo(target, snapshot = lastSnapshot) {
    active();
    return snapshot ? applyPlayerWorldCoveragePresentation(target, snapshot) : freeze({ ok: false, error: 'no-snapshot' });
  }

  function focus(targets = []) {
    active();
    const playerState = readPlayer(player);
    const result = chooseTarget(targets, playerState.position, lastSnapshot?.combat?.lockOnRangeMeters ?? 8);
    const detail = { revision, targetId: result.target?.id ?? null, candidates: result.candidates, lockOnReady: Boolean(result.target) };
    dispatch(eventTarget, PLAYER_WORLD_COVERAGE_FOCUS_EVENT, detail);
    return freeze(detail);
  }

  function inputParity(input = {}) {
    active();
    return normalizePlayerWorldCoverageInput(input);
  }

  function acceptance(options = {}) {
    active();
    return lastSnapshot ? buildWorldCoverageAcceptanceManifest(lastSnapshot, options) : freeze({ accepted: false, errors: ['no-snapshot'] });
  }

  function viewport() {
    active();
    return lastSnapshot ? buildCoverageViewportSchedule({ playerPosition: lastSnapshot.player.position, camera: { radiusMeters }, config }) : freeze({ playerCellId: null, radiusCells: 0, cells: [] });
  }

  function performance({ mobile = false } = {}) {
    active();
    const visible = lastSnapshot?.coverage?.nearbyCellIds?.length ?? 0;
    return buildWorldCoveragePerformanceBudget({ visibleCellCount: visible, samplesPerCell: 1, combat: lastSnapshot?.combat?.eligible === true, mobile });
  }

  function diagnostics() {
    active();
    return freeze({ version: PLAYER_WORLD_COVERAGE_VERSION, revision, lastFingerprint: lastSnapshot?.fingerprint ?? null, history: history.slice(), eventRateLimitPerSecond: MAX_EVENTS_PER_SECOND, radiusMeters });
  }

  function reportError(error, context = {}) {
    return freeze({ revision, message: String(error?.message ?? error ?? 'unknown-error'), context: clone(context) });
  }

  function reset() {
    active();
    revision = 0;
    history.length = 0;
    lastPublishedSeconds = -Infinity;
    lastSnapshot = null;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    history.length = 0;
    lastSnapshot = null;
  }

  return Object.freeze({
    collect,
    update,
    publish,
    applyTo,
    focus,
    inputParity,
    acceptance,
    viewport,
    performance,
    diagnostics,
    reportError,
    reset,
    dispose,
    get revision() { return revision; },
    get lastSnapshot() { return lastSnapshot; },
    get isDisposed() { return disposed; },
  });
}

export function attachPlayerWorldCoverageRuntime({ adapter, playerLoop = null } = {}) {
  if (!adapter || typeof adapter.update !== 'function') throw new TypeError('adapter.update required');
  if (!playerLoop || typeof playerLoop.onUpdate !== 'function') return Object.freeze({ attached: false, detach() {} });
  const handler = (frame = {}) => {
    try { return adapter.update(frame); }
    catch (error) { adapter.reportError(error, { phase: 'loop-update' }); return null; }
  };
  const detach = playerLoop.onUpdate(handler);
  return Object.freeze({ attached: true, detach: typeof detach === 'function' ? detach : () => {} });
}

export function validatePlayerWorldCoverageRuntimeAdapter(source) {
  const errors = [];
  if (!source || typeof source !== 'object') errors.push('missing-source');
  if (typeof source?.update !== 'function') errors.push('missing-update');
  if (typeof source?.collect !== 'function') errors.push('missing-collect');
  if (typeof source?.inputParity !== 'function') errors.push('missing-input-parity');
  if (typeof source?.dispose !== 'function') errors.push('missing-dispose');
  return Object.freeze({ ok: errors.length === 0, errors });
}
