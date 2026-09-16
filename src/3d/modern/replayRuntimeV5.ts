import { checksumV5, type InputCommandV5, type RuntimeSnapshotV5, type SequenceV5, type TickV5, sequenceV5, tickV5 } from './runtimeContractV5';

export interface ReplayFrameV5 { readonly tick: TickV5; readonly commands: readonly InputCommandV5[]; readonly checksum: string; }
export interface ReplayHeaderV5 { readonly version: 5; readonly runtimeId: string; readonly startedAtTick: TickV5; readonly seed: string; }
export interface ReplayTapeV5 { readonly header: ReplayHeaderV5; readonly frames: readonly ReplayFrameV5[]; readonly finalChecksum: string; }
export interface ReplayOptionsV5 { readonly maxFrames?: number; readonly maxCommandsPerFrame?: number; readonly maxBytes?: number; }

export class ReplayRecorderV5 {
  readonly maxFrames: number; readonly maxCommandsPerFrame: number; readonly maxBytes: number;
  #header: ReplayHeaderV5; #frames: ReplayFrameV5[] = []; #bytes = 0;
  constructor(runtimeId: string, options: ReplayOptionsV5 = {}) { this.maxFrames = Math.max(32, Math.min(1_000_000, Math.floor(options.maxFrames ?? 120_000))); this.maxCommandsPerFrame = Math.max(1, Math.min(512, Math.floor(options.maxCommandsPerFrame ?? 64))); this.maxBytes = Math.max(1024, Math.min(256 * 1024 * 1024, Math.floor(options.maxBytes ?? 32 * 1024 * 1024))); this.#header = Object.freeze({ version: 5, runtimeId: runtimeId.slice(0, 128), startedAtTick: tickV5(0), seed: checksumV5(runtimeId) }); }
  record(tick: TickV5, commands: readonly InputCommandV5[]): boolean { if (this.#frames.length >= this.maxFrames) return false; const frameCommands = Object.freeze(commands.slice(0, this.maxCommandsPerFrame).map((command) => Object.freeze({ ...command }))); const frame: ReplayFrameV5 = Object.freeze({ tick, commands: frameCommands, checksum: checksumV5({ tick, commands: frameCommands }) }); const bytes = new TextEncoder().encode(JSON.stringify(frame)).byteLength; if (this.#bytes + bytes > this.maxBytes) return false; this.#frames.push(frame); this.#bytes += bytes; return true; }
  tape(snapshot: RuntimeSnapshotV5): ReplayTapeV5 { const frames = Object.freeze(this.#frames.slice()); return Object.freeze({ header: this.#header, frames, finalChecksum: checksumV5({ snapshot: snapshot.checksum, frames }) }); }
  frames(): readonly ReplayFrameV5[] { return Object.freeze(this.#frames.slice()); }
  clear(): void { this.#frames.length = 0; this.#bytes = 0; }
}

export class ReplayPlayerV5 {
  #tape: ReplayTapeV5 | null = null; #cursor = 0; #sequence: SequenceV5 = sequenceV5(0);
  load(tape: ReplayTapeV5): boolean { if (tape.header.version !== 5) return false; if (tape.finalChecksum.length < 8) return false; if (tape.frames.some((frame) => checksumV5({ tick: frame.tick, commands: frame.commands }) !== frame.checksum)) return false; this.#tape = tape; this.#cursor = 0; this.#sequence = sequenceV5(0); return true; }
  next(tick: TickV5): readonly InputCommandV5[] { if (!this.#tape) return []; const frame = this.#tape.frames[this.#cursor]; if (!frame || frame.tick > tick) return []; if (frame.tick < tick) { this.#cursor += 1; return this.next(tick); } this.#cursor += 1; return Object.freeze(frame.commands.map((command) => { this.#sequence = sequenceV5(this.#sequence + 1); return Object.freeze({ ...command, sequence: this.#sequence, tick }); })); }
  done(): boolean { return !this.#tape || this.#cursor >= this.#tape.frames.length; }
  reset(): void { this.#cursor = 0; this.#sequence = sequenceV5(0); }
  cursor(): number { return this.#cursor; }
  size(): number { return this.#tape?.frames.length ?? 0; }
}

export function validateReplayV5(tape: ReplayTapeV5): readonly string[] { const errors: string[] = []; for (let i = 1; i < tape.frames.length; i += 1) if (tape.frames[i]!.tick < tape.frames[i - 1]!.tick) errors.push(`tick-order:${i}`); for (const frame of tape.frames) if (checksumV5({ tick: frame.tick, commands: frame.commands }) !== frame.checksum) errors.push(`checksum:${frame.tick}`); return Object.freeze(errors); }
