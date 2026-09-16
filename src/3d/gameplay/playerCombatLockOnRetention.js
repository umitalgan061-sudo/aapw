/**
 * Deterministic lock-on retention over the existing target selector.
 * The caller remains authoritative for actor lifecycle, camera, input and mutation.
 */
import { selectPlayerCombatTarget } from './playerCombatTargetingDirector.js';

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normalizeId = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

export function createPlayerCombatLockOnRetention(options = {}) {
  const retentionFrames = Math.max(0, Math.floor(finite(options.retentionFrames, 8)));
  const maxDistanceMeters = Math.max(0, finite(options.maxDistanceMeters, 18));
  const maxAngleRadians = Math.max(0, finite(options.maxAngleRadians, Math.PI * 0.75));
  let lockedTargetId = null;
  let lostFrames = 0;
  let disposed = false;

  const step = (input = {}) => {
    if (disposed) return Object.freeze({ lockedTargetId: null, target: null, retained: false, lostFrames: 0, disposed: true });
    const actors = Array.isArray(input.actors) ? input.actors : [];
    const selected = selectPlayerCombatTarget({
      playerPosition: input.playerPosition,
      forward: input.forward,
      actors,
      lockedTargetId,
      maxDistanceMeters,
      maxAngleRadians,
      preferLockedTarget: true,
    });
    const requested = normalizeId(input.requestedTargetId);
    const requestedActor = requested ? actors.find((actor) => normalizeId(actor?.id) === requested) : null;
    const currentActor = lockedTargetId ? actors.find((actor) => normalizeId(actor?.id) === lockedTargetId) : null;
    const candidate = requestedActor || currentActor || selected.target;
    const candidateId = normalizeId(candidate?.id) || selected.targetId;
    const targetable = candidate && candidate.isTargetable !== false;
    if (targetable) {
      lockedTargetId = candidateId;
      lostFrames = 0;
    } else if (lockedTargetId) {
      lostFrames += 1;
      if (lostFrames > retentionFrames) {
        lockedTargetId = null;
        lostFrames = 0;
      }
    }
    const target = lockedTargetId ? actors.find((actor) => normalizeId(actor?.id) === lockedTargetId) || null : null;
    return Object.freeze({
      lockedTargetId,
      target,
      retained: Boolean(target && !requestedActor && lostFrames > 0),
      lostFrames,
      candidateCount: selected.candidateCount,
      selection: selected,
      disposed: false,
    });
  };

  const clear = () => { lockedTargetId = null; lostFrames = 0; };
  const snapshot = () => Object.freeze({ lockedTargetId, lostFrames, retentionFrames, maxDistanceMeters, maxAngleRadians, disposed });
  const dispose = () => { disposed = true; clear(); };
  return Object.freeze({ step, clear, snapshot, dispose });
}

export function validatePlayerCombatLockOnRetention(receipt = {}) {
  const lostFrames = finite(receipt.lostFrames, -1);
  const candidateCount = finite(receipt.candidateCount, -1);
  return lostFrames >= 0 && candidateCount >= 0 && (receipt.lockedTargetId === null || typeof receipt.lockedTargetId === 'string');
}
