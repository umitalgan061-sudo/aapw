import { stableObjectDigestR29, type R29InputIntent } from './contracts.ts';

export interface R29ReplayEvent {
  readonly tick: number;
  readonly sequence: number;
  readonly kind: 'input' | 'marker' | 'checkpoint';
  readonly payload: unknown;
  readonly digest: string;
}

export interface R29ReplayCheckpoint {
  readonly tick: number;
  readonly digest: string;
  readonly eventIndex: number;
}

export interface R29ReplaySnapshot {
  readonly events: readonly R29ReplayEvent[];
  readonly checkpoints: readonly R29ReplayCheckpoint[];
  readonly finalDigest: string;
}

export class R29ReplayJournal {
  readonly maxEvents: number;
  readonly checkpointEveryTicks: number;
  #events: R29ReplayEvent[] = [];
  #checkpoints: R29ReplayCheckpoint[] = [];
  #lastTick = -1;
  #lastSequence = 0;

  constructor(options: { readonly maxEvents?: number; readonly checkpointEveryTicks?: number } = {}) {
    this.maxEvents = Math.max(128, Math.floor(options.maxEvents ?? 8192));
    this.checkpointEveryTicks = Math.max(1, Math.floor(options.checkpointEveryTicks ?? 30));
  }

  recordInput(input: R29InputIntent): R29ReplayEvent {
    if (input.tick < this.#lastTick) throw new Error('R29_REPLAY_TICK_REVERSED');
    if (input.sequence <= this.#lastSequence) throw new Error('R29_REPLAY_SEQUENCE_REVERSED');
    this.#lastTick = input.tick;
    this.#lastSequence = input.sequence;
    return this.#append({
      tick: input.tick,
      sequence: input.sequence,
      kind: 'input',
      payload: input,
    });
  }

  marker(tick: number, label: string, payload: unknown = null): R29ReplayEvent {
    const normalizedTick = Math.max(0, Math.floor(tick));
    return this.#append({
      tick: normalizedTick,
      sequence: this.#lastSequence,
      kind: 'marker',
      payload: { label: label.slice(0, 96), payload },
    });
  }

  checkpoint(tick: number, state: unknown): R29ReplayCheckpoint {
    const normalizedTick = Math.max(0, Math.floor(tick));
    const checkpoint = Object.freeze({
      tick: normalizedTick,
      digest: stableObjectDigestR29(state),
      eventIndex: this.#events.length,
    });
    this.#checkpoints.push(checkpoint);
    while (this.#checkpoints.length > 256) this.#checkpoints.shift();
    return checkpoint;
  }

  shouldCheckpoint(tick: number): boolean {
    const normalizedTick = Math.max(0, Math.floor(tick));
    const last = this.#checkpoints.at(-1);
    return !last || normalizedTick - last.tick >= this.checkpointEveryTicks;
  }

  verify(finalState: unknown): { readonly ok: boolean; readonly digest: string; readonly events: number; readonly checkpoints: number } {
    const digest = stableObjectDigestR29(finalState);
    const eventDigest = stableObjectDigestR29(this.#events.map((event) => event.digest));
    const combined = stableObjectDigestR29({ digest, eventDigest });
    return Object.freeze({
      ok: this.#events.length <= this.maxEvents && this.#checkpoints.every((checkpoint) => checkpoint.eventIndex <= this.#events.length),
      digest: combined,
      events: this.#events.length,
      checkpoints: this.#checkpoints.length,
    });
  }

  snapshot(finalState?: unknown): R29ReplaySnapshot {
    const finalDigest = stableObjectDigestR29({
      state: finalState ?? null,
      events: this.#events.map((event) => event.digest),
      checkpoints: this.#checkpoints,
    });
    return Object.freeze({
      events: Object.freeze(this.#events.map((event) => ({ ...event }))),
      checkpoints: Object.freeze(this.#checkpoints.map((checkpoint) => ({ ...checkpoint }))),
      finalDigest,
    });
  }

  clear(): void {
    this.#events.length = 0;
    this.#checkpoints.length = 0;
    this.#lastTick = -1;
    this.#lastSequence = 0;
  }

  #append(input: Omit<R29ReplayEvent, 'digest'>): R29ReplayEvent {
    if (this.#events.length >= this.maxEvents) throw new Error('R29_REPLAY_EVENT_LIMIT');
    const digest = stableObjectDigestR29(input);
    const event = Object.freeze({ ...input, digest });
    this.#events.push(event);
    return event;
  }
}
