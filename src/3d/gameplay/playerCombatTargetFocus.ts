export function projectPlayerCombatTargetFocus(selection = null, options = {}) {
  const targetId = typeof selection?.targetId === 'string' && selection.targetId.length > 0 ? selection.targetId : null;
  const hasTarget = Boolean(targetId);
  const lockRequested = Boolean(options?.lockRequested && hasTarget);
  const mode = hasTarget ? (lockRequested ? 'locked' : 'soft-focus') : 'none';
  const distanceMeters = hasTarget && Number.isFinite(selection?.distanceMeters) ? Number(selection.distanceMeters.toFixed(3)) : null;
  const angleRadians = hasTarget && Number.isFinite(selection?.angleRadians) ? Number(selection.angleRadians.toFixed(4)) : null;
  const candidateCount = Math.max(0, Math.floor(Number.isFinite(selection?.candidateCount) ? selection.candidateCount : 0));
  return Object.freeze({
    mode,
    targetId,
    hasTarget,
    lockRequested,
    strength: hasTarget ? Math.max(0, Math.min(1, Number.isFinite(options?.lockStrength) ? options.lockStrength : 1)) : 0,
    distanceMeters,
    angleRadians,
    candidateCount,
    focusKey: [mode, targetId ?? '-', distanceMeters ?? '-', angleRadians ?? '-', candidateCount].join('|'),
  });
}
