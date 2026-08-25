/**
 * Shared same-event damage resolution side-channel for immutable producer payloads.
 * Player defense may need to mitigate a frozen damage object before health consumes it; mutable
 * payloads still receive legacy write-backs, while this WeakMap keeps the authoritative resolution
 * available without requiring a second combat/event framework.
 * @module gameplay/damageResolution
 */

const pendingDamageResolutions = new WeakMap();

function isObjectPayload(payload) {
  return payload !== null && (typeof payload === 'object' || typeof payload === 'function');
}

function tryWrite(payload, key, value) {
  if (!isObjectPayload(payload)) return false;
  try {
    return Reflect.set(payload, key, value);
  } catch {
    return false;
  }
}

export function stageDamageResolution(payload, patch = {}) {
  if (!isObjectPayload(payload)) return null;
  const previous = pendingDamageResolutions.get(payload) ?? {};
  const next = Object.freeze({ ...previous, ...patch });
  pendingDamageResolutions.set(payload, next);
  for (const [key, value] of Object.entries(patch)) tryWrite(payload, key, value);
  return next;
}

export function readDamageResolution(payload) {
  return isObjectPayload(payload) ? (pendingDamageResolutions.get(payload) ?? null) : null;
}

export function clearDamageResolution(payload) {
  if (isObjectPayload(payload)) pendingDamageResolutions.delete(payload);
}

export function writeDamageAppliedAmount(payload, appliedAmount) {
  if (!isObjectPayload(payload)) return false;
  const previous = pendingDamageResolutions.get(payload);
  if (previous) pendingDamageResolutions.set(payload, Object.freeze({ ...previous, appliedAmount }));
  return tryWrite(payload, 'appliedAmount', appliedAmount);
}
