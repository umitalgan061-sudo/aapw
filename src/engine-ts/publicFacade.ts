import type { Disposable, Vec3 } from './coreTypes.js';
import { EngineRuntime, type EngineFrameInput } from './engineRuntime.js';
import { RuntimePlatform } from './runtimePlatform.js';
import { defaultCameraView } from './renderRuntime.js';

export interface BrowserEngineOptions { readonly engine?: EngineRuntime; readonly autoLifecycle?: boolean; }
export interface BrowserEngineSnapshot { readonly lifecycle: ReturnType<RuntimePlatform['lifecycle']['toString']>; readonly entities: number; readonly frame: number; readonly quality: string; readonly telemetrySamples: number; }

export class BrowserEngineFacade implements Disposable {
  readonly platform: RuntimePlatform;
  #detachLifecycle: (() => void) | null = null;
  #disposed = false;
  constructor(options: BrowserEngineOptions = {}) { this.platform = new RuntimePlatform(options.engine); if (options.autoLifecycle !== false && typeof window !== 'undefined') this.#detachLifecycle = this.platform.attachBrowserLifecycle(window); }
  async start(): Promise<boolean> { return this.platform.boot(); }
  async tick(deltaSeconds = 1 / 60, camera = defaultCameraView()): Promise<Awaited<ReturnType<RuntimePlatform['frame']>>> { return this.platform.frame({ deltaSeconds, camera }); }
  addPlayer(id: string, position: Vec3): boolean { return this.platform.engine.addPlayer(id, position); }
  addProp(id: string, position: Vec3, tags: readonly string[] = []): boolean { return this.platform.engine.addEntity(id, position, tags); }
  snapshot(): ReturnType<RuntimePlatform['snapshot']> { return this.platform.snapshot(); }
  validateInput(payload: unknown): boolean { return this.platform.validatePayload(payload); }
  async save(slot: number): Promise<boolean> { return this.platform.engine.save(slot); }
  async load(slot: number): Promise<Record<string, unknown> | null> { return this.platform.engine.load(slot); }
  stop(): void { this.dispose(); }
  dispose(): void { if (this.#disposed) return; this.#disposed = true; this.#detachLifecycle?.(); this.#detachLifecycle = null; this.platform.dispose(); }
}

export const createBrowserEngine = (options: BrowserEngineOptions = {}): BrowserEngineFacade => new BrowserEngineFacade(options);

export const createEngineFrameInput = (deltaSeconds: number, partial: Partial<EngineFrameInput> = {}): EngineFrameInput => Object.freeze({ deltaSeconds, camera: partial.camera ?? defaultCameraView(), commands: partial.commands ?? [], inputTick: partial.inputTick ?? 0 });
