import type { Disposable, FrameCommand, FrameEnvelope, Sequence, TickId } from './types.js';
import { SEQUENCE } from './types.js';
import { RingBuffer } from './collections.js';
import { hashString, toHex32 } from './deterministic.js';

export interface ReplayFrame { readonly frame: number; readonly tick: number; readonly delta: number; readonly commandIds: readonly number[]; readonly checksum: string; }
export interface ReplayHeader { readonly schema: string; readonly version: number; readonly seed: number; readonly createdAt: number; readonly metadata: Readonly<Record<string, string>>; }
export interface ReplaySnapshot { readonly header: ReplayHeader; readonly frames: readonly ReplayFrame[]; readonly checksum: string; }
export interface ReplayValidation { readonly ok: boolean; readonly frames: number; readonly mismatches: number; readonly expectedChecksum: string; readonly actualChecksum: string; readonly firstMismatch?: number; }

export class ReplayRecorder implements Disposable {
  private readonly frames: RingBuffer<ReplayFrame>;
  private readonly header: ReplayHeader;
  private readonly maxFrames: number;
  private _disposed = false;
  private sequence = 1 as Sequence;
  private lastTick = -1;

  public constructor(options: { seed?: number; metadata?: Readonly<Record<string, string>>; maxFrames?: number; version?: number } = {}) {
    this.maxFrames = Math.max(16, Math.trunc(options.maxFrames ?? 12000));
    this.frames = new RingBuffer(this.maxFrames);
    this.header = Object.freeze({ schema: 'aapw.engine.replay', version: Math.max(1, Math.trunc(options.version ?? 1)), seed: Math.trunc(options.seed ?? 0) >>> 0, createdAt: 0, metadata: Object.freeze({ ...(options.metadata ?? {}) }) });
  }

  public get disposed(): boolean { return this._disposed; }
  public get size(): number { return this.frames.size; }
  public record(frame: FrameEnvelope): boolean {
    if (this._disposed || Number(frame.tick) < this.lastTick) return false;
    this.lastTick = Number(frame.tick);
    this.frames.push(Object.freeze({ frame: Number(frame.frame), tick: Number(frame.tick), delta: frame.deltaSeconds, commandIds: Object.freeze(frame.commands.map(command => Number(command.id))), checksum: frame.checksum }));
    this.sequence = SEQUENCE((Number(this.sequence) + 1) >>> 0);
    return true;
  }
  public snapshot(): ReplaySnapshot {
    const frames = this.frames.toArray();
    return Object.freeze({ header: this.header, frames: Object.freeze(frames), checksum: this.computeChecksum(frames) });
  }
  public clear(): void { this.frames.clear(); this.lastTick = -1; this.sequence = SEQUENCE(1); }
  public dispose(): void { if (this._disposed) return; this.frames.dispose(); this._disposed = true; }
  private computeChecksum(frames: readonly ReplayFrame[]): string {
    const payload = JSON.stringify(frames.map(frame => [frame.frame, frame.tick, frame.delta, frame.commandIds, frame.checksum]));
    return toHex32(hashString(`${this.header.schema}:${this.header.version}:${this.header.seed}:${payload}`));
  }
}

export const validateReplay = (expected: ReplaySnapshot, actual: ReplaySnapshot): ReplayValidation => {
  let mismatches = 0;
  let firstMismatch: number | undefined;
  const length = Math.max(expected.frames.length, actual.frames.length);
  for (let i = 0; i < length; i += 1) {
    const left = expected.frames[i];
    const right = actual.frames[i];
    const same = Boolean(left && right && left.frame === right.frame && left.tick === right.tick && Math.abs(left.delta - right.delta) <= 1e-9 && arraysEqual(left.commandIds, right.commandIds) && left.checksum === right.checksum);
    if (!same) { mismatches += 1; firstMismatch ??= i; }
  }
  const expectedChecksum = expected.checksum;
  const actualChecksum = actual.checksum;
  return Object.freeze({ ok: mismatches === 0 && expectedChecksum === actualChecksum, frames: length, mismatches, expectedChecksum, actualChecksum, ...(firstMismatch === undefined ? {} : { firstMismatch }) });
};

export class ReplayPlayer {
  private readonly snapshotData: ReplaySnapshot;
  private cursor = 0;
  private _disposed = false;
  public constructor(snapshot: ReplaySnapshot) { this.snapshotData = structuredClone(snapshot); }
  public get disposed(): boolean { return this._disposed; }
  public get done(): boolean { return this.cursor >= this.snapshotData.frames.length; }
  public get index(): number { return this.cursor; }
  public peek(): ReplayFrame | undefined { return this.snapshotData.frames[this.cursor]; }
  public next(): ReplayFrame | undefined { if (this.done || this._disposed) return undefined; return this.snapshotData.frames[this.cursor++]; }
  public seek(index: number): boolean { const next = Math.max(0, Math.min(this.snapshotData.frames.length, Math.trunc(index))); this.cursor = next; return next === index; }
  public reset(): void { this.cursor = 0; }
  public dispose(): void { this._disposed = true; }
}

export const replayFromCommands = (commands: readonly FrameCommand[], seed = 0): ReplaySnapshot => {
  const recorder = new ReplayRecorder({ seed, maxFrames: Math.max(32, commands.length + 8) });
  for (let i = 0; i < commands.length; i += 1) {
    const command = commands[i]!;
    recorder.record(Object.freeze({ frame: i, tick: Number(command.issuedAtTick), deltaSeconds: 1 / 60, commands: [command], events: [], checksum: toHex32(hashString(`${seed}:${Number(command.id)}:${Number(command.issuedAtTick)}`)) }));
  }
  const snapshot = recorder.snapshot();
  recorder.dispose();
  return snapshot;
};

export const collectTicks = (frames: readonly ReplayFrame[]): readonly TickId[] => Object.freeze([...new Set(frames.map(frame => Math.trunc(frame.tick) as TickId))]);
const arraysEqual = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((value, index) => value === b[index]);
