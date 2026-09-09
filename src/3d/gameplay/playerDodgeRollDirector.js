const ACTIONS = Object.freeze(['dodge', 'roll']);
const MODES = Object.freeze(['neutral', 'incoming', 'recovery', 'airborne', 'stunned']);
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

function normalizeAction(value) {
  const action = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ACTIONS.includes(action) ? action : 'dodge';
}

function normalizeMode(value) {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return MODES.includes(mode) ? mode : 'neutral';
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

export function resolvePlayerDodgeRoll(input = {}) {
  const stamina = clamp(finite(input.stamina, 0), 0, 100);
  const staminaCost = clamp(finite(input.staminaCost, 20), 0, 100);
  const mode = normalizeMode(input.mode);
  const action = normalizeAction(input.action);
  const grounded = input.grounded !== false;
  const buffered = input.buffered === true;
  const invulnerabilityMs = clamp(finite(input.invulnerabilityMs, 240), 60, 600);
  const recoveryMs = clamp(finite(input.recoveryMs, 420), 120, 1200);
  const rollSpeed = clamp(finite(input.rollSpeed, 6.5), 1, 14);
  const directionX = clamp(finite(input.directionX, 0), -1, 1);
  const directionZ = clamp(finite(input.directionZ, 1), -1, 1);
  const directionMagnitude = Math.hypot(directionX, directionZ);
  const hasDirection = directionMagnitude > 0.05;
  const canAct = grounded && mode !== 'airborne' && mode !== 'stunned' && mode !== 'recovery';
  const affordable = stamina >= staminaCost;
  const accepted = canAct && affordable;
  const normalizedMagnitude = hasDirection ? directionMagnitude : 1;
  const direction = Object.freeze({
    x: hasDirection ? directionX / normalizedMagnitude : 0,
    z: hasDirection ? directionZ / normalizedMagnitude : 1,
  });
  const result = {
    action,
    mode,
    accepted,
    buffered: buffered && !accepted,
    grounded,
    staminaBefore: stamina,
    staminaAfter: accepted ? clamp(stamina - staminaCost, 0, 100) : stamina,
    staminaCost: accepted ? staminaCost : 0,
    invulnerabilityMs: accepted ? invulnerabilityMs : 0,
    recoveryMs: accepted ? recoveryMs : 0,
    rollSpeed: accepted ? rollSpeed : 0,
    direction,
    perfectTimingWindowMs: accepted ? clamp(invulnerabilityMs * 0.35, 24, 180) : 0,
    interruptsAttack: accepted && mode === 'incoming',
    outcome: accepted ? 'accepted' : (buffered ? 'buffered' : 'rejected'),
    reason: accepted ? 'ready' : (!grounded ? 'not-grounded' : mode === 'stunned' ? 'stunned' : mode === 'recovery' ? 'recovery' : !affordable ? 'insufficient-stamina' : 'blocked'),
  };
  return deepFreeze(result);
}

export function serializePlayerDodgeRoll(input = {}) {
  return JSON.stringify(resolvePlayerDodgeRoll(input));
}
