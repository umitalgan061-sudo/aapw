/**
 * Deterministic turn intent projection for the existing player combat pipeline.
 * The caller owns actual yaw/camera/scene mutation.
 */
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const normalizeAngle = (v) => {
  let a = finite(v, 0);
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
};

export function projectCombatTurnIntent(input = {}) {
  const locked = Boolean(input.lockedOn || input.hasLockOnTarget);
  const targetYaw = finite(input.targetYaw, finite(input.targetAngle, 0));
  const playerYaw = finite(input.playerYaw, 0);
  const maxTurn = clamp(finite(input.maxTurnRadians, 0.22), 0, 1.25);
  const deadZone = clamp(finite(input.deadZoneRadians, 0.025), 0, 0.35);
  const manual = clamp(finite(input.manualTurn, 0), -1, 1);
  const delta = normalizeAngle(targetYaw - playerYaw);
  const lockedTurn = Math.abs(delta) <= deadZone ? 0 : clamp(delta, -maxTurn, maxTurn);
  const turn = locked ? lockedTurn : manual * maxTurn;
  const combatAction = String(input.action || '').trim().toLowerCase();
  const committed = ['light', 'heavy', 'parry', 'guard', 'dodge', 'rangedrelease'].includes(combatAction);
  return freezeDeep({
    mode: locked ? 'lock-on' : 'free',
    targetId: locked ? String(input.targetId || '').trim().slice(0, 96) : '',
    signedTurnRadians: Number(turn.toFixed(6)),
    facingErrorRadians: Number(delta.toFixed(6)),
    withinDeadZone: Math.abs(delta) <= deadZone,
    maxTurnRadians: Number(maxTurn.toFixed(6)),
    committed,
    action: combatAction || 'none',
  });
}

export function serializeCombatTurnIntent(value) {
  return JSON.stringify(value || {});
}
