/**
 * Runtime-facing bridge for Player World Coverage.
 *
 * Composition only: the player, world sampler, collider, camera, combat, equipment and
 * interaction owners remain injected by the shipped runtime. This adapter observes those
 * authorities, derives the world-aware presentation context, and emits a bounded snapshot.
 * It intentionally contains no THREE import, no DOM/editor access and no asset loader.
 *
 * @module gameplay/playerWorldCoverageRuntimeAdapter
 */

import {
  PLAYER_WORLD_COVERAGE_VERSION,
  derivePlayerWorldContext,
  buildCoverageViewportSchedule,
  buildWorldCoverageInputParity,
  buildWorldCoveragePerformanceBudget,
  buildWorldCoverageAcceptanceManifest,
  validatePlayerWorldContext,
  applyPlayerWorldCoveragePresentation,
} from './playerWorldCoverageDirector.js';

export const PLAYER_WORLD_COVERAGE_EVENT = 'aapw:player-world-coverage';
export const PLAYER_WORLD_COVERAGE_FOCUS_EVENT = 'aapw:player-world-coverage-focus';
export const PLAYER_WORLD_COVERAGE_ERROR_EVENT = 'aapw:player-world-coverage-error';

const DEFAULT_EVENT_TARGET = globalThis;
const MAX_HISTORY = 32;
const MAX_EVENTS_PER_SECOND = 20;
const MIN_PUBLISH_INTERVAL_SECONDS = 1 / MAX_EVENTS_PER_SECOND;
const MAX_SAMPLE_BATCH = 96;
const MAX_FOCUS_TARGETS = 24;
const DEFAULT_RADIUS_METERS = 140;
const SAFE_DELTA_SECONDS = 0.1;

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((child) => freeze(child, seen));
  return Object.freeze(value);
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function positionOf(value) {
  return {
    x: finite(value?.x),
    y: finite(value?.y),
    z: finite(value?.z),
  };
}

function sourceFunction(source, names = []) {
  if (!source || typeof source !== 'object') return null;
  for (const name of names) {
    if (typeof source[name] === 'function') return source[name].bind(source);
  }
  return null;
}

function readPlayerState(player) {
  if (!player || typeof player !== 'object') return {};
  const object3D = player.object3D ?? player.model ?? player.root ?? player;
  const position = positionOf(object3D?.position ?? player.position);
  const rotationY = finite(object3D?.rotation?.y ?? player.rotationY);
  const state = player.getState?.() ?? player.state ?? {};
  return {
    position,
    headingDegrees: rotationY * 180 / Math.PI,
    speedMps: finite(state.speedMps ?? player.speedMps),
    locomotion: state.movementState ?? state.locomotion ?? player.movementState ?? 'idle',
    isGrounded: state.isGrounded ?? player.isGrounded ?? true,
    inAttack: state.attackActive === true || state.inAttack === true,
    attackWeight: finite(state.attackWeight ?? player.attackWeight, 0),
    inGuard: state.guarding === true || state.inGuard === true,
    lockOn: state.lockOn === true || player.lockOn === true,
    rangedReady: state.rangedReady === true || player.rangedReady === true,
    stance: state.stance ?? player.stance ?? (state.guarding ? 'guard' : 'neutral'),
    camera: {
      distanceMeters: finite(player.cameraDistanceMeters ?? state.cameraDistanceMeters, 4.6),
      combat: state.attackActive === true || state.guarding === true,
      lockOn: state.lockOn === true,
      terrainNear: false,
      fogAmount: 0,
      acceptanceOrthographic: true,
      targetVisible: state.lockOn !== false,
    },
  };
}

function readEquipmentState(equipment) {
  if (!equipment || typeof equipment !== 'object') return {};
  const snapshot = equipment.getSnapshot?.() ?? equipment.snapshot ?? equipment;
  const totals = snapshot.totals ?? snapshot.stats ?? {};
  const armor = snapshot.armor ?? [];
  const weapon = snapshot.weapon ?? snapshot.mainHand ?? {};
  const itemRows = [...(Array.isArray(snapshot.items) ? snapshot.items : []), ...(Array.isArray(armor) ? armor : [])];
  const weight = finite(totals.weight ?? snapshot.weight, 0);
  const maxWeight = Math.max(weight, finite(totals.maxWeight ?? snapshot.maxWeight, Math.max(weight, 1)));
  const surfaceRoles = itemRows.flatMap((item) => Array.isArray(item.surfaceRoles) ? item.surfaceRoles : []);
  const metalWeight = itemRows.reduce((sum, item) => sum + finite(item.metalWeight ?? (item.materialType === 'metal' ? item.weight : 0)), 0);
  const leatherWeight = itemRows.reduce((sum, item) => sum + finite(item.leatherWeight ?? (item.materialType === 'leather' ? item.weight : 0)), 0);
  return {
    encumbranceRatio: clamp(weight / maxWeight, 0, 1),
    weaponReachMeters: finite(weapon.reachMeters ?? snapshot.weaponReachMeters, 1.6),
    metalWeightRatio: weight > 0 ? clamp(metalWeight / weight, 0, 1) : 0,
    leatherWeightRatio: weight > 0 ? clamp(leatherWeight / weight, 0, 1) : 0,
    socketReady: snapshot.socketReady !== false,
    assetReady: snapshot.assetReady !== false,
    stance: snapshot.stance ?? 'neutral',
    surfaceRoles,
  };
}

function readCombatState(combat, playerState) {
  const snapshot = combat?.getSnapshot?.() ?? combat?.snapshot ?? combat ?? {};
  return {
    stance: snapshot.stance ?? playerState.stance ?? 'neutral',
    isGrounded: snapshot.isGrounded ?? playerState.isGrounded,
    lockOn: snapshot.lockOn ?? playerState.lockOn,
    rangedReady: snapshot.rangedReady ?? playerState.rangedReady,
  };
}

function readInteractionState(interaction) {
  const snapshot = interaction?.getSnapshot?.() ?? interaction?.snapshot ?? interaction ?? {};
  return {
    disabled: snapshot.disabled === true,
  };
}

function readMovementState(playerState, input) {
  const speed = finite(input?.speedMps ?? playerState.speedMps);
  return {
    speedMps: Math.max(0, speed),
    locomotion: input?.locomotion ?? playerState.locomotion ?? (speed > 5.5 ? 'sprint' : speed > 0.05 ? 'run' : 'idle'),
    inAttack: input?.inAttack ?? playerState.inAttack,
    attackWeight: clamp(input?.attackWeight ?? playerState.attackWeight, 0, 1),
    inGuard: input?.inGuard ?? playerState.inGuard,
  };
}

function normalizeWorldSources(world) {
  if (!world) return { sample: null, sampleBatch: null, observe: null, describe: null };
  return {
    sample: sourceFunction(world, ['samplePlayer', 'sampleAt', 'getWorldObservation', 'sample']),
    sampleBatch: sourceFunction(world, ['sampleBatch', 'sampleMany', 'getWorldObservations']),
    observe: sourceFunction(world, ['observePlayerWorldCoverage', 'observePlayer']),
    describe: sourceFunction(world, ['getCoverageDescription', 'describeCoverage']),
  };
}

function extractSamples(worldSources, playerState, radiusMeters) {
  if (worldSources.observe) {
    const observed = worldSources.observe({ position: playerState.position, radiusMeters });
    if (Array.isArray(observed)) return observed.slice(0, MAX_SAMPLE_BATCH);
    if (observed?.samples && Array.isArray(observed.samples)) return observed.samples.slice(0, MAX_SAMPLE_BATCH);
  }
  if (worldSources.sampleBatch) {
    const sampled = worldSources.sampleBatch({ position: playerState.position, radiusMeters, maxSamples: MAX_SAMPLE_BATCH });
    if (Array.isArray(sampled)) return sampled.slice(0, MAX_SAMPLE_BATCH);
  }
  if (worldSources.sample) {
    const result = worldSources.sample(playerState.position, radiusMeters);
    if (Array.isArray(result)) return result.slice(0, MAX_SAMPLE_BATCH);
    if (result) return [result];
  }
  return [];
}

function pickFocusTargets(targets, playerPosition) {
  const rows = (Array.isArray(targets) ? targets : []).map((target, index) => {
    const object = target?.object3D ?? target?.position ? target : null;
    const position = positionOf(object?.position ?? target?.position);
    const id = String(target?.id ?? target?.actorId ?? target?.name ?? `target-${index}`);
    const dx = position.x - playerPosition.x;
    const dz = position.z - playerPosition.z;
    const distance = Math.hypot(dx, dz);
    const visible = target?.visible !== false && target?.culled !== true;
    const hostile = target?.hostile === true || target?.factionRelation === 'hostile';
    return { id, position, distance, visible, hostile };
  });
  return rows
    .filter((row) => row.visible && row.distance <= DEFAULT_RADIUS_METERS)
    .sort((a, b) => Number(b.hostile) - Number(a.hostile) || a.distance - b.distance || a.id.localeCompare(b.id))
    .slice(0, MAX_FOCUS_TARGETS);
}

function dispatch(target, name, detail) {
  if (!target || typeof target.dispatchEvent !== 'function' || typeof target.CustomEvent !== 'function') return false;
  target.dispatchEvent(new target.CustomEvent(name, { detail: freeze(clone(detail)) }));
  return true;
}

export function createPlayerWorldCoverageRuntimeAdapter({
  player,
  world,
  equipment = null,
  combat = null,
  interaction = null,
  eventTarget = DEFAULT_EVENT_TARGET,
  now = () => 0,
  radiusMeters = DEFAULT_RADIUS_METERS,
  config,
} = {}) {
  const worldSources = normalizeWorldSources(world);
  const history = [];
  let revision = 0;
  let lastPublishedSeconds = -Infinity;
  let lastSnapshot = null;
  let disposed = false;
  let focusedTargets = [];

  function assertActive() {
    if (disposed) throw new Error('player-world-coverage-runtime-disposed');
  }

  function collect(input = {}) {
    assertActive();
    const playerState = readPlayerState(player);
    const movement = readMovementState(playerState, input.movement);
    const samples = Array.isArray(input.samples) ? input.samples.slice(0, MAX_SAMPLE_BATCH) : extractSamples(worldSources, playerState, radiusMeters);
    const equipmentState = input.equipment ?? readEquipmentState(equipment);
    const combatState = input.combat ?? readCombatState(combat, playerState);
    const interactionState = input.interaction ?? readInteractionState(interaction);
    const snapshot = derivePlayerWorldContext({
      player: { ...playerState, ...input.player },
      samples,
      equipment: equipmentState,
      combat: combatState,
      movement,
      interaction: interactionState,
      config,
      nowSeconds: finite(input.nowSeconds, now()),
    });
    revision += 1;
    lastSnapshot = snapshot;
    return snapshot;
  }

  function publish(snapshot, { force = false } = {}) {
    assertActive();
    const time = snapshot.nowSeconds;
    if (!force && time - lastPublishedSeconds < MIN_PUBLISH_INTERVAL_SECONDS) return false;
    lastPublishedSeconds = time;
    history.push({
      revision,
      time,
      fingerprint: snapshot.fingerprint,
      playerCellId: snapshot.coverage.playerCell.id,
      surface: snapshot.surfaceContext.dominantSurface,
      biome: snapshot.selectedSample.biome,
    });
    while (history.length > MAX_HISTORY) history.shift();
    dispatch(eventTarget, PLAYER_WORLD_COVERAGE_EVENT, {
      revision,
      fingerprint: snapshot.fingerprint,
      context: snapshot,
      history: history.slice(-8),
    });
    return true;
  }

  function update(input = {}) {
    const snapshot = collect(input);
    publish(snapshot, { force: input.forcePublish === true });
    return freeze({
      snapshot,
      validation: validatePlayerWorldContext(snapshot, input.validationOptions),
    });
  }

  function applyTo(target, snapshot = lastSnapshot) {
    assertActive();
    if (!snapshot) return freeze({ ok: false, error: 'no-snapshot' });
    return applyPlayerWorldCoveragePresentation(target, snapshot);
  }

  function focus(targets = []) {
    assertActive();
    const playerState = readPlayerState(player);
    focusedTargets = pickFocusTargets(targets, playerState.position);
    const winner = focusedTargets.find((target) => target.hostile) ?? focusedTargets[0] ?? null;
    const detail = {
      revision,
      targetId: winner?.id ?? null,
      candidates: focusedTargets,
      lockOnReady: Boolean(winner),
    };
    dispatch(eventTarget, PLAYER_WORLD_COVERAGE_FOCUS_EVENT, detail);
    return freeze(detail);
  }

  function acceptance(snapshot = lastSnapshot, options = {}) {
    assertActive();
    if (!snapshot) return freeze({ accepted: false, errors: ['no-snapshot'] });
    return buildWorldCoverageAcceptanceManifest(snapshot, options);
  }

  function viewport(snapshot = lastSnapshot) {
    assertActive();
    if (!snapshot) return freeze({ playerCellId: null, radiusCells: 0, cells: [] });
    return buildCoverageViewportSchedule({
      playerPosition: snapshot.player.position,
      camera: { radiusMeters: radiusMeters },
      config,
    });
  }

  function performance(snapshot = lastSnapshot, { mobile = false } = {}) {
    assertActive();
    if (!snapshot) return buildWorldCoveragePerformanceBudget({ mobile });
    return buildWorldCoveragePerformanceBudget({
      visibleCellCount: snapshot.coverage.nearbyCellIds.length,
      samplesPerCell: Math.max(1, snapshot.selectedSample ? 1 : 0),
      combat: snapshot.combat.stance !== 'neutral' || snapshot.combat.eligible,
      mobile,
    });
  }

  function inputParity(input = {}) {
    assertActive();
    return buildWorldCoverageInputParity(input);
  }

  function diagnostics() {
    assertActive();
    return freeze({
      version: PLAYER_WORLD_COVERAGE_VERSION,
      revision,
      history: history.slice(),
      focusedTargets: focusedTargets.slice(),
      lastFingerprint: lastSnapshot?.fingerprint ?? null,
      eventRateLimitPerSecond: MAX_EVENTS_PER_SECOND,
      radiusMeters,
    });
  }

  function reportError(error, context = {}) {
    const detail = {
      revision,
      message: String(error?.message ?? error ?? 'unknown-error'),
      name: String(error?.name ?? 'Error'),
      context: clone(context),
    };
    dispatch(eventTarget, PLAYER_WORLD_COVERAGE_ERROR_EVENT, detail);
    return freeze(detail);
  }

  function reset() {
    assertActive();
    revision = 0;
    history.length = 0;
    focusedTargets = [];
    lastSnapshot = null;
    lastPublishedSeconds = -Infinity;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    history.length = 0;
    focusedTargets = [];
    lastSnapshot = null;
  }

  return Object.freeze({
    collect,
    update,
    publish,
    applyTo,
    focus,
    acceptance,
    viewport,
    performance,
    inputParity,
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
    try {
      return adapter.update(frame);
    } catch (error) {
      adapter.reportError(error, { phase: 'loop-update' });
      return null;
    }
  };
  const detach = playerLoop.onUpdate(handler);
  return Object.freeze({ attached: true, detach: typeof detach === 'function' ? detach : () => {} });
}

export function validatePlayerWorldCoverageRuntimeAdapter(source) {
  const errors = [];
  if (!source || typeof source !== 'object') errors.push('missing-source');
  if (typeof source?.update !== 'function') errors.push('missing-update');
  if (typeof source?.collect !== 'function') errors.push('missing-collect');
  if (typeof source?.dispose !== 'function') errors.push('missing-dispose');
  if (source?.isDisposed === true && source?.revision !== 0) errors.push('disposed-revision');
  return Object.freeze({ ok: errors.length === 0, errors });
}
