import { digestValue } from './deterministic.js';
import type { R16Result } from './types.js';
import type { R16FramePhase } from './frameScheduler.js';

export interface R16SceneAdapterState {
  readonly mounted: boolean;
  readonly visibleEntities: number;
  readonly activeEffects: number;
  readonly residentBytes: number;
  readonly lastAppliedTick: number;
  readonly digest: string;
}

export interface R16SceneAdapter {
  readonly mount: () => R16Result<void>;
  readonly unmount: () => R16Result<void>;
  readonly applyPhase: (
    phase: R16FramePhase,
    tick: number,
    payload: Readonly<Record<string, unknown>>,
  ) => R16Result<void>;
  readonly metrics: () => Readonly<{
    visibleEntities: number;
    activeEffects: number;
    residentBytes: number;
  }>;
}

export interface R16AdapterCommand {
  readonly phase: R16FramePhase;
  readonly tick: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export class R16RuntimeAdapter {
  readonly #adapter: R16SceneAdapter;
  #mounted = false;
  #lastTick = 0;
  #commands = 0;
  #rejections = 0;

  constructor(adapter: R16SceneAdapter) {
    this.#adapter = adapter;
  }

  mount(): R16Result<void> {
    if (this.#mounted) {
      return { ok: true, value: undefined };
    }

    const result = this.#adapter.mount();

    if (result.ok) {
      this.#mounted = true;
    } else {
      this.#rejections += 1;
    }

    return result;
  }

  unmount(): R16Result<void> {
    if (!this.#mounted) {
      return { ok: true, value: undefined };
    }

    const result = this.#adapter.unmount();

    if (result.ok) {
      this.#mounted = false;
    } else {
      this.#rejections += 1;
    }

    return result;
  }

  apply(command: R16AdapterCommand): R16Result<void> {
    if (!this.#mounted) {
      return this.reject(
        'ADAPTER_NOT_MOUNTED',
        'Scene adapter is not mounted',
      );
    }

    const tick = Math.max(0, Math.trunc(command.tick));

    if (tick < this.#lastTick) {
      return this.reject(
        'ADAPTER_STALE_TICK',
        'Scene adapter cannot apply a stale tick',
      );
    }

    if (
      !command.payload ||
      Object.keys(command.payload).length > 256
    ) {
      return this.reject(
        'ADAPTER_PAYLOAD',
        'Scene adapter payload exceeds the key budget',
      );
    }

    const result = this.#adapter.applyPhase(
      command.phase,
      tick,
      freezePayload(command.payload),
    );

    this.#commands += 1;

    if (result.ok) {
      this.#lastTick = tick;
    } else {
      this.#rejections += 1;
    }

    return result;
  }

  renderPacket(
    tick: number,
    payload: Readonly<Record<string, unknown>>,
  ): R16Result<void> {
    return this.apply({
      phase: 'render',
      tick,
      payload,
    });
  }

  sceneState(): R16SceneAdapterState {
    const metrics = this.#adapter.metrics();

    const body = {
      mounted: this.#mounted,
      visibleEntities: safeCount(metrics.visibleEntities),
      activeEffects: safeCount(metrics.activeEffects),
      residentBytes: safeCount(metrics.residentBytes),
      lastAppliedTick: this.#lastTick,
    };

    return Object.freeze({
      ...body,
      digest: digestValue(body),
    });
  }

  stats(): Readonly<{
    mounted: boolean;
    commands: number;
    rejections: number;
    rejectionRatio: number;
    digest: string;
  }> {
    const rejectionRatio =
      this.#commands <= 0
        ? 0
        : Math.min(1, this.#rejections / this.#commands);

    return Object.freeze({
      mounted: this.#mounted,
      commands: this.#commands,
      rejections: this.#rejections,
      rejectionRatio,
      digest: digestValue({
        mounted: this.#mounted,
        commands: this.#commands,
        rejections: this.#rejections,
      }),
    });
  }

  resetCounters(): void {
    this.#commands = 0;
    this.#rejections = 0;
  }

  private reject(code: string, message: string): R16Result<never> {
    this.#rejections += 1;
    return {
      ok: false,
      error: {
        code,
        message,
        retryable: false,
      },
    };
  }
}

function safeCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

function freezePayload(
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...payload,
  });
}
