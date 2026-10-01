import type { InputFrame } from './types.ts';
import { clamp, finite, normalize2, vec2 } from './math.ts';

export interface InputModelConfig {
  readonly deadZone: number;
  readonly maxBuffer: number;
  readonly maxLookMagnitude: number;
}

const DEFAULT_CONFIG: InputModelConfig = Object.freeze({
  deadZone: 0.08,
  maxBuffer: 64,
  maxLookMagnitude: 12,
});

export class InputModelR37 {
  readonly config: InputModelConfig;
  #sequence = 0;
  #buffer: InputFrame[] = [];
  #last = this.#neutral(0);

  constructor(config: Partial<InputModelConfig> = {}) {
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...config,
      deadZone: clamp(finite(config.deadZone, DEFAULT_CONFIG.deadZone), 0, 0.5),
      maxBuffer: Math.max(4, Math.trunc(finite(config.maxBuffer, DEFAULT_CONFIG.maxBuffer))),
      maxLookMagnitude: Math.max(1, finite(config.maxLookMagnitude, DEFAULT_CONFIG.maxLookMagnitude)),
    });
  }

  push(raw: Omit<InputFrame, 'sequence'>): InputFrame {
    const frame: InputFrame = Object.freeze({
      ...raw,
      sequence: ++this.#sequence,
      move: this.#sanitizeAxis(raw.move),
      look: this.#sanitizeLook(raw.look),
      tick: Math.max(0, Math.trunc(finite(raw.tick))),
      timestampMs: Math.max(0, finite(raw.timestampMs)),
      jump: Boolean(raw.jump),
      sprint: Boolean(raw.sprint),
      guard: Boolean(raw.guard),
      attack: Boolean(raw.attack),
      dodge: Boolean(raw.dodge),
      interact: Boolean(raw.interact),
    });
    this.#buffer.push(frame);
    if (this.#buffer.length > this.config.maxBuffer) this.#buffer.shift();
    this.#last = frame;
    return frame;
  }

  consumeThrough(tick: number): readonly InputFrame[] {
    const normalized = Math.max(0, Math.trunc(finite(tick)));
    const consumed = this.#buffer.filter((frame) => frame.tick <= normalized);
    this.#buffer = this.#buffer.filter((frame) => frame.tick > normalized);
    return Object.freeze(consumed);
  }

  peek(): InputFrame {
    return this.#last;
  }

  pending(): readonly InputFrame[] {
    return Object.freeze([...this.#buffer]);
  }

  sequence(): number {
    return this.#sequence;
  }

  rewind(sequence: number): void {
    const max = Math.max(0, Math.trunc(finite(sequence)));
    this.#buffer = this.#buffer.filter((frame) => frame.sequence <= max);
    this.#sequence = Math.min(this.#sequence, max);
    this.#last = this.#buffer.at(-1) ?? this.#neutral(0);
  }

  #sanitizeAxis(value: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number } {
    const normalized = normalize2(vec2(value?.x, value?.y));
    const magnitude = Math.hypot(finite(value?.x), finite(value?.y));
    return magnitude <= this.config.deadZone ? vec2() : normalized;
  }

  #sanitizeLook(value: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number } {
    return Object.freeze({
      x: clamp(finite(value?.x), -this.config.maxLookMagnitude, this.config.maxLookMagnitude),
      y: clamp(finite(value?.y), -this.config.maxLookMagnitude, this.config.maxLookMagnitude),
    });
  }

  #neutral(tick: number): InputFrame {
    return Object.freeze({
      tick,
      sequence: 0,
      move: vec2(),
      look: vec2(),
      jump: false,
      sprint: false,
      guard: false,
      attack: false,
      dodge: false,
      interact: false,
      timestampMs: 0,
    });
  }
}

export function mergeInputFrames(frames: readonly InputFrame[]): InputFrame {
  if (frames.length === 0) {
    return Object.freeze({
      tick: 0,
      sequence: 0,
      move: vec2(),
      look: vec2(),
      jump: false,
      sprint: false,
      guard: false,
      attack: false,
      dodge: false,
      interact: false,
      timestampMs: 0,
    });
  }
  let jump = false;
  let sprint = false;
  let guard = false;
  let attack = false;
  let dodge = false;
  let interact = false;
  let lookX = 0;
  let lookY = 0;
  let moveX = 0;
  let moveY = 0;
  for (const frame of frames) {
    moveX += frame.move.x;
    moveY += frame.move.y;
    lookX += frame.look.x;
    lookY += frame.look.y;
    jump ||= frame.jump;
    sprint ||= frame.sprint;
    guard ||= frame.guard;
    attack ||= frame.attack;
    dodge ||= frame.dodge;
    interact ||= frame.interact;
  }
  return Object.freeze({
    tick: frames.at(-1)?.tick ?? 0,
    sequence: frames.at(-1)?.sequence ?? 0,
    move: normalize2(vec2(moveX, moveY)),
    look: vec2(clamp(lookX, -12, 12), clamp(lookY, -12, 12)),
    jump,
    sprint,
    guard,
    attack,
    dodge,
    interact,
    timestampMs: frames.at(-1)?.timestampMs ?? 0,
  });
}
