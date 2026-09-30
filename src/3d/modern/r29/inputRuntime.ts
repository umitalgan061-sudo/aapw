import { clampR29, type R29InputIntent } from './contracts.ts';

export interface R29RawInput {
  readonly tick: number;
  readonly sequence: number;
  readonly moveX: number;
  readonly moveY: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly jump?: boolean;
  readonly sprint?: boolean;
  readonly primary?: boolean;
  readonly secondary?: boolean;
  readonly interact?: boolean;
  readonly pause?: boolean;
}

export interface R29InputRuntimeOptions {
  readonly maxQueued?: number;
  readonly maxLookDelta?: number;
}

export interface R29InputValidation {
  readonly accepted: boolean;
  readonly reason: string;
  readonly intent?: R29InputIntent;
}

export class R29InputRuntime {
  readonly maxQueued: number;
  readonly maxLookDelta: number;
  #queue: R29InputIntent[] = [];
  #lastSequence = 0;
  #pressed = new Set<number>();

  constructor(options: R29InputRuntimeOptions = {}) {
    this.maxQueued = Math.max(8, Math.floor(options.maxQueued ?? 256));
    this.maxLookDelta = Math.max(1, options.maxLookDelta ?? 90);
  }

  enqueue(raw: R29RawInput): R29InputValidation {
    if (!Number.isFinite(raw.tick) || raw.tick < 0) return { accepted: false, reason: 'tick' };
    if (!Number.isFinite(raw.sequence) || raw.sequence <= this.#lastSequence) return { accepted: false, reason: 'sequence' };
    if (this.#queue.length >= this.maxQueued) return { accepted: false, reason: 'queue-full' };

    const intent: R29InputIntent = Object.freeze({
      tick: Math.floor(raw.tick),
      sequence: Math.floor(raw.sequence),
      moveX: clampR29(raw.moveX, -1, 1),
      moveY: clampR29(raw.moveY, -1, 1),
      lookX: clampR29(raw.lookX, -this.maxLookDelta, this.maxLookDelta),
      lookY: clampR29(raw.lookY, -this.maxLookDelta, this.maxLookDelta),
      jump: Boolean(raw.jump),
      sprint: Boolean(raw.sprint),
      primary: Boolean(raw.primary),
      secondary: Boolean(raw.secondary),
      interact: Boolean(raw.interact),
      pause: Boolean(raw.pause),
    });
    this.#lastSequence = intent.sequence;
    this.#queue.push(intent);
    if (intent.jump) this.#pressed.add(intent.sequence);
    return { accepted: true, reason: 'accepted', intent };
  }

  drain(max = this.maxQueued): readonly R29InputIntent[] {
    const count = Math.max(0, Math.floor(max));
    const values = this.#queue.splice(0, count);
    values.sort((a, b) => a.tick - b.tick || a.sequence - b.sequence);
    return Object.freeze(values);
  }

  sampleForTick(tick: number): R29InputIntent | null {
    let selected: R29InputIntent | null = null;
    for (const input of this.#queue) {
      if (input.tick > tick) continue;
      if (!selected || input.sequence > selected.sequence) selected = input;
    }
    return selected;
  }

  consumePressed(sequence: number): boolean {
    if (!this.#pressed.has(sequence)) return false;
    this.#pressed.delete(sequence);
    return true;
  }

  pending(): number {
    return this.#queue.length;
  }

  latestSequence(): number {
    return this.#lastSequence;
  }

  reset(): void {
    this.#queue.length = 0;
    this.#pressed.clear();
    this.#lastSequence = 0;
  }
}

export function normalizeR29Input(raw: R29RawInput): R29InputIntent {
  return Object.freeze({
    tick: Math.max(0, Math.floor(raw.tick)),
    sequence: Math.max(0, Math.floor(raw.sequence)),
    moveX: clampR29(raw.moveX, -1, 1),
    moveY: clampR29(raw.moveY, -1, 1),
    lookX: clampR29(raw.lookX, -90, 90),
    lookY: clampR29(raw.lookY, -90, 90),
    jump: Boolean(raw.jump),
    sprint: Boolean(raw.sprint),
    primary: Boolean(raw.primary),
    secondary: Boolean(raw.secondary),
    interact: Boolean(raw.interact),
    pause: Boolean(raw.pause),
  });
}
