/**
 * Deterministic locomotion-to-animation blend intent.
 * Observation-only: the shipped player animation director/mixer remains the mutation owner.
 */
export type PlayerLocomotionAnimationInput = {
  moveX?: number;
  moveY?: number;
  speed?: number;
  grounded?: boolean;
  sprinting?: boolean;
  combatMode?: boolean;
  attackBusy?: boolean;
  hitStaggered?: boolean;
};

export type PlayerLocomotionAnimationBlendIntent = {
  locomotion: 'idle' | 'walk' | 'run' | 'sprint' | 'airborne' | 'stagger';
  primaryClip: string;
  secondaryClip: string | null;
  locomotionWeight: number;
  combatLayerWeight: number;
  upperBodyMaskWeight: number;
  playbackRate: number;
  direction: 'forward' | 'backward' | 'strafe-left' | 'strafe-right' | 'none';
  blendKey: string;
};

const clamp01 = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
};

const signed = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(-1, Math.min(1, numeric)) : 0;
};

const normalizeSpeed = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
};

const freeze = <T>(value: T): T => Object.freeze(value);

export function createPlayerLocomotionAnimationBlendIntent(
  input: PlayerLocomotionAnimationInput = {},
): PlayerLocomotionAnimationBlendIntent {
  const moveX = signed(input.moveX);
  const moveY = signed(input.moveY);
  const speed = normalizeSpeed(input.speed);
  const grounded = input.grounded !== false;
  const sprinting = input.sprinting === true;
  const combatMode = input.combatMode === true;
  const attackBusy = input.attackBusy === true;
  const hitStaggered = input.hitStaggered === true;

  const locomotion = !grounded
    ? 'airborne'
    : hitStaggered
      ? 'stagger'
      : sprinting && speed > 0.18
        ? 'sprint'
        : speed > 0.55
          ? 'run'
          : speed > 0.08
            ? 'walk'
            : 'idle';

  const direction = Math.abs(moveY) >= Math.abs(moveX)
    ? moveY > 0.08 ? 'forward' : moveY < -0.08 ? 'backward' : 'none'
    : moveX > 0.08 ? 'strafe-right' : moveX < -0.08 ? 'strafe-left' : 'none';

  const primaryClip = locomotion === 'airborne'
    ? 'locomotion.airborne'
    : locomotion === 'stagger'
      ? 'combat.stagger'
      : `locomotion.${locomotion}`;
  const secondaryClip = combatMode || attackBusy ? 'combat.ready' : null;
  const combatLayerWeight = combatMode ? (attackBusy ? 1 : 0.72) : 0;
  const upperBodyMaskWeight = combatMode ? 1 : 0;
  const locomotionWeight = grounded ? (speed > 0 ? 1 : 0.35) : 0.2;
  const playbackRate = Math.max(0.65, Math.min(1.35, 0.8 + speed * 0.55 + (sprinting ? 0.12 : 0)));
  const blendKey = [locomotion, direction, Math.round(combatLayerWeight * 100), Math.round(playbackRate * 100)].join('|');

  return freeze({
    locomotion,
    primaryClip,
    secondaryClip,
    locomotionWeight: clamp01(locomotionWeight),
    combatLayerWeight: clamp01(combatLayerWeight),
    upperBodyMaskWeight: clamp01(upperBodyMaskWeight),
    playbackRate,
    direction,
    blendKey,
  });
}

export function isPlayerLocomotionAnimationBlendIntent(value: unknown): value is PlayerLocomotionAnimationBlendIntent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PlayerLocomotionAnimationBlendIntent>;
  return ['idle', 'walk', 'run', 'sprint', 'airborne', 'stagger'].includes(String(candidate.locomotion))
    && typeof candidate.primaryClip === 'string'
    && (candidate.secondaryClip === null || typeof candidate.secondaryClip === 'string')
    && ['forward', 'backward', 'strafe-left', 'strafe-right', 'none'].includes(String(candidate.direction))
    && [candidate.locomotionWeight, candidate.combatLayerWeight, candidate.upperBodyMaskWeight, candidate.playbackRate]
      .every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    && typeof candidate.blendKey === 'string';
}
