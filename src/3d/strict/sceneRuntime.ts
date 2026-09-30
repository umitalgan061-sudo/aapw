import type { FrameId, RenderPolicy, RuntimeBudgets, RuntimeFrame, RuntimePhase, Result, TickId } from './liveCoreTypes.ts';
import { clamp, err, frameId, ok, tickId } from './liveCoreTypes.ts';

export interface SceneViewport {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

export interface SceneLifecyclePolicy {
  readonly maxDeltaSeconds: number;
  readonly pauseWhenHidden: boolean;
  readonly maxTransitions: number;
  readonly maxFrameHistory: number;
}

export interface SceneRecord {
  readonly frame: FrameId;
  readonly tick: TickId;
  readonly phase: RuntimePhase;
  readonly viewport: SceneViewport;
  readonly renderPolicy: RenderPolicy;
  readonly frameData?: RuntimeFrame;
}

export const DEFAULT_SCENE_POLICY: SceneLifecyclePolicy = Object.freeze({
  maxDeltaSeconds: 0.1,
  pauseWhenHidden: true,
  maxTransitions: 64,
  maxFrameHistory: 120,
});

const ALLOWED: Readonly<Record<RuntimePhase, readonly RuntimePhase[]>> = Object.freeze({
  created: ['initializing', 'failed', 'disposed'],
  initializing: ['ready', 'failed', 'stopping'],
  ready: ['running', 'stopping', 'failed', 'disposed'],
  running: ['paused', 'recovering', 'stopping', 'failed'],
  paused: ['running', 'recovering', 'stopping', 'disposed'],
  recovering: ['running', 'paused', 'failed', 'stopping'],
  stopping: ['disposed', 'failed'],
  disposed: [],
  failed: ['initializing', 'stopping', 'disposed'],
});

const canTransition = (from: RuntimePhase, to: RuntimePhase): boolean =>
  ALLOWED[from].includes(to);

export class StrictSceneRuntime {
  #phase: RuntimePhase = 'created';
  #frame = 0;
  #tick = 0;
  #disposed = false;
  #viewport: SceneViewport;
  #renderPolicy: RenderPolicy;
  #policy: SceneLifecyclePolicy;
  #history: SceneRecord[] = [];
  #transitions: Array<{ readonly from: RuntimePhase; readonly to: RuntimePhase; readonly reason: string; readonly tick: TickId }> = [];
  #visibilityHidden = false;

  constructor(
    viewport: SceneViewport,
    renderPolicy: RenderPolicy,
    policy: SceneLifecyclePolicy = DEFAULT_SCENE_POLICY,
  ) {
    this.#viewport = normalizeViewport(viewport);
    this.#renderPolicy = renderPolicy;
    this.#policy = Object.freeze({ ...policy });
  }

  phase(): RuntimePhase {
    return this.#phase;
  }

  viewport(): SceneViewport {
    return this.#viewport;
  }

  transition(to: RuntimePhase, reason: string): Result<RuntimePhase> {
    if (this.#disposed) return err('RUNTIME_DISPOSED', 'Scene runtime is disposed.');
    if (!canTransition(this.#phase, to)) {
      return err(
        'INVALID_TRANSITION',
        'Scene lifecycle transition is not allowed.',
        true,
        { from: this.#phase, to, reason: reason.slice(0, 128) },
      );
    }
    const from = this.#phase;
    this.#phase = to;
    this.#transitions.push(Object.freeze({
      from,
      to,
      reason: reason.slice(0, 128),
      tick: tickId(this.#tick),
    }));
    if (this.#transitions.length > this.#policy.maxTransitions) this.#transitions.shift();
    if (to === 'disposed') this.#disposed = true;
    return ok(to);
  }

  setVisibility(hidden: boolean): Result<RuntimePhase> {
    this.#visibilityHidden = Boolean(hidden);
    if (this.#policy.pauseWhenHidden && this.#visibilityHidden && this.#phase === 'running') {
      return this.transition('paused', 'document-hidden');
    }
    if (!this.#visibilityHidden && this.#phase === 'paused') {
      return this.transition('running', 'document-visible');
    }
    return ok(this.#phase);
  }

  resize(width: number, height: number, pixelRatio: number): Result<SceneViewport> {
    if (this.#disposed) return err('RUNTIME_DISPOSED', 'Scene runtime is disposed.');
    const next = normalizeViewport({ width, height, pixelRatio });
    this.#viewport = next;
    return ok(next);
  }

  setRenderPolicy(policy: RenderPolicy): Result<RenderPolicy> {
    if (this.#disposed) return err('RUNTIME_DISPOSED', 'Scene runtime is disposed.');
    if (policy.renderScale <= 0 || policy.renderScale > 1) {
      return err('INVALID_FRAME', 'Render scale is outside the supported range.', true, { renderScale: policy.renderScale });
    }
    this.#renderPolicy = policy;
    return ok(policy);
  }

  frame(
    deltaSeconds: number,
    budgets: RuntimeBudgets,
    simulatedSeconds: number,
  ): Result<RuntimeFrame> {
    if (this.#disposed) return err('RUNTIME_DISPOSED', 'Scene runtime is disposed.');
    if (!Number.isFinite(deltaSeconds) || !Number.isFinite(simulatedSeconds)) {
      return err('INVALID_FRAME', 'Frame timing contains non-finite values.', true);
    }
    const delta = clamp(deltaSeconds, 0, this.#policy.maxDeltaSeconds);
    const nextFrame = frameId(++this.#frame);
    const nextTick = tickId(++this.#tick);
    const frame: RuntimeFrame = Object.freeze({
      id: nextFrame,
      tick: nextTick,
      deltaSeconds: delta,
      simulatedSeconds: Math.max(0, simulatedSeconds),
      phase: this.#phase,
      budgets: Object.freeze({
        simulationMs: clamp(budgets.simulationMs, 0, 1000),
        renderMs: clamp(budgets.renderMs, 0, 1000),
        inputMs: clamp(budgets.inputMs, 0, 1000),
        assetMs: clamp(budgets.assetMs, 0, 1000),
        telemetryMs: clamp(budgets.telemetryMs, 0, 1000),
      }),
    });
    const record: SceneRecord = Object.freeze({
      frame: nextFrame,
      tick: nextTick,
      phase: this.#phase,
      viewport: this.#viewport,
      renderPolicy: this.#renderPolicy,
      frameData: frame,
    });
    this.#history.push(record);
    if (this.#history.length > this.#policy.maxFrameHistory) this.#history.shift();
    return ok(frame);
  }

  diagnostics(): Readonly<{
    phase: RuntimePhase;
    frame: number;
    tick: number;
    hidden: boolean;
    viewport: SceneViewport;
    transitions: readonly { readonly from: RuntimePhase; readonly to: RuntimePhase; readonly reason: string; readonly tick: TickId }[];
    historyLength: number;
  }> {
    return Object.freeze({
      phase: this.#phase,
      frame: this.#frame,
      tick: this.#tick,
      hidden: this.#visibilityHidden,
      viewport: this.#viewport,
      transitions: Object.freeze([...this.#transitions]),
      historyLength: this.#history.length,
    });
  }

  synchronizePhase(phase: RuntimePhase, reason = 'snapshot-restore'): Result<RuntimePhase> {
    if (this.#disposed) return err('RUNTIME_DISPOSED', 'Scene runtime is disposed.');
    if (this.#phase === phase) return ok(this.#phase);
    if (!canTransition(this.#phase, phase)) {
      const from = this.#phase;
      this.#phase = phase;
      this.#transitions.push(Object.freeze({
        from,
        to: phase,
        reason: reason.slice(0, 128),
        tick: tickId(this.#tick),
      }));
      if (this.#transitions.length > this.#policy.maxTransitions) this.#transitions.shift();
      return ok(this.#phase);
    }
    return this.transition(phase, reason);
  }

  latest(): SceneRecord | null {
    return this.#history.at(-1) ?? null;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#phase = 'disposed';
    this.#disposed = true;
    this.#history = [];
  }
}

const normalizeViewport = (viewport: SceneViewport): SceneViewport => Object.freeze({
  width: Math.max(1, Math.floor(Number.isFinite(viewport.width) ? viewport.width : 1)),
  height: Math.max(1, Math.floor(Number.isFinite(viewport.height) ? viewport.height : 1)),
  pixelRatio: clamp(viewport.pixelRatio, 0.5, 3),
});