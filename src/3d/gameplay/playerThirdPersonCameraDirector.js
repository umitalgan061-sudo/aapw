const ACTIONS = Object.freeze({
  FOLLOW: 'follow',
  LOCK_ON: 'lock-on',
  AIM: 'aim',
  DODGE: 'dodge',
  ATTACK: 'attack',
});

const MODES = Object.freeze({
  FOLLOW: 'follow',
  LOCK_ON: 'lock-on',
  AIM: 'aim',
  RECOVERY: 'recovery',
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const round = (value) => Math.round(value * 1e6) / 1e6;

const normalizeTarget = (target, index) => ({
  id: String(target?.id ?? `target-${index}`),
  distance: Math.max(0, finite(target?.distance, Infinity)),
  angle: finite(target?.angle),
  visible: target?.visible !== false,
  priority: clamp(finite(target?.priority), -1, 1),
});

const rankTarget = (left, right, currentId) => {
  const score = (target) =>
    (target.visible ? 2 : 0)
    + target.priority
    - Math.min(target.distance, 100) / 100
    - Math.abs(target.angle) / Math.PI
    + (target.id === currentId ? 0.15 : 0);
  const delta = score(right) - score(left);
  if (Math.abs(delta) > 1e-9) return delta;
  return left.id.localeCompare(right.id);
};

export function createPlayerThirdPersonCameraDirector({ historyLimit = 24 } = {}) {
  const history = [];
  let disposed = false;
  let sequence = 0;
  let currentTargetId = null;
  let yaw = 0;
  let pitch = 0.22;

  const snapshot = (value) => Object.freeze(JSON.parse(JSON.stringify(value)));
  const push = (receipt) => {
    history.push(receipt);
    while (history.length > Math.max(1, Math.floor(historyLimit))) history.shift();
  };

  const derive = ({
    action = ACTIONS.FOLLOW,
    deltaTime = 1 / 60,
    lookDelta = { x: 0, y: 0 },
    targets = [],
    grounded = true,
    speed = 0,
    aiming = false,
    recovering = false,
  } = {}) => {
    if (disposed) return null;
    const dt = clamp(finite(deltaTime, 1 / 60), 0, 0.25);
    const normalizedAction = Object.values(ACTIONS).includes(action) ? action : ACTIONS.FOLLOW;
    yaw = round(yaw + clamp(finite(lookDelta?.x), -1, 1) * dt * 5.5);
    pitch = round(clamp(pitch + clamp(finite(lookDelta?.y), -1, 1) * dt * 3.25, -0.55, 0.85));

    const candidates = targets.map(normalizeTarget).filter((target) => target.visible);
    candidates.sort((left, right) => rankTarget(left, right, currentTargetId));
    const selected = candidates[0] ?? null;
    if (normalizedAction === ACTIONS.LOCK_ON && selected) currentTargetId = selected.id;
    if (normalizedAction === ACTIONS.DODGE || normalizedAction === ACTIONS.ATTACK) currentTargetId = selected?.id ?? currentTargetId;
    if (!selected && normalizedAction === ACTIONS.LOCK_ON) currentTargetId = null;

    const mode = recovering ? MODES.RECOVERY : aiming || normalizedAction === ACTIONS.AIM ? MODES.AIM : currentTargetId ? MODES.LOCK_ON : MODES.FOLLOW;
    const distance = mode === MODES.AIM ? 2.25 : mode === MODES.LOCK_ON ? 3.4 : 4.2;
    const shoulderOffset = mode === MODES.AIM ? 0.62 : mode === MODES.LOCK_ON ? 0.48 : 0.35;
    const collisionRadius = mode === MODES.AIM ? 0.28 : 0.4;
    const damping = grounded ? clamp(8 + speed * 0.6, 8, 14) : 6;

    const receipt = snapshot({
      sequence: ++sequence,
      action: normalizedAction,
      mode,
      grounded: Boolean(grounded),
      speed: round(clamp(finite(speed), 0, 20)),
      orbit: { yaw, pitch },
      framing: {
        distance: round(distance),
        shoulderOffset: round(shoulderOffset),
        collisionRadius: round(collisionRadius),
        damping: round(damping),
      },
      target: currentTargetId ? { id: currentTargetId, retained: selected?.id === currentTargetId } : null,
      candidateCount: candidates.length,
    });
    push(receipt);
    return receipt;
  };

  return Object.freeze({
    derive,
    getHistory: () => history.slice(),
    reset: () => {
      if (disposed) return false;
      history.length = 0;
      sequence = 0;
      currentTargetId = null;
      yaw = 0;
      pitch = 0.22;
      return true;
    },
    dispose: () => {
      disposed = true;
      history.length = 0;
      currentTargetId = null;
      return true;
    },
    isDisposed: () => disposed,
  });
}

export function validatePlayerThirdPersonCameraReceipt(receipt) {
  return Boolean(
    receipt
    && Number.isInteger(receipt.sequence)
    && receipt.sequence > 0
    && Object.values(MODES).includes(receipt.mode)
    && Number.isFinite(receipt.orbit?.yaw)
    && receipt.orbit.pitch >= -0.55
    && receipt.orbit.pitch <= 0.85
    && receipt.framing.distance > 0
    && receipt.framing.collisionRadius > 0
    && receipt.framing.damping >= 0
  );
}

export const PLAYER_THIRD_PERSON_CAMERA_ACTIONS = ACTIONS;
export const PLAYER_THIRD_PERSON_CAMERA_MODES = MODES;
