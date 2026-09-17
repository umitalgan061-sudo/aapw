/**
 * Deterministic grounding/foot-phase policy for the existing player locomotion runtime.
 *
 * The caller owns raycasts, colliders, transforms, IK solvers and AnimationMixer state.
 * This module only converts caller-owned grounding samples into a bounded receipt.
 *
 * @module gameplay/playerLocomotionGroundingDirector
 */

const MAX_HISTORY = 24;
const MIN_CONTACT = 0;
const MAX_CONTACT = 2;
const clamp = (v, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(v)) ? Number(v) : min));
const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const idOf = (v, fallback) => String(v ?? fallback).trim().slice(0, 96) || fallback;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeFoot(sample, fallbackId) {
  const foot = sample && typeof sample === 'object' ? sample : {};
  return {
    id: idOf(foot.id, fallbackId),
    contact: clamp(foot.contact, MIN_CONTACT, MAX_CONTACT),
    height: clamp(foot.height, -2, 2),
    confidence: clamp(foot.confidence, 0, 1),
    phase: clamp(foot.phase, 0, 0.999999),
  };
}

export function createPlayerLocomotionGroundingDirector({ maxHistory = MAX_HISTORY } = {}) {
  const historyLimit = Math.max(1, Math.min(64, Math.trunc(finite(maxHistory, MAX_HISTORY))));
  let serial = 0;
  let disposed = false;
  const history = [];

  const makeReceipt = (input = {}) => {
    if (disposed) throw new Error('playerLocomotionGroundingDirector is disposed');
    const left = normalizeFoot(input.left, 'left');
    const right = normalizeFoot(input.right, 'right');
    const grounded = Boolean(input.grounded) && (left.confidence + right.confidence > 0);
    const averagedHeight = grounded ? (left.height + right.height) / 2 : 0;
    const heightDelta = Math.abs(left.height - right.height);
    const phase = clamp(finite(input.phase, (left.phase + right.phase) / 2), 0, 0.999999);
    const preferredLead = phase < 0.5 ? left.id : right.id;
    const slipRisk = grounded && heightDelta > 0.18;
    const ikWeight = grounded ? clamp(Math.min(left.confidence, right.confidence) * (slipRisk ? 0.6 : 1), 0, 1) : 0;
    const receipt = deepFreeze({
      serial: ++serial,
      grounded,
      surface: idOf(input.surface, 'unknown'),
      slopeRadians: clamp(input.slopeRadians, 0, 1.57),
      averagedHeight: Number(averagedHeight.toFixed(5)),
      heightDelta: Number(heightDelta.toFixed(5)),
      preferredLead,
      slipRisk,
      ik: {
        enabled: ikWeight > 0,
        weight: Number(ikWeight.toFixed(5)),
        left: Number((grounded ? left.confidence : 0).toFixed(5)),
        right: Number((grounded ? right.confidence : 0).toFixed(5)),
      },
      feet: { left, right },
    });
    history.push(receipt);
    while (history.length > historyLimit) history.shift();
    return receipt;
  };

  return {
    sample(input) { return makeReceipt(input); },
    snapshot() { return deepFreeze({ disposed, serial, history: history.slice() }); },
    validate(receipt) {
      return Boolean(receipt && Number.isInteger(receipt.serial) && receipt.serial > 0 && receipt.ik && receipt.feet?.left && receipt.feet?.right);
    },
    reset() { if (disposed) return false; history.length = 0; serial = 0; return true; },
    dispose() { disposed = true; history.length = 0; return true; },
  };
}
