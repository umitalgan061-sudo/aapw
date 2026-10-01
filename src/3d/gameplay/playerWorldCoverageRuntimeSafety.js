/**
 * Fail-closed safety facade for the player world-coverage runtime adapter.
 *
 * This module does not replace the adapter or own player/world state. It adds a narrow boundary for
 * callers that need a non-throwing update path and an explicit error event when a malformed observation
 * or disposed adapter is encountered.
 *
 * @module gameplay/playerWorldCoverageRuntimeSafety
 */

import { PLAYER_WORLD_COVERAGE_ERROR_EVENT } from './playerWorldCoverageRuntimeAdapter.js';

function clone(value) {
  if (value === undefined) return undefined;
  try { return JSON.parse(JSON.stringify(value)); } catch { return { value: String(value) }; }
}

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((child) => freeze(child, seen));
  return Object.freeze(value);
}

function emitError(eventTarget, detail) {
  if (!eventTarget || typeof eventTarget.dispatchEvent !== 'function') return false;
  const CustomEventCtor = eventTarget.CustomEvent ?? globalThis.CustomEvent;
  if (typeof CustomEventCtor !== 'function') return false;
  eventTarget.dispatchEvent(new CustomEventCtor(PLAYER_WORLD_COVERAGE_ERROR_EVENT, { detail: freeze(clone(detail)) }));
  return true;
}

export function createPlayerWorldCoverageRuntimeSafety({ adapter, eventTarget = globalThis } = {}) {
  if (!adapter || typeof adapter.update !== 'function') throw new TypeError('adapter.update required');

  function safeUpdate(input = {}) {
    try {
      return freeze({ ok: true, result: adapter.update(input), error: null });
    } catch (error) {
      const detail = freeze({
        ok: false,
        phase: 'update',
        message: String(error?.message ?? error ?? 'unknown-error'),
        revision: Number.isFinite(adapter.revision) ? adapter.revision : 0,
      });
      emitError(eventTarget, detail);
      return detail;
    }
  }

  function safeFocus(targets = []) {
    try {
      return freeze({ ok: true, result: adapter.focus(targets), error: null });
    } catch (error) {
      const detail = freeze({
        ok: false,
        phase: 'focus',
        message: String(error?.message ?? error ?? 'unknown-error'),
        revision: Number.isFinite(adapter.revision) ? adapter.revision : 0,
      });
      emitError(eventTarget, detail);
      return detail;
    }
  }

  function diagnostics() {
    try {
      return freeze({ ok: true, result: adapter.diagnostics(), error: null });
    } catch (error) {
      return freeze({ ok: false, result: null, error: String(error?.message ?? error ?? 'unknown-error') });
    }
  }

  return Object.freeze({ safeUpdate, safeFocus, diagnostics });
}

export function validatePlayerWorldCoverageRuntimeSafety(source) {
  const errors = [];
  if (!source || typeof source !== 'object') errors.push('missing-source');
  if (typeof source?.safeUpdate !== 'function') errors.push('missing-safe-update');
  if (typeof source?.safeFocus !== 'function') errors.push('missing-safe-focus');
  if (typeof source?.diagnostics !== 'function') errors.push('missing-diagnostics');
  return Object.freeze({ ok: errors.length === 0, errors });
}
