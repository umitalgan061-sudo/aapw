import { createPlayerInputParity, ACTIONS } from './playerInputParity.legacy.js';

export type PlayerInputParityReceipt = Readonly<{
  held: readonly string[];
  pressed: readonly string[];
  move: Readonly<{ x: number; y: number }>;
  actionCount: number;
  heldCount: number;
  pressedCount: number;
  signature: string;
}>;

const finite = (value: unknown, fallback = 0): number =>
  Number.isFinite(value) ? Number(value) : fallback;

const list = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string'))].sort()
    : [];

const moveOf = (value: unknown): { x: number; y: number } => {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.freeze({
    x: Number(finite(source.x).toFixed(6)),
    y: Number(finite(source.y).toFixed(6)),
  });
};

export function createPlayerInputParityReceipt(
  source: ReturnType<typeof createPlayerInputParity>,
): PlayerInputParityReceipt {
  const snapshot = source.snapshot();
  const held = Object.freeze(list(snapshot.held));
  const pressed = Object.freeze(list(snapshot.pressed));
  const move = moveOf(snapshot.move);
  const base = {
    held,
    pressed,
    move,
    actionCount: ACTIONS.length,
    heldCount: held.length,
    pressedCount: pressed.length,
  };
  return Object.freeze({
    ...base,
    signature: JSON.stringify({
      held,
      pressed,
      move,
      actionCount: ACTIONS.length,
    }),
  });
}
