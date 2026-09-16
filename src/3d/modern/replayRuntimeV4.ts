import {
  type CommandEnvelopeV4,
  type InputSampleV4,
  type TickId,
  type TraceId,
  type RuntimeSnapshotV4,
  type OutcomeV4,
  okV4,
  failV4,
  createRuntimeErrorV4,
  tickId,
} from './runtimeContractsV4';

export interface ReplayEventV4 {
  readonly tick: TickId;
  readonly sequence: number;
  readonly kind: 'input' | 'command' | 'snapshot' | 'marker';
  readonly payload: unknown;
  readonly trace: TraceId;
}

export interface ReplayHeaderV4 {
  readonly version: 4;
  readonly buildId: string;
  readonly runtime: string;
  readonly startedAt: number;
  readonly fixedStepMs: number;
  readonly seedDigest: string;
}

export interface ReplayTapeV4 {
  readonly header: ReplayHeaderV4;
  readonly events: readonly ReplayEventV4[];
  readonly checksum: string;
}

export interface ReplayCursorV4 {
  readonly index: number;
  readonly tick: TickId;
  readonly remaining: number;
}

export interface ReplayMetricsV4 {
  readonly events: number;
  readonly inputs: number;
  readonly commands: number;
  readonly snapshots: number;
  readonly markers: number;
  readonly rewinds: number;
  readonly dropped: number;
}

export interface ReplayOptionsV4 {
  readonly maxEvents?: number;
  readonly maxPayloadBytes?: number;
  readonly now?: () => number;
}

const digest = (value: unknown): string => {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const payloadBytes = (payload: unknown): number => new TextEncoder().encode(JSON.stringify(payload)).byteLength;

export class ReplayRuntimeV4 {
  readonly maxEvents: number;
  readonly maxPayloadBytes: number;
  #now: () => number;
  #header: ReplayHeaderV4 | null = null;
  #events: ReplayEventV4[] = [];
  #sequence = 0;
  #cursor = 0;
  #rewinds = 0;
  #dropped = 0;

  constructor(options: ReplayOptionsV4 = {}) {
    this.maxEvents = Math.max(128, Math.trunc(options.maxEvents ?? 100_000));
    this.maxPayloadBytes = Math.max(256, Math.trunc(options.maxPayloadBytes ?? 64 * 1024));
    this.#now = options.now ?? (() => performance.now());
  }

  start(buildId: string, runtime: string, fixedStepMs: number, seed: unknown): void {
    if (!buildId.trim() || !runtime.trim()) throw new Error('Replay header requires buildId and runtime');
    this.#header = Object.freeze({ version: 4, buildId, runtime, startedAt: this.#now(), fixedStepMs: Math.max(1, fixedStepMs), seedDigest: digest(seed) });
    this.#events.length = 0;
    this.#cursor = 0;
    this.#sequence = 0;
    this.#rewinds = 0;
    this.#dropped = 0;
  }

  isRecording(): boolean {
    return this.#header !== null;
  }

  recordInput(sample: InputSampleV4, trace: TraceId): OutcomeV4<ReplayEventV4> {
    return this.#record('input', sample, trace, tickId(sample.sequence));
  }

  recordCommand(command: CommandEnvelopeV4, trace = command.trace): OutcomeV4<ReplayEventV4> {
    return this.#record('command', command.payload, trace, command.tick);
  }

  recordSnapshot(snapshot: RuntimeSnapshotV4, trace: TraceId): OutcomeV4<ReplayEventV4> {
    return this.#record('snapshot', snapshot, trace, snapshot.header.tick);
  }

  marker(name: string, tick: TickId, trace: TraceId, payload: unknown = null): OutcomeV4<ReplayEventV4> {
    return this.#record('marker', { name: name.slice(0, 128), payload }, trace, tick);
  }

  rewindToTick(targetTick: TickId): number {
    const target = Number(targetTick);
    const index = this.#events.findIndex((event) => Number(event.tick) >= target);
    this.#cursor = index < 0 ? this.#events.length : index;
    this.#rewinds += 1;
    return this.#cursor;
  }

  seek(index: number): ReplayCursorV4 {
    this.#cursor = Math.max(0, Math.min(this.#events.length, Math.trunc(index)));
    return this.cursor();
  }

  next(): ReplayEventV4 | null {
    if (this.#cursor >= this.#events.length) return null;
    return this.#events[this.#cursor++]!;
  }

  peek(): ReplayEventV4 | null {
    return this.#events[this.#cursor] ?? null;
  }

  cursor(): ReplayCursorV4 {
    const event = this.#events[this.#cursor];
    return Object.freeze({ index: this.#cursor, tick: event?.tick ?? tickId(this.#events.at(-1)?.tick ?? 0), remaining: this.#events.length - this.#cursor });
  }

  tape(): OutcomeV4<ReplayTapeV4> {
    if (!this.#header) return failV4(createRuntimeErrorV4('REPLAY_NOT_STARTED', 'Replay recording has not started', false));
    const events = Object.freeze(this.#events.slice());
    const checksum = digest({ header: this.#header, events });
    return okV4(Object.freeze({ header: this.#header, events, checksum }));
  }

  importTape(tape: ReplayTapeV4): OutcomeV4<number> {
    const expected = digest({ header: tape.header, events: tape.events });
    if (expected !== tape.checksum) return failV4(createRuntimeErrorV4('REPLAY_CHECKSUM', 'Replay checksum mismatch', false));
    if (tape.header.version !== 4) return failV4(createRuntimeErrorV4('REPLAY_VERSION', 'Unsupported replay version', false));
    if (tape.events.length > this.maxEvents) return failV4(createRuntimeErrorV4('REPLAY_TOO_LARGE', 'Replay event count exceeds limit', false));
    for (const event of tape.events) {
      if (payloadBytes(event.payload) > this.maxPayloadBytes) return failV4(createRuntimeErrorV4('REPLAY_PAYLOAD_LIMIT', 'Replay payload exceeds limit', false));
    }
    this.#header = Object.freeze({ ...tape.header });
    this.#events = [...tape.events];
    this.#cursor = 0;
    this.#sequence = this.#events.reduce((max, event) => Math.max(max, event.sequence), 0);
    return okV4(this.#events.length);
  }

  metrics(): ReplayMetricsV4 {
    return Object.freeze({
      events: this.#events.length,
      inputs: this.#events.filter((event) => event.kind === 'input').length,
      commands: this.#events.filter((event) => event.kind === 'command').length,
      snapshots: this.#events.filter((event) => event.kind === 'snapshot').length,
      markers: this.#events.filter((event) => event.kind === 'marker').length,
      rewinds: this.#rewinds,
      dropped: this.#dropped,
    });
  }

  clear(): void {
    this.#header = null;
    this.#events.length = 0;
    this.#cursor = 0;
    this.#sequence = 0;
  }

  #record(kind: ReplayEventV4['kind'], payload: unknown, trace: TraceId, tick: TickId): OutcomeV4<ReplayEventV4> {
    if (!this.#header) return failV4(createRuntimeErrorV4('REPLAY_NOT_STARTED', 'Replay recording has not started', false));
    if (payloadBytes(payload) > this.maxPayloadBytes) {
      this.#dropped += 1;
      return failV4(createRuntimeErrorV4('REPLAY_PAYLOAD_LIMIT', 'Replay payload exceeds limit', false));
    }
    if (this.#events.length >= this.maxEvents) {
      this.#events.shift();
      this.#dropped += 1;
    }
    const event = Object.freeze({ tick, sequence: ++this.#sequence, kind, payload, trace });
    this.#events.push(event);
    return okV4(event);
  }
}

export function replayTapeSummaryV4(tape: ReplayTapeV4): string {
  const metrics = {
    events: tape.events.length,
    inputs: tape.events.filter((event) => event.kind === 'input').length,
    commands: tape.events.filter((event) => event.kind === 'command').length,
  };
  return `${tape.header.buildId} / ${metrics.events} events / ${metrics.inputs} inputs / ${metrics.commands} commands / ${tape.checksum}`;
}
