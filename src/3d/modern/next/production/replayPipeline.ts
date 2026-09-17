import { checksumP, integerP, type InputSampleP, type WorldSnapshotP } from './contracts.ts';

export interface ReplayFrameP {
  readonly tick: number;
  readonly input: InputSampleP;
  readonly checksum?: number;
}

export interface ReplayCheckpointP {
  readonly tick: number;
  readonly revision: number;
  readonly snapshot: WorldSnapshotP;
  readonly digest: number;
}

export interface ReplayLogP {
  readonly format: 'aapw-production-replay';
  readonly version: 2;
  readonly seed: number;
  readonly startedTick: number;
  readonly endedTick: number;
  readonly frames: readonly ReplayFrameP[];
  readonly checkpoints: readonly ReplayCheckpointP[];
  readonly checksum: number;
}

export interface ReplayVerificationP {
  readonly ok: boolean;
  readonly framesChecked: number;
  readonly checkpointsChecked: number;
  readonly firstMismatchTick?: number;
  readonly expectedChecksum?: number;
  readonly actualChecksum?: number;
  readonly digest: number;
}

export interface ReplayPipelineConfigP {
  readonly maxFrames: number;
  readonly maxCheckpoints: number;
  readonly checkpointInterval: number;
}

const DEFAULTS: ReplayPipelineConfigP = Object.freeze({ maxFrames: 60_000, maxCheckpoints: 256, checkpointInterval: 120 });

export class ProductionReplayPipeline {
  readonly config: ReplayPipelineConfigP;
  readonly #frames: ReplayFrameP[] = [];
  readonly #checkpoints: ReplayCheckpointP[] = [];
  #seed = 0;
  #startedTick = 0;
  #lastTick = 0;
  #recording = false;

  constructor(config: Partial<ReplayPipelineConfigP> = {}) {
    this.config = Object.freeze({ maxFrames: Math.max(64, integerP(config.maxFrames ?? DEFAULTS.maxFrames)), maxCheckpoints: Math.max(4, integerP(config.maxCheckpoints ?? DEFAULTS.maxCheckpoints)), checkpointInterval: Math.max(1, integerP(config.checkpointInterval ?? DEFAULTS.checkpointInterval)) });
  }

  start(seed: number, tick = 0): void { this.#frames.length = 0; this.#checkpoints.length = 0; this.#seed = integerP(seed); this.#startedTick = Math.max(0, integerP(tick)); this.#lastTick = this.#startedTick; this.#recording = true; }
  stop(): void { this.#recording = false; }
  get recording(): boolean { return this.#recording; }
  get frameCount(): number { return this.#frames.length; }

  recordInput(input: InputSampleP, checksum?: number): boolean {
    if (!this.#recording) return false;
    const frame: ReplayFrameP = Object.freeze({ tick: Math.max(0, integerP(input.tick)), input: Object.freeze({ ...input }), ...(checksum === undefined ? {} : { checksum: checksum >>> 0 }) });
    if (this.#frames.length >= this.config.maxFrames) { this.#recording = false; return false; }
    this.#frames.push(frame); this.#lastTick = frame.tick; return true;
  }

  recordCheckpoint(snapshot: WorldSnapshotP): boolean {
    if (!this.#recording) return false;
    validateSnapshot(snapshot);
    const checkpoint: ReplayCheckpointP = Object.freeze({ tick: snapshot.tick, revision: snapshot.revision, snapshot: cloneSnapshot(snapshot), digest: checksumP({ tick: snapshot.tick, revision: snapshot.revision, checksum: snapshot.checksum }) });
    if (this.#checkpoints.length >= this.config.maxCheckpoints) this.#checkpoints.shift();
    this.#checkpoints.push(checkpoint);
    return true;
  }

  shouldCheckpoint(tick: number): boolean { return Math.max(0, integerP(tick)) % this.config.checkpointInterval === 0; }
  latestCheckpoint(): ReplayCheckpointP | undefined { return this.#checkpoints.at(-1); }
  checkpointAtOrBefore(tick: number): ReplayCheckpointP | undefined { const target = integerP(tick); for (let index = this.#checkpoints.length - 1; index >= 0; index -= 1) if (this.#checkpoints[index]!.tick <= target) return this.#checkpoints[index]; return undefined; }

  log(): ReplayLogP {
    const frames = Object.freeze([...this.#frames]); const checkpoints = Object.freeze([...this.#checkpoints]);
    return Object.freeze({ format: 'aapw-production-replay', version: 2, seed: this.#seed, startedTick: this.#startedTick, endedTick: this.#lastTick, frames, checkpoints, checksum: checksumP({ format: 'aapw-production-replay', version: 2, seed: this.#seed, startedTick: this.#startedTick, endedTick: this.#lastTick, frames, checkpoints }) });
  }

  verify(log: ReplayLogP, frameChecksum: (frame: ReplayFrameP, checkpoint: ReplayCheckpointP | undefined) => number): ReplayVerificationP {
    try { validateLog(log); } catch (error) { return Object.freeze({ ok: false, framesChecked: 0, checkpointsChecked: 0, expectedChecksum: 0, actualChecksum: checksumP(String(error)), digest: checksumP(String(error)) }); }
    let framesChecked = 0; let checkpointsChecked = 0; let firstMismatchTick: number | undefined; let expectedChecksum: number | undefined; let actualChecksum: number | undefined;
    const checkpoints = [...log.checkpoints].sort((a, b) => a.tick - b.tick);
    for (const frame of log.frames) {
      const checkpoint = latestCheckpointBefore(checkpoints, frame.tick);
      const actual = frameChecksum(frame, checkpoint) >>> 0;
      framesChecked += 1;
      if (frame.checksum !== undefined && actual !== (frame.checksum >>> 0) && firstMismatchTick === undefined) { firstMismatchTick = frame.tick; expectedChecksum = frame.checksum >>> 0; actualChecksum = actual; break; }
    }
    if (firstMismatchTick === undefined) for (const checkpoint of checkpoints) { checkpointsChecked += 1; if (checksumP(checkpoint.snapshot.actors) !== checkpoint.snapshot.checksum) { firstMismatchTick = checkpoint.tick; expectedChecksum = checkpoint.snapshot.checksum; actualChecksum = checksumP(checkpoint.snapshot.actors); break; } }
    const ok = firstMismatchTick === undefined && checksumP({ format: log.format, version: log.version, seed: log.seed, startedTick: log.startedTick, endedTick: log.endedTick, frames: log.frames, checkpoints: log.checkpoints }) === log.checksum;
    return Object.freeze({ ok, framesChecked, checkpointsChecked, ...(firstMismatchTick === undefined ? {} : { firstMismatchTick, expectedChecksum, actualChecksum }), digest: checksumP({ ok, framesChecked, checkpointsChecked, firstMismatchTick, expectedChecksum, actualChecksum }) });
  }

  seek(tick: number): ReplayCheckpointP | undefined { return this.checkpointAtOrBefore(tick); }
  clear(): void { this.#frames.length = 0; this.#checkpoints.length = 0; this.#recording = false; }
}

function latestCheckpointBefore(checkpoints: readonly ReplayCheckpointP[], tick: number): ReplayCheckpointP | undefined { let selected: ReplayCheckpointP | undefined; for (const checkpoint of checkpoints) { if (checkpoint.tick > tick) break; selected = checkpoint; } return selected; }
function cloneSnapshot(snapshot: WorldSnapshotP): WorldSnapshotP { return Object.freeze({ tick: snapshot.tick, revision: snapshot.revision, actors: Object.freeze(snapshot.actors.map(actor => Object.freeze({ ...actor }))), checksum: snapshot.checksum }); }
function validateSnapshot(snapshot: WorldSnapshotP): void { if (!Number.isInteger(snapshot.tick) || snapshot.tick < 0) throw new Error('invalid replay snapshot tick'); if (checksumP(snapshot.actors) !== snapshot.checksum) throw new Error('invalid replay snapshot checksum'); }
function validateLog(log: ReplayLogP): void { if (log.format !== 'aapw-production-replay' || log.version !== 2) throw new Error('unsupported replay format'); if (log.endedTick < log.startedTick) throw new Error('invalid replay tick range'); if (checksumP({ format: log.format, version: log.version, seed: log.seed, startedTick: log.startedTick, endedTick: log.endedTick, frames: log.frames, checkpoints: log.checkpoints }) !== log.checksum) throw new Error('replay checksum mismatch'); let previous = log.startedTick - 1; for (const frame of log.frames) { if (frame.tick < previous) throw new Error('replay frames out of order'); previous = frame.tick; } }
