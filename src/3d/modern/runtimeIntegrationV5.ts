import { RuntimeOrchestratorV5, type RuntimeOrchestratorOptionsV5 } from './runtimeOrchestratorV5';
import { type InputActionV5, type InputFrameV5 } from './inputPipelineV5';
import { type AssetDescriptorV5, type EntityStateV5, type RuntimeEventV5, type RuntimeSnapshotV5, type RuntimeHealthV5, type TickV5, tickV5 } from './runtimeContractV5';
import { type PerformanceSampleV5 } from './performanceControllerV5';
import { type VisibilityCandidateV5 } from './renderVisibilityV5';

export interface RuntimeAdapterV5<T = unknown> {
  readonly start?: () => void;
  readonly pause?: () => void;
  readonly resume?: () => void;
  readonly stop?: () => void;
  readonly render?: (candidates: readonly VisibilityCandidateV5[], snapshot: RuntimeSnapshotV5) => void;
  readonly save?: (slot: number, value: T) => Promise<void>;
  readonly load?: (slot: number) => Promise<T | null>;
}
export interface RuntimeIntegrationOptionsV5<T> extends RuntimeOrchestratorOptionsV5<T> { readonly adapter?: RuntimeAdapterV5<T>; readonly eventLimit?: number; readonly fixedDeltaSeconds?: number; }
export interface IntegrationFrameV5 { readonly tick: TickV5; readonly input: InputFrameV5 | null; readonly snapshot: RuntimeSnapshotV5; readonly health: RuntimeHealthV5; readonly renderCount: number; }

export class RuntimeIntegrationV5<T = unknown> {
  readonly runtime: RuntimeOrchestratorV5<T>;
  readonly adapter: RuntimeAdapterV5<T>;
  readonly eventLimit: number;
  #started = false;
  #lastInput: InputFrameV5 | null = null;
  #lastRenderCount = 0;

  constructor(options: RuntimeIntegrationOptionsV5<T> = {}) { this.adapter = options.adapter ?? {}; this.eventLimit = Math.max(8, Math.min(4096, Math.floor(options.eventLimit ?? 256))); this.runtime = new RuntimeOrchestratorV5(options); this.#wireEvents(); }
  start(): boolean { const result = this.runtime.start(); if (result) { this.#started = true; this.adapter.start?.(); } return result; }
  pause(): boolean { const result = this.runtime.pause(); if (result) this.adapter.pause?.(); return result; }
  resume(): boolean { const result = this.runtime.resume(); if (result) this.adapter.resume?.(); return result; }
  stop(): boolean { const result = this.runtime.stop(); if (result) { this.#started = false; this.adapter.stop?.(); } return result; }

  enqueueAsset(descriptor: AssetDescriptorV5, priority = 10): boolean { const declared = this.runtime.assets.declare(descriptor); if (!declared.ok) return false; const queued = this.runtime.assets.enqueue({ id: descriptor.id, priority }); return queued.ok; }
  completeAsset(id: string): boolean { const descriptor = this.runtime.assets.descriptor(id); if (!descriptor) return false; return this.runtime.assets.complete(id, descriptor.digest).ok; }
  failAsset(id: string): boolean { return this.runtime.assets.fail(id).ok; }

  input(tick: TickV5, commands: readonly Parameters<RuntimeOrchestratorV5<T>['dispatchInput']>[]): InputFrameV5 { void commands; return this.#lastInput = this.runtime.input.ingest(tick, []); }
  action(action: InputActionV5, value = 1): void { this.runtime.dispatchInput(action, value); }

  step(deltaSeconds?: number): IntegrationFrameV5 {
    if (!this.#started) this.start();
    const metrics = this.runtime.frame(deltaSeconds ?? 1 / 60);
    const snapshot = this.runtime.snapshot();
    const candidates = this.runtime.renderCandidates();
    this.#lastRenderCount = this.#render(candidates, snapshot);
    return Object.freeze({ tick: metrics.tick, input: this.#lastInput, snapshot, health: this.runtime.health(), renderCount: this.#lastRenderCount });
  }

  samplePerformance(sample: Omit<PerformanceSampleV5, 'timestamp'>): void { this.runtime.performance.sample(sample); }
  setQuality(quality: Parameters<RuntimeOrchestratorV5<T>['performance']['forceQuality']>[0]): void { this.runtime.performance.forceQuality(quality, 'integration'); }

  async save(slot: number): Promise<boolean> { const result = await this.runtime.save(slot); if (!result.ok || result.value === undefined) return false; await this.adapter.save?.(slot, result.value as T); return true; }
  async load(slot: number): Promise<T | null> { if (this.adapter.load) return this.adapter.load(slot); const result = await this.runtime.load(slot); return result.ok ? result.value ?? null : null; }

  entity(id: number): EntityStateV5 | null { return this.runtime.entity(id); }
  entities(): readonly EntityStateV5[] { return this.runtime.entities(); }
  snapshot(): RuntimeSnapshotV5 { return this.runtime.snapshot(); }
  health(): RuntimeHealthV5 { return this.runtime.health(); }
  events(): readonly RuntimeEventV5<unknown>[] { return this.runtime.events(this.eventLimit); }
  lastRenderCount(): number { return this.#lastRenderCount; }
  phase(): string { return this.runtime.phase(); }
  tick(): TickV5 { return this.runtime.tick(); }
  reset(): void { this.runtime.reset(); this.#started = false; this.#lastInput = null; this.#lastRenderCount = 0; }

  #wireEvents(): void { this.runtime.registerEventHandler({ type: 'runtime.fail', handle: () => undefined }); this.runtime.registerEventHandler({ type: 'runtime.recovered', handle: () => undefined }); }
  #render(candidates: readonly VisibilityCandidateV5[], snapshot: RuntimeSnapshotV5): number { const camera = { position: { x: 0, y: 2, z: 5 }, forward: { x: 0, y: 0, z: -1 }, fov: 70, near: 0.1, far: 5000 }; const result = this.runtime.visibility.evaluate(candidates, camera); this.adapter.render?.(result.visible, snapshot); return result.visible.length; }
}

export function bootRuntimeV5<T = unknown>(options: RuntimeIntegrationOptionsV5<T> = {}): RuntimeIntegrationV5<T> { const runtime = new RuntimeIntegrationV5(options); runtime.start(); return runtime; }
export function tickFromElapsedV5(elapsedMs: number, fixedDeltaSeconds = 1 / 60): TickV5 { return tickV5(Math.floor(Math.max(0, elapsedMs) / (fixedDeltaSeconds * 1000))); }
