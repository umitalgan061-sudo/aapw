/** Typed adapter over the existing player combat targeting authority. */
import { selectPlayerCombatTarget } from './playerCombatTargetingDirector.js';

export function resolvePlayerCombatFocus(input: any = {}) {
  const result = selectPlayerCombatTarget(input);
  return Object.freeze({
    target: result.target,
    targetId: result.targetId,
    distanceMeters: result.distanceMeters,
    angleRadians: result.angleRadians,
    candidateCount: result.candidateCount,
    locked: Boolean(result.targetId && input?.lockedTargetId === result.targetId),
  });
}
