const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};

export function resolvePlayerCombatFeedbackRoute(input = {}) {
  const outcome = typeof input.outcome === 'string' ? input.outcome : 'none';
  const family = outcome === 'parried' ? 'parry' : outcome === 'blocked' ? 'guard' : outcome === 'staggered' || outcome === 'guard-break' ? 'stagger' : outcome === 'hit' ? 'hit' : 'none';
  const severity = clamp(Number(input.severity) || 0, 0, 1);
  const poiseAfter = clamp(Number(input.poiseAfter) || 0, 0, 100);
  const cameraImpulse = clamp(Number(input.cameraImpulse) || 0, 0, 1);
  const haptic = family === 'parry' ? 'heavy' : family === 'stagger' ? 'strong' : family === 'hit' ? 'light' : 'none';
  const vfx = family === 'parry' ? 'spark-parry' : family === 'guard' ? 'spark-guard' : family === 'stagger' ? 'impact-stagger' : family === 'hit' ? 'impact-hit' : 'none';
  const sfx = family === 'parry' ? 'combat-parry' : family === 'guard' ? 'combat-block' : family === 'stagger' ? 'combat-guard-break' : family === 'hit' ? 'combat-hit' : 'none';
  const direction = input.impactDirection && typeof input.impactDirection === 'object'
    ? { x: round(clamp(Number(input.impactDirection.x) || 0, -1, 1), 3), z: round(clamp(Number(input.impactDirection.z) || 0, -1, 1), 3) }
    : { x: 0, z: 0 };
  const replayKey = [outcome, family, round(severity, 3), round(poiseAfter, 2), round(cameraImpulse, 3), haptic, vfx, sfx, direction.x, direction.z].join('|');
  return freeze({ outcome, family, severity: round(severity), poiseAfter: round(poiseAfter, 2), cameraImpulse: round(cameraImpulse), haptic, vfx, sfx, impactDirection: direction, replayKey });
}

export function isPlayerCombatFeedbackRoute(value) {
  return Boolean(value && typeof value === 'object' && typeof value.outcome === 'string' && typeof value.family === 'string' && Number.isFinite(value.severity) && Number.isFinite(value.poiseAfter) && Number.isFinite(value.cameraImpulse) && typeof value.haptic === 'string' && typeof value.vfx === 'string' && typeof value.sfx === 'string' && value.impactDirection && Number.isFinite(value.impactDirection.x) && Number.isFinite(value.impactDirection.z) && typeof value.replayKey === 'string');
}
