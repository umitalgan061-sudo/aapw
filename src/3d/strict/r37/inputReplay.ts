import type { InputFrame } from './types.ts';
import { stableJson } from './math.ts';

export interface ReplaySegment {
  readonly startTick: number;
  readonly endTick: number;
  readonly inputs: readonly InputFrame[];
  readonly digest: string;
}

export class InputReplayR37 {
  #frames: InputFrame[] = [];
  readonly capacity: number;

  constructor(capacity = 1024) {
    this.capacity = Math.max(32, Math.trunc(capacity));
  }

  append(frame: InputFrame): void {
    this.#frames.push(Object.freeze(frame));
    if (this.#frames.length > this.capacity) this.#frames.shift();
  }

  appendMany(frames: readonly InputFrame[]): void {
    for (const frame of frames) this.append(frame);
  }

  segment(startTick: number, endTick: number): ReplaySegment {
    const start = Math.min(startTick, endTick);
    const end = Math.max(startTick, endTick);
    const inputs = this.#frames.filter((frame) => frame.tick >= start && frame.tick <= end);
    return Object.freeze({
      startTick: start,
      endTick: end,
      inputs: Object.freeze([...inputs]),
      digest: stableJson(inputs),
    });
  }

  frames(): readonly InputFrame[] { return Object.freeze([...this.#frames]); }

  verifyDeterminism(segment: ReplaySegment): boolean {
    return stableJson(segment.inputs) === segment.digest;
  }

  trimBefore(tick: number): void {
    this.#frames = this.#frames.filter((frame) => frame.tick >= tick);
  }

  clear(): void {
    this.#frames = [];
  }

  size(): number { return this.#frames.length; }
}
