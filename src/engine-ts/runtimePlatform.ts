import type { Disposable } from './coreTypes.js';
import { EngineRuntime } from './engineRuntime.js';
import { TelemetryRuntime } from './telemetryRuntime.js';
import { SecurityRuntime } from './securityRuntime.js';

export type PlatformLifecycle = 'new' | 'booting' | 'active' | 'hidden' | 'offline' | 'stopping' | 'stopped' | 'failed';
export interface PlatformHooks { readonly onLifecycle?: (state: PlatformLifecycle) => void; readonly onError?: (error: unknown) => void; }
export interface PlatformSnapshot { readonly lifecycle: PlatformLifecycle; readonly runtime: ReturnType<EngineRuntime['snapshot']>; readonly telemetry: ReturnType<TelemetryRuntime['stats']>; readonly security: ReturnType<SecurityRuntime['stats']>; readonly capabilities: ReturnType<SecurityRuntime['capabilities']>; }

export class RuntimePlatform implements Disposable {
  readonly engine: EngineRuntime;
  readonly telemetry = new TelemetryRuntime();
  readonly security = new SecurityRuntime();
  #lifecycle: PlatformLifecycle = 'new';
  #hooks: PlatformHooks;
  #disposed = false;

  constructor(engine = new EngineRuntime(), hooks: PlatformHooks = {}) { this.engine = engine; this.#hooks = hooks; }
  get lifecycle(): PlatformLifecycle { return this.#lifecycle; }
  async boot(): Promise<boolean> { if (this.#disposed) return false; if (this.#lifecycle === 'active') return true; this.#transition('booting'); try { const ok = await this.engine.boot(); this.#transition(ok ? 'active' : 'failed'); return ok; } catch (error) { this.#hooks.onError?.(error); this.#transition('failed'); return false; } }
  visibility(hidden: boolean): void { if (this.#disposed || this.#lifecycle === 'stopped') return; this.#transition(hidden ? 'hidden' : 'active'); }
  connectivity(online: boolean): void { if (this.#disposed || this.#lifecycle === 'stopped') return; this.#transition(online ? 'active' : 'offline'); }
  async frame(input: Parameters<EngineRuntime['frame']>[0]): Promise<Awaited<ReturnType<EngineRuntime['frame']>>> { if (!(await this.boot())) return null; const result = await this.engine.frame(input); if (result) { const values = result.health.metrics; this.telemetry.sample({ name: 'runtime.frame.ms', value: values.lastFrameMs, unit: 'ms', tick: Number(values.tick), frame: values.frame, tags: {} }); this.telemetry.sample({ name: 'runtime.entities', value: result.world.entities, unit: 'count', tick: Number(values.tick), frame: values.frame, tags: {} }); this.telemetry.sample({ name: 'network.packetLoss', value: result.network.connected ? 0 : 1, unit: 'ratio', tick: Number(values.tick), frame: values.frame, tags: {} }); } return result; }
  validatePayload(payload: unknown): boolean { return this.security.validate(payload).ok; }
  snapshot(): PlatformSnapshot { return Object.freeze({ lifecycle: this.#lifecycle, runtime: this.engine.snapshot(), telemetry: this.telemetry.stats(), security: this.security.stats(), capabilities: this.security.capabilities() }); }
  attachBrowserLifecycle(target: EventTarget = window): () => void { if (this.#disposed) return () => {}; const onVisibility = () => this.visibility(typeof document !== 'undefined' && document.visibilityState === 'hidden'); const onOnline = () => this.connectivity(true); const onOffline = () => this.connectivity(false); const onPageHide = () => this.visibility(true); target.addEventListener('visibilitychange', onVisibility); target.addEventListener('online', onOnline); target.addEventListener('offline', onOffline); target.addEventListener('pagehide', onPageHide); return () => { target.removeEventListener('visibilitychange', onVisibility); target.removeEventListener('online', onOnline); target.removeEventListener('offline', onOffline); target.removeEventListener('pagehide', onPageHide); }; }
  dispose(): void { if (this.#disposed) return; this.#disposed = true; this.#transition('stopping'); this.engine.dispose(); this.telemetry.dispose(); this.security.dispose(); this.#transition('stopped'); }
  #transition(state: PlatformLifecycle): void { if (this.#lifecycle === state) return; this.#lifecycle = state; try { this.#hooks.onLifecycle?.(state); } catch (error) { this.#hooks.onError?.(error); } }
}
