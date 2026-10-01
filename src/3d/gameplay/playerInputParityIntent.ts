export type PlayerInputSource = 'keyboard' | 'gamepad' | 'touch';
export type PlayerInputAction = 'move' | 'look' | 'attackLight' | 'attackHeavy' | 'guard' | 'dodge' | 'lockOn' | 'interact';

export interface PlayerInputSample {
  source: PlayerInputSource;
  moveX?: number;
  moveY?: number;
  lookX?: number;
  lookY?: number;
  pressed?: readonly PlayerInputAction[];
  held?: readonly PlayerInputAction[];
  timestampMs?: number;
}

export interface PlayerInputParityIntent {
  version: 'player-input-parity-v1';
  source: PlayerInputSource;
  moveX: number;
  moveY: number;
  lookX: number;
  lookY: number;
  pressed: readonly PlayerInputAction[];
  held: readonly PlayerInputAction[];
  deadzoneApplied: number;
  replayKey: string;
  frozen: true;
}

const ACTIONS: readonly PlayerInputAction[] = [
  'move', 'look', 'attackLight', 'attackHeavy', 'guard', 'dodge', 'lockOn', 'interact',
];
const MAX_AXIS = 1;
const DEADZONE = 0.12;

const clamp = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(-MAX_AXIS, Math.min(MAX_AXIS, numeric));
};

const applyDeadzone = (value: number): number => {
  const magnitude = Math.abs(value);
  if (magnitude <= DEADZONE) return 0;
  const scaled = (magnitude - DEADZONE) / (1 - DEADZONE);
  return Math.sign(value) * Math.min(MAX_AXIS, scaled);
};

const uniqueActions = (actions: readonly PlayerInputAction[] | undefined): readonly PlayerInputAction[] =>
  [...new Set((actions ?? []).filter((action): action is PlayerInputAction => ACTIONS.includes(action)))].sort();

const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') Object.freeze(value);
  return value;
};

const canonicalKey = (intent: Omit<PlayerInputParityIntent, 'replayKey' | 'frozen'>): string =>
  ['v1', intent.source, intent.moveX.toFixed(4), intent.moveY.toFixed(4), intent.lookX.toFixed(4), intent.lookY.toFixed(4), intent.pressed.join(','), intent.held.join(',')].join('|');

export function createPlayerInputParityIntent(sample: PlayerInputSample): PlayerInputParityIntent {
  const source: PlayerInputSource = sample.source === 'gamepad' || sample.source === 'touch' ? sample.source : 'keyboard';
  const pressed = uniqueActions(sample.pressed);
  const held = uniqueActions(sample.held);
  const draft = {
    version: 'player-input-parity-v1' as const,
    source,
    moveX: applyDeadzone(clamp(sample.moveX)),
    moveY: applyDeadzone(clamp(sample.moveY)),
    lookX: applyDeadzone(clamp(sample.lookX)),
    lookY: applyDeadzone(clamp(sample.lookY)),
    pressed,
    held,
    deadzoneApplied: DEADZONE,
  };
  const intent = { ...draft, replayKey: canonicalKey(draft), frozen: true as const };
  Object.freeze(intent.pressed);
  Object.freeze(intent.held);
  return Object.freeze(intent);
}

export function isPlayerInputParityIntent(value: unknown): value is PlayerInputParityIntent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as PlayerInputParityIntent;
  if (candidate.version !== 'player-input-parity-v1' || candidate.frozen !== true) return false;
  if (!['keyboard', 'gamepad', 'touch'].includes(candidate.source)) return false;
  if (![candidate.moveX, candidate.moveY, candidate.lookX, candidate.lookY].every((axis) => Number.isFinite(axis) && Math.abs(axis) <= 1)) return false;
  if (candidate.deadzoneApplied !== DEADZONE) return false;
  if (!Array.isArray(candidate.pressed) || !Array.isArray(candidate.held)) return false;
  const expected = canonicalKey({
    version: candidate.version,
    source: candidate.source,
    moveX: candidate.moveX,
    moveY: candidate.moveY,
    lookX: candidate.lookX,
    lookY: candidate.lookY,
    pressed: candidate.pressed,
    held: candidate.held,
    deadzoneApplied: candidate.deadzoneApplied,
  });
  return candidate.replayKey === expected;
}

export const PLAYER_INPUT_PARITY_DEADZONE = DEADZONE;
