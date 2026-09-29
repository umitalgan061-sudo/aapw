import type { InputIntent, InputSource, Outcome, Result } from './kernelTypes.ts';
import { clamp, fault, radialAxis, stableHash } from './kernelTypes.ts';

export interface RawSample {
  readonly source: InputSource;
  readonly moveX?: number;
  readonly moveY?: number;
  readonly lookX?: number;
  readonly lookY?: number;
  readonly zoom?: number;
  readonly held?: readonly string[];
  readonly pressed?: readonly string[];
  readonly released?: readonly string[];
  readonly sampleTime?: number;
}

export interface InputPolicy {
  readonly deadzone: number;
  readonly maxLookRate: number;
  readonly maxZoomRate: number;
  readonly maximumHeldActions: number;
  readonly maximumEdgeActions: number;
  readonly maxBufferedSamples: number;
  readonly duplicateWindowSeconds: number;
}

export const DEFAULT_INPUT_POLICY: InputPolicy = Object.freeze({
  deadzone: 0.12,
  maxLookRate: 12,
  maxZoomRate: 4,
  maximumHeldActions: 32,
  maximumEdgeActions: 16,
  maxBufferedSamples: 32,
  duplicateWindowSeconds: 0.01,
});

interface StoredSample {
  readonly normalized: InputIntent;
  readonly receivedSequence: number;
}

const uniqueSorted = (values: readonly string[] | undefined, limit: number): readonly string[] =>
  Object.freeze([...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort().slice(0, limit));

const normalizeTime = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) ? Math.max(0, value as number) : fallback;

export class InputHub {
  readonly policy: InputPolicy;
  #sequence = 0;
  #lastTime = 0;
  #lastBySource = new Map<InputSource, InputIntent>();
  #buffer: StoredSample[] = [];
  #dropped = 0;
  #disposed = false;

  constructor(policy: InputPolicy = DEFAULT_INPUT_POLICY) {
    this.policy = Object.freeze({ ...policy });
  }

  #alive(): Result<void> {
    return this.#disposed
      ? { ok: false, error: fault('disposed', 'Input hub is disposed.', false) }
      : { ok: true, value: undefined };
  }

  normalize(sample: RawSample): Outcome<InputIntent> {
    const alive = this.#alive();
    if (!alive.ok) return alive;
    const t = normalizeTime(sample.sampleTime, this.#lastTime);
    const previous = this.#lastBySource.get(sample.source);
    if (t + this.policy.duplicateWindowSeconds < this.#lastTime) {
      return { ok: false, error: fault('sequence', 'Input sample arrived out of order.', true, { t, lastTime: this.#lastTime }) };
    }

    const move = radialAxis(sample.moveX ?? 0, sample.moveY ?? 0, this.policy.deadzone);
    const look = radialAxis(
      clamp(sample.lookX ?? 0, -this.policy.maxLookRate, this.policy.maxLookRate),
      clamp(sample.lookY ?? 0, -this.policy.maxLookRate, this.policy.maxLookRate),
      0,
    );
    const zoom = clamp(sample.zoom ?? 0, -this.policy.maxZoomRate, this.policy.maxZoomRate);

    const held = uniqueSorted(sample.held, this.policy.maximumHeldActions);
    const pressed = uniqueSorted(sample.pressed, this.policy.maximumEdgeActions);
    const released = uniqueSorted(sample.released, this.policy.maximumEdgeActions);
    const sequence = ++this.#sequence;

    const intent: InputIntent = Object.freeze({
      source: sample.source,
      move,
      look,
      zoom,
      held: new Set(held),
      pressed: new Set(pressed),
      released: new Set(released),
      sequence,
      sampleTime: t,
    });

    if (previous && stableHash(previous) === stableHash(intent)) return { ok: true, value: previous };
    this.#lastTime = Math.max(this.#lastTime, t);
    this.#lastBySource.set(sample.source, intent);
    return { ok: true, value: intent };
  }

  push(sample: RawSample): Outcome<InputIntent> {
    const result = this.normalize(sample);
    if (!result.ok) return result;
    if (this.#buffer.length >= this.policy.maxBufferedSamples) {
      this.#buffer.shift();
      this.#dropped += 1;
    }
    this.#buffer.push(Object.freeze({ normalized: result.value, receivedSequence: result.value.sequence }));
    return result;
  }

  drain(maxSamples = this.policy.maxBufferedSamples): readonly InputIntent[] {
    const count = Math.max(0, Math.floor(maxSamples));
    const drained = this.#buffer.splice(0, count).map((entry) => entry.normalized);
    return Object.freeze(drained);
  }

  latest(source?: InputSource): InputIntent | null {
    if (source) return this.#lastBySource.get(source) ?? null;
    const latest = [...this.#lastBySource.values()].sort((a, b) => b.sequence - a.sequence)[0];
    return latest ?? null;
  }

  merge(samples: readonly InputIntent[]): InputIntent {
    const ordered = [...samples].sort((a, b) => a.sequence - b.sequence);
    const last = ordered.at(-1);
    if (!last) {
      return Object.freeze({
        source: 'synthetic',
        move: radialAxis(0, 0),
        look: radialAxis(0, 0),
        zoom: 0,
        held: new Set<string>(),
        pressed: new Set<string>(),
        released: new Set<string>(),
        sequence: this.#sequence,
        sampleTime: this.#lastTime,
      });
    }
    const moveX = ordered.reduce((sum, item) => sum + item.move.x, 0);
    const moveY = ordered.reduce((sum, item) => sum + item.move.y, 0);
    const lookX = ordered.reduce((sum, item) => sum + item.look.x, 0);
    const lookY = ordered.reduce((sum, item) => sum + item.look.y, 0);
    const held = new Set<string>();
    const pressed = new Set<string>();
    const released = new Set<string>();
    for (const item of ordered) {
      item.held.forEach((value) => held.add(value));
      item.pressed.forEach((value) => pressed.add(value));
      item.released.forEach((value) => released.add(value));
    }
    return Object.freeze({
      source: last.source,
      move: radialAxis(clamp(moveX, -1, 1), clamp(moveY, -1, 1), this.policy.deadzone),
      look: radialAxis(clamp(lookX, -this.policy.maxLookRate, this.policy.maxLookRate), clamp(lookY, -this.policy.maxLookRate, this.policy.maxLookRate), 0),
      zoom: clamp(last.zoom, -this.policy.maxZoomRate, this.policy.maxZoomRate),
      held: new Set([...held].sort().slice(0, this.policy.maximumHeldActions)),
      pressed: new Set([...pressed].sort().slice(0, this.policy.maximumEdgeActions)),
      released: new Set([...released].sort().slice(0, this.policy.maximumEdgeActions)),
      sequence: last.sequence,
      sampleTime: last.sampleTime,
    });
  }

  droppedSamples(): number { return this.#dropped; }
  bufferedSamples(): number { return this.#buffer.length; }

  diagnostics() {
    return Object.freeze({
      sequence: this.#sequence,
      buffered: this.#buffer.length,
      dropped: this.#dropped,
      sources: Object.freeze([...this.#lastBySource.keys()].sort()),
      digest: stableHash({
        sequence: this.#sequence,
        buffered: this.#buffer.map((entry) => entry.normalized.sequence),
        dropped: this.#dropped,
      }),
    });
  }

  reset(): void {
    this.#sequence = 0;
    this.#lastTime = 0;
    this.#lastBySource.clear();
    this.#buffer = [];
    this.#dropped = 0;
  }

  dispose(): void {
    this.#disposed = true;
    this.reset();
  }
}

export const actionPressed = (intent: InputIntent | null, action: string): boolean =>
  Boolean(intent?.pressed.has(action));
export const actionHeld = (intent: InputIntent | null, action: string): boolean =>
  Boolean(intent?.held.has(action));
export const actionReleased = (intent: InputIntent | null, action: string): boolean =>
  Boolean(intent?.released.has(action));

export const inputIntentDigest = (intent: InputIntent): string =>
  stableHash({
    source: intent.source,
    move: intent.move,
    look: intent.look,
    zoom: intent.zoom,
    held: [...intent.held].sort(),
    pressed: [...intent.pressed].sort(),
    released: [...intent.released].sort(),
    sequence: intent.sequence,
    sampleTime: intent.sampleTime,
  });
