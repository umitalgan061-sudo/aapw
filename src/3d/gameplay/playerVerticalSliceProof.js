/**
 * Deterministic acceptance adapter for the shipped player vertical slice.
 * It observes caller-owned runtime snapshots and proves the spawn -> input ->
 * animation/state -> combat/equipment chain without mutating player ownership.
 * @module gameplay/playerVerticalSliceProof
 */

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value, fallback = '') => typeof value === 'string' ? value.trim() : fallback;
const bool = (value) => value === true;
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value, 0)));
const round = (value, digits = 4) => Number(finite(value, 0).toFixed(digits));

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function point(raw = {}) {
  return { x: round(raw.x, 3), y: round(raw.y, 3), z: round(raw.z, 3) };
}

function normalizeInput(raw = {}) {
  const move = raw.move ?? raw.axes ?? {};
  const look = raw.look ?? {};
  const actions = Array.isArray(raw.actions) ? raw.actions : [];
  const uniqueActions = [...new Set(actions.map((action) => text(action)).filter(Boolean))].sort();
  return {
    source: text(raw.source, 'unknown'),
    move: { x: round(move.x, 3), y: round(move.y, 3) },
    look: { x: round(look.x, 3), y: round(look.y, 3) },
    actions: uniqueActions,
    parityReady: ['keyboard', 'mouse', 'gamepad', 'touch', 'pwa'].includes(text(raw.source)),
  };
}

function normalizeAnimation(raw = {}) {
  const layers = Array.isArray(raw.layers) ? raw.layers : [];
  return {
    locomotion: text(raw.locomotion, 'idle'),
    action: text(raw.action, 'none'),
    defense: text(raw.defense, 'none'),
    reaction: text(raw.reaction, 'none'),
    layers: layers.map((layer) => ({
      name: text(layer?.name),
      weight: round(clamp01(layer?.weight), 3),
      additive: bool(layer?.additive),
    })).filter((layer) => layer.name).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function normalizeCombat(raw = {}) {
  const event = raw.lastEvent ?? {};
  return {
    state: text(raw.state, 'idle'),
    targetId: text(raw.targetId, ''),
    stamina: round(Math.max(0, finite(raw.stamina, 0)), 2),
    poise: round(Math.max(0, finite(raw.poise, 0)), 2),
    lastEvent: {
      type: text(event.type, 'none'),
      outcome: text(event.outcome, 'none'),
      serial: Math.max(0, Math.floor(finite(event.serial, 0))),
    },
    activeWindow: bool(raw.activeWindow),
  };
}

function normalizeEquipment(raw = {}) {
  const slots = Array.isArray(raw.slots) ? raw.slots : [];
  const normalized = slots.map((slot) => ({
    slot: text(slot?.slot),
    itemId: text(slot?.itemId),
    socket: text(slot?.socket),
    ready: slot?.ready !== false,
    surfaceRoles: Array.isArray(slot?.surfaceRoles) ? [...new Set(slot.surfaceRoles.map((role) => text(role)).filter(Boolean))].sort() : [],
  })).filter((slot) => slot.slot && slot.itemId).sort((a, b) => `${a.slot}:${a.itemId}`.localeCompare(`${b.slot}:${b.itemId}`));
  return {
    slots: normalized,
    readyCount: normalized.filter((slot) => slot.ready).length,
    missingAssetCount: Math.max(0, Math.floor(finite(raw.missingAssetCount, 0))),
    placementValidated: raw.placementValidated !== false,
  };
}

export function buildPlayerVerticalSliceProof(snapshot = {}) {
  const spawn = snapshot.spawn ?? {};
  const visual = point(snapshot.visualPosition ?? snapshot.position);
  const collider = point(snapshot.colliderPosition ?? snapshot.position);
  const groundY = finite(snapshot.groundY, visual.y);
  const input = normalizeInput(snapshot.input);
  const animation = normalizeAnimation(snapshot.animation);
  const combat = normalizeCombat(snapshot.combat);
  const equipment = normalizeEquipment(snapshot.equipment);
  const groundingError = Math.abs(visual.y - groundY);
  const colliderError = Math.hypot(visual.x - collider.x, visual.z - collider.z);
  const phases = {
    spawn: Boolean(snapshot.spawned) && Number.isFinite(Number(spawn.x)) && Number.isFinite(Number(spawn.z)),
    input: input.actions.length > 0 || Math.hypot(input.move.x, input.move.y) > 0 || Math.hypot(input.look.x, input.look.y) > 0,
    animation: animation.locomotion !== 'idle' || animation.action !== 'none' || animation.layers.length > 0,
    combat: combat.state !== 'idle' || combat.lastEvent.type !== 'none' || combat.activeWindow,
    equipment: equipment.slots.length > 0 && equipment.missingAssetCount === 0 && equipment.placementValidated,
  };
  const completedPhaseCount = Object.values(phases).filter(Boolean).length;
  const acceptance = {
    phaseOrder: ['spawn', 'input', 'animation', 'combat', 'equipment'],
    phases,
    completedPhaseCount,
    complete: completedPhaseCount === 5,
    playerRelativeGrounding: groundingError <= 0.05 && colliderError <= 0.05,
    groundingError: round(groundingError, 4),
    colliderError: round(colliderError, 4),
    inputParity: input.parityReady,
    missingAssetCount: equipment.missingAssetCount,
    consoleErrorCount: Math.max(0, Math.floor(finite(snapshot.consoleErrorCount, 0))),
    pageErrorCount: Math.max(0, Math.floor(finite(snapshot.pageErrorCount, 0))),
    visualFailureCount: Math.max(0, Math.floor(finite(snapshot.visualFailureCount, 0))),
  };
  const result = {
    version: 1,
    spawn: { x: round(spawn.x, 3), z: round(spawn.z, 3), groundY: round(groundY, 3) },
    visual,
    collider,
    input,
    animation,
    combat,
    equipment,
    acceptance,
  };
  const fingerprint = stable(result);
  return freeze({ ...result, fingerprint });
}

export function serializePlayerVerticalSliceProof(snapshot = {}) {
  const proof = buildPlayerVerticalSliceProof(snapshot);
  return JSON.stringify(proof);
}

export function validatePlayerVerticalSliceProof(proof) {
  if (!proof || typeof proof !== 'object') return { valid: false, reasons: ['missing-proof'] };
  const reasons = [];
  if (proof.acceptance?.complete !== true) reasons.push('phase-chain-incomplete');
  if (proof.acceptance?.playerRelativeGrounding !== true) reasons.push('grounding-drift');
  if (proof.acceptance?.inputParity !== true) reasons.push('input-parity-unavailable');
  if (proof.acceptance?.missingAssetCount !== 0) reasons.push('missing-asset');
  if (proof.acceptance?.consoleErrorCount !== 0) reasons.push('console-error');
  if (proof.acceptance?.pageErrorCount !== 0) reasons.push('page-error');
  if (proof.acceptance?.visualFailureCount !== 0) reasons.push('visual-failure');
  return freeze({ valid: reasons.length === 0, reasons });
}
