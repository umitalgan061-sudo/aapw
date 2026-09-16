import { deterministicChecksum } from './determinism.ts';
import type { InputCommand } from './input.ts';

export interface ReplayFrame { readonly tick: number; readonly command: InputCommand; readonly checksum?: string; }
export interface ReplayLog { readonly version: 1; readonly seed: number; readonly frames: readonly ReplayFrame[]; readonly checksum: string; }

export class ReplayRecorder {
  readonly seed: number;
  readonly maxFrames: number;
  #frames: ReplayFrame[] = [];
  #lastTick = -1;

  constructor(seed: number, maxFrames = 18_000) { this.seed = seed >>> 0; this.maxFrames = Math.max(60, Math.floor(maxFrames)); }
  append(command: InputCommand, checksum?: string): boolean {
    if (command.tick < this.#lastTick) return false;
    if (command.tick === this.#lastTick && this.#frames.at(-1)?.command.sequence === command.sequence) return false;
    if (this.#frames.length >= this.maxFrames) this.#frames.shift();
    this.#frames.push({ tick: command.tick, command, checksum });
    this.#lastTick = command.tick;
    return true;
  }
  frames(): readonly ReplayFrame[] { return this.#frames; }
  build(): ReplayLog {
    const checksum = deterministicChecksum([this.seed, ...this.#frames.flatMap((frame) => [frame.tick, frame.command.sequence, frame.command.moveX, frame.command.moveZ, frame.command.lookX, frame.command.lookY, frame.command.buttons, frame.checksum ?? ''])]);
    return { version: 1, seed: this.seed, frames: [...this.#frames], checksum };
  }
  clear(): void { this.#frames.length = 0; this.#lastTick = -1; }
}

export interface ReplayVerificationResult { readonly ok: boolean; readonly checkedFrames: number; readonly firstMismatchTick?: number; readonly reason?: string; }

export function verifyReplay(log: ReplayLog, expectedSeed: number, checksumForFrame: (frame: ReplayFrame) => string): ReplayVerificationResult {
  if (log.version !== 1) return { ok: false, checkedFrames: 0, reason: 'unsupported replay version' };
  if ((expectedSeed >>> 0) !== log.seed) return { ok: false, checkedFrames: 0, reason: 'seed mismatch' };
  let previousTick = -1;
  for (const frame of log.frames) {
    if (frame.tick < previousTick) return { ok: false, checkedFrames: 0, reason: 'frames are not monotonic' };
    const actual = checksumForFrame(frame);
    if (frame.checksum !== undefined && frame.checksum !== actual) return { ok: false, checkedFrames: log.frames.indexOf(frame), firstMismatchTick: frame.tick, reason: 'frame checksum mismatch' };
    previousTick = frame.tick;
  }
  return { ok: true, checkedFrames: log.frames.length };
}
