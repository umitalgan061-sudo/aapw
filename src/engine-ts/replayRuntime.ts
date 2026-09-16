import type { Disposable, EntityId } from './coreTypes.js';
import { stableSort } from './coreTypes.js';
import type { GameplayCommand } from './gameplayRuntime.js';

export interface ReplayFrame { readonly tick: number; readonly deltaSeconds: number; readonly commands: readonly GameplayCommand[]; readonly checksum: string; }
export interface ReplayCheckpoint<T> { readonly tick: number; readonly state: T; readonly checksum: string; }
export interface ReplayLog { readonly version: number; readonly frames: readonly ReplayFrame[]; readonly checkpoints: readonly ReplayCheckpoint<unknown>[]; }
export interface ReplayStats { readonly frames: number; readonly commands: number; readonly checkpoints: number; readonly bytes: number; readonly diverged: number; }

function stableSerialize(value: unknown): string { return JSON.stringify(value, Object.keys(value as object).sort()); }
function checksum(value: unknown): string {
  const text = stableSerialize(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export class ReplayRuntime<TState> implements Disposable {
  #frames: ReplayFrame[] = [];
  #checkpoints: ReplayCheckpoint<TState>[] = [];
  #maxFrames: number;
  #maxCheckpoints: number;
  #diverged = 0;
  #disposed = false;

  constructor(maxFrames = 20000, maxCheckpoints = 256) { this.#maxFrames = Math.max(128, Math.trunc(maxFrames)); this.#maxCheckpoints = Math.max(8, Math.trunc(maxCheckpoints)); }

  record(tick: number, deltaSeconds: number, commands: readonly GameplayCommand[], state: TState): ReplayFrame | null {
    if (this.#disposed) return null;
    const frame: ReplayFrame = Object.freeze({ tick: Math.max(0, Math.trunc(tick)), deltaSeconds: Math.max(0, deltaSeconds), commands: Object.freeze(stableSort(commands, (a, b) => String(a.actor).localeCompare(String(b.actor)) || a.type.localeCompare(b.type))), checksum: checksum({ tick, deltaSeconds, commands }) });
    this.#frames.push(frame);
    if (this.#frames.length > this.#maxFrames) this.#frames.splice(0, this.#frames.length - this.#maxFrames);
    if (this.#checkpoints.length === 0 || tick - this.#checkpoints[this.#checkpoints.length - 1]!.tick >= 120) this.checkpoint(tick, state);
    return frame;
  }

  checkpoint(tick: number, state: TState): ReplayCheckpoint<TState> {
    const checkpoint: ReplayCheckpoint<TState> = Object.freeze({ tick: Math.max(0, Math.trunc(tick)), state, checksum: checksum(state) });
    this.#checkpoints.push(checkpoint);
    if (this.#checkpoints.length > this.#maxCheckpoints) this.#checkpoints.splice(0, this.#checkpoints.length - this.#maxCheckpoints);
    return checkpoint;
  }

  verify(frame: ReplayFrame): boolean {
    const expected = checksum({ tick: frame.tick, deltaSeconds: frame.deltaSeconds, commands: frame.commands });
    const valid = expected === frame.checksum;
    if (!valid) this.#diverged += 1;
    return valid;
  }

  nearestCheckpoint(tick: number): ReplayCheckpoint<TState> | null {
    let best: ReplayCheckpoint<TState> | null = null;
    for (const checkpoint of this.#checkpoints) { if (checkpoint.tick <= tick && (!best || checkpoint.tick > best.tick)) best = checkpoint; }
    return best;
  }

  frames(fromTick = 0, toTick = Number.MAX_SAFE_INTEGER): readonly ReplayFrame[] {
    return Object.freeze(this.#frames.filter(frame => frame.tick >= fromTick && frame.tick <= toTick));
  }

  export(): ReplayLog {
    return Object.freeze({ version: 1, frames: Object.freeze(this.#frames.slice()), checkpoints: Object.freeze(this.#checkpoints.slice()) });
  }

  import(log: ReplayLog): boolean {
    if (this.#disposed || log.version !== 1 || log.frames.length > this.#maxFrames || log.checkpoints.length > this.#maxCheckpoints) return false;
    if (!log.frames.every(frame => this.verify(frame))) return false;
    this.#frames = [...log.frames];
    this.#checkpoints = [...log.checkpoints] as ReplayCheckpoint<TState>[];
    return true;
  }

  trimBefore(tick: number): void { this.#frames = this.#frames.filter(frame => frame.tick >= tick); this.#checkpoints = this.#checkpoints.filter(checkpoint => checkpoint.tick >= tick); }
  clear(): void { this.#frames.length = 0; this.#checkpoints.length = 0; this.#diverged = 0; }
  stats(): ReplayStats { const commands = this.#frames.reduce((sum, frame) => sum + frame.commands.length, 0); return Object.freeze({ frames: this.#frames.length, commands, checkpoints: this.#checkpoints.length, bytes: stableSerialize(this.export()).length, diverged: this.#diverged }); }
  dispose(): void { this.#disposed = true; this.clear(); }
}

export const replayActor = (id: string): EntityId => id as EntityId;
