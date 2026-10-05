import { normalizeVec2, type InputIntent, type RawInputSnapshot } from './contracts.ts';

export interface InputBinding {
  readonly action: string;
  readonly axis?: string;
  readonly direction?: number;
  readonly button?: string;
}

export interface InputFrame {
  readonly frame: number;
  readonly intent: InputIntent;
}

export class InputBuffer {
  #previousButtons = new Map<string, boolean>();
  #previousAxes = new Map<string, number>();

  sample(frame: number, snapshot: RawInputSnapshot, bindings: readonly InputBinding[]): InputFrame {
    const actions = new Set<string>();
    const pressed = new Set<string>();
    const released = new Set<string>();
    const axes = snapshot.axes ?? {};
    const buttons = snapshot.buttons ?? {};
    let moveX = 0;
    let moveY = 0;
    let lookX = 0;
    let lookY = 0;

    for (const binding of bindings) {
      if (binding.button) {
        const current = Boolean(buttons[binding.button]);
        const previous = this.#previousButtons.get(binding.button) ?? false;
        if (current) actions.add(binding.action);
        if (current && !previous) pressed.add(binding.action);
        if (!current && previous) released.add(binding.action);
        this.#previousButtons.set(binding.button, current);
      }
      if (binding.axis) {
        const raw = Number.isFinite(axes[binding.axis]) ? Number(axes[binding.axis]) : 0;
        const value = raw * (binding.direction ?? 1);
        if (binding.action === 'move-x') moveX += value;
        else if (binding.action === 'move-y') moveY += value;
        else if (binding.action === 'look-x') lookX += value;
        else if (binding.action === 'look-y') lookY += value;
        this.#previousAxes.set(binding.axis, raw);
      }
    }

    const move = normalizeVec2(moveX, moveY);
    const look = normalizeVec2(lookX, lookY);
    return Object.freeze({
      frame,
      intent: Object.freeze({
        moveX: move.x,
        moveY: move.y,
        lookX: look.x,
        lookY: look.y,
        actions,
        pressed,
        released,
      }),
    });
  }

  reset(): void {
    this.#previousButtons.clear();
    this.#previousAxes.clear();
  }
}

export class InputHistory {
  #frames: InputFrame[] = [];
  readonly capacity: number;

  constructor(capacity = 240) {
    this.capacity = Math.max(8, Math.trunc(capacity));
  }

  push(frame: InputFrame): void {
    this.#frames.push(frame);
    while (this.#frames.length > this.capacity) this.#frames.shift();
  }

  since(frameNumber: number): readonly InputFrame[] {
    return Object.freeze(this.#frames.filter((frame) => frame.frame >= frameNumber));
  }

  latest(): InputFrame | undefined {
    return this.#frames[this.#frames.length - 1];
  }

  get(frameNumber: number): InputFrame | undefined {
    return this.#frames.find((frame) => frame.frame === frameNumber);
  }

  size(): number {
    return this.#frames.length;
  }

  clear(): void {
    this.#frames = [];
  }
}

export interface InputSequence {
  readonly name: string;
  readonly actions: readonly string[];
  readonly maxGapFrames: number;
}

export class SequenceDetector {
  #progress = new Map<string, { index: number; lastFrame: number }>();

  constructor(readonly sequences: readonly InputSequence[]) {}

  feed(frame: number, action: string): readonly string[] {
    const matched: string[] = [];
    for (const sequence of this.sequences) {
      const state = this.#progress.get(sequence.name) ?? { index: 0, lastFrame: frame };
      const stale = frame - state.lastFrame > sequence.maxGapFrames;
      const expected = sequence.actions[state.index];
      const nextIndex = stale || expected !== action
        ? (sequence.actions[0] === action ? 1 : 0)
        : state.index + 1;
      const completed = nextIndex >= sequence.actions.length;
      this.#progress.set(sequence.name, {
        index: completed ? 0 : nextIndex,
        lastFrame: frame,
      });
      if (completed) matched.push(sequence.name);
    }
    return Object.freeze(matched.sort());
  }

  reset(): void {
    this.#progress.clear();
  }
}
