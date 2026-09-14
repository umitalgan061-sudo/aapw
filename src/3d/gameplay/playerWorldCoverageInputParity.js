/**
 * Device-neutral input parity contract used by the world-coverage player adapter.
 * Keyboard, gamepad, touch and mouse remain caller-owned device services; this module only
 * normalizes their already-produced values into one bounded read model.
 *
 * @module gameplay/playerWorldCoverageInputParity
 */

const DEAD_ZONE = 0.02;
const MAX_AXIS = 1;

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function axis(value) {
  return Math.max(-MAX_AXIS, Math.min(MAX_AXIS, finite(value)));
}

function vector(source = {}) {
  return { x: axis(source.moveX), z: axis(source.moveZ) };
}

function magnitude(vectorValue) {
  return Math.hypot(vectorValue.x, vectorValue.z);
}

export function normalizePlayerWorldCoverageInput({ keyboard = {}, gamepad = {}, touch = {}, mouse = {} } = {}) {
  const sources = [
    ['keyboard', vector(keyboard)],
    ['gamepad', vector(gamepad)],
    ['touch', vector(touch)],
  ];
  const active = sources.filter(([, move]) => magnitude(move) > DEAD_ZONE);
  const move = active.length
    ? {
      x: active.reduce((sum, [, value]) => sum + value.x, 0) / active.length,
      z: active.reduce((sum, [, value]) => sum + value.z, 0) / active.length,
    }
    : { x: 0, z: 0 };
  const boundedMove = { x: axis(move.x), z: axis(move.z) };
  const look = { x: axis(mouse.lookX), y: axis(mouse.lookY) };
  const disagreement = active.length > 1
    ? Math.max(...active.map(([, value]) => Math.hypot(value.x - boundedMove.x, value.z - boundedMove.z)))
    : 0;
  return Object.freeze({
    move: Object.freeze(boundedMove),
    look: Object.freeze(look),
    activeSources: Object.freeze(active.map(([name]) => name)),
    sourceCount: active.length,
    disagreement: Math.round(disagreement * 1000) / 1000,
    parityReady: disagreement <= 0.95,
  });
}

export function validatePlayerWorldCoverageInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object') errors.push('missing-input');
  if (Math.hypot(finite(input?.move?.x), finite(input?.move?.z)) > Math.SQRT2) errors.push('move-overflow');
  if (Math.abs(finite(input?.look?.x)) > 1 || Math.abs(finite(input?.look?.y)) > 1) errors.push('look-overflow');
  if (!Array.isArray(input?.activeSources)) errors.push('missing-sources');
  return Object.freeze({ ok: errors.length === 0, errors });
}

export function getPlayerWorldCoverageInputContract() {
  return Object.freeze({
    sources: ['keyboard', 'gamepad', 'touch'],
    lookSource: 'mouse-or-caller-owned-camera',
    deadZone: DEAD_ZONE,
    axisRange: [-1, 1],
    arbitration: 'mean-active-source',
    ownership: 'caller-owned-device-services',
  });
}
