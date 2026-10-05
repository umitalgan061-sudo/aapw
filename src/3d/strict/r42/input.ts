/**
 * Deterministic input normalization and command generation for R42.
 * Production TypeScript owner. Browser adapters feed this module, never own game state.
 */

import type { ActionCommand, InputFrame, InputSource, Vec2 } from './types.ts';
import { clamp, normalize2, finite, safeInteger, vec2 } from './types.ts';

export interface RawInput {
  readonly tick?: number;
  readonly sequence?: number;
  readonly moveX?: number;
  readonly moveY?: number;
  readonly lookX?: number;
  readonly lookY?: number;
  readonly jump?: boolean;
  readonly sprint?: boolean;
  readonly guard?: boolean;
  readonly attack?: boolean;
  readonly dodge?: boolean;
  readonly interact?: boolean;
  readonly source?: InputSource;
}

export interface InputNormalizerOptions {
  readonly deadzone?: number;
  readonly digitalMagnitude?: number;
  readonly maxHistory?: number;
  readonly maxLookMagnitude?: number;
}

const DEFAULTS: Required<InputNormalizerOptions> = {
  deadzone: 0.08,
  digitalMagnitude: 1,
  maxHistory: 256,
  maxLookMagnitude: 4,
};

export class InputNormalizerR42 {
  readonly options: Required<InputNormalizerOptions>;
  #history: InputFrame[] = [];
  #lastSequence = -1;

  constructor(options: InputNormalizerOptions = {}) {
    this.options = Object.freeze({
      ...DEFAULTS,
      ...options,
      deadzone: clamp(finite(options.deadzone, DEFAULTS.deadzone), 0, 0.75),
      digitalMagnitude: clamp(finite(options.digitalMagnitude, DEFAULTS.digitalMagnitude), 0.25, 2),
      maxHistory: Math.max(8, Math.trunc(finite(options.maxHistory, DEFAULTS.maxHistory))),
      maxLookMagnitude: clamp(finite(options.maxLookMagnitude, DEFAULTS.maxLookMagnitude), 0.5, 8),
    });
  }

  normalize(raw: RawInput): InputFrame {
    const move = normalizeAxisPair(raw.moveX ?? 0, raw.moveY ?? 0, this.options.deadzone);
    const look = {
      x: clamp(finite(raw.lookX), -this.options.maxLookMagnitude, this.options.maxLookMagnitude),
      y: clamp(finite(raw.lookY), -this.options.maxLookMagnitude, this.options.maxLookMagnitude),
    };

    const sequence = Math.max(this.#lastSequence + 1, safeInteger(raw.sequence, this.#lastSequence + 1));
    const frame: InputFrame = Object.freeze({
      tick: Math.max(0, safeInteger(raw.tick)),
      sequence,
      move,
      look: vec2(look.x, look.y),
      jump: Boolean(raw.jump),
      sprint: Boolean(raw.sprint),
      guard: Boolean(raw.guard),
      attack: Boolean(raw.attack),
      dodge: Boolean(raw.dodge),
      interact: Boolean(raw.interact),
      source: raw.source ?? 'mixed',
    });

    this.#lastSequence = sequence;
    this.#history.push(frame);
    if (this.#history.length > this.options.maxHistory) this.#history.shift();
    return frame;
  }

  history(): readonly InputFrame[] {
    return Object.freeze([...this.#history]);
  }

  bySequence(sequence: number): InputFrame | null {
    const target = safeInteger(sequence, -1);
    return this.#history.find(frame => frame.sequence === target) ?? null;
  }

  consumeThrough(sequence: number): readonly InputFrame[] {
    const target = safeInteger(sequence, -1);
    const consumed = this.#history.filter(frame => frame.sequence <= target);
    this.#history = this.#history.filter(frame => frame.sequence > target);
    return Object.freeze(consumed);
  }

  clear(): void {
    this.#history = [];
    this.#lastSequence = -1;
  }
}

export class InputCommandBufferR42 {
  readonly maxPerTick: number;
  readonly maxHistory: number;
  #pending: ActionCommand[] = [];
  #history: ActionCommand[] = [];

  constructor(maxPerTick = 128, maxHistory = 1024) {
    this.maxPerTick = Math.max(1, Math.trunc(maxPerTick));
    this.maxHistory = Math.max(this.maxPerTick, Math.trunc(maxHistory));
  }

  push(command: ActionCommand): boolean {
    if (this.#pending.length >= this.maxPerTick) return false;
    this.#pending.push(Object.freeze({
      ...command,
      tick: Math.max(0, safeInteger(command.tick)),
      sequence: Math.max(0, safeInteger(command.sequence)),
      id: sanitizeId(command.id),
      entityId: sanitizeId(command.entityId),
    }));
    return true;
  }

  drain(tick: number): readonly ActionCommand[] {
    const currentTick = Math.max(0, Math.trunc(tick));
    const due = this.#pending
      .filter(command => command.tick <= currentTick)
      .sort(compareCommands);
    this.#pending = this.#pending.filter(command => command.tick > currentTick);
    this.#history.push(...due);
    if (this.#history.length > this.maxHistory) {
      this.#history.splice(0, this.#history.length - this.maxHistory);
    }
    return Object.freeze(due);
  }

  pending(): readonly ActionCommand[] {
    return Object.freeze([...this.#pending].sort(compareCommands));
  }

  history(): readonly ActionCommand[] {
    return Object.freeze([...this.#history]);
  }

  clear(): void {
    this.#pending = [];
    this.#history = [];
  }
}

export function normalizeAxisPair(x: number, y: number, deadzone = 0.08): Vec2 {
  const raw = vec2(
    clamp(finite(x), -1, 1),
    clamp(finite(y), -1, 1),
  );
  const magnitude = Math.hypot(raw.x, raw.y);
  if (magnitude <= deadzone) return vec2();
  const remapped = clamp((magnitude - deadzone) / (1 - deadzone), 0, 1);
  const direction = normalize2(raw);
  return vec2(direction.x * remapped, direction.y * remapped);
}

export function inputToCommands(frame: InputFrame, entityId: string): readonly ActionCommand[] {
  const commands: ActionCommand[] = [];
  if (Math.abs(frame.move.x) > Number.EPSILON || Math.abs(frame.move.y) > Number.EPSILON) {
    commands.push(command(frame, entityId, 'move', { x: frame.move.x, y: frame.move.y }));
  }
  if (Math.abs(frame.look.x) > Number.EPSILON || Math.abs(frame.look.y) > Number.EPSILON) {
    commands.push(command(frame, entityId, 'look', { x: frame.look.x, y: frame.look.y }));
  }
  if (frame.jump) commands.push(command(frame, entityId, 'jump', {}));
  if (frame.sprint) commands.push(command(frame, entityId, 'sprint', {}));
  if (frame.guard) commands.push(command(frame, entityId, 'guard', {}));
  if (frame.attack) commands.push(command(frame, entityId, 'attack', {}));
  if (frame.dodge) commands.push(command(frame, entityId, 'dodge', {}));
  if (frame.interact) commands.push(command(frame, entityId, 'interact', {}));
  return Object.freeze(commands);
}

function command(
  frame: InputFrame,
  entityId: string,
  kind: ActionCommand['kind'],
  payload: Readonly<Record<string, unknown>>,
): ActionCommand {
  return Object.freeze({
    id: entityId + ':' + frame.sequence + ':' + kind,
    entityId: sanitizeId(entityId),
    tick: frame.tick,
    sequence: frame.sequence,
    kind,
    payload: Object.freeze({ ...payload }),
  });
}

function sanitizeId(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 128);
}

function compareCommands(a: ActionCommand, b: ActionCommand): number {
  return a.tick - b.tick || a.sequence - b.sequence || a.id.localeCompare(b.id);
}
