import type { UnixMillis } from './types';
import { RuntimeObservability } from './runtimeObservability';

export type LifecycleSignal = 'visibility:hidden' | 'visibility:visible' | 'pagehide' | 'pageshow' | 'freeze' | 'resume' | 'online' | 'offline' | 'memory-pressure';
export type LifecycleState = 'cold' | 'starting' | 'running' | 'suspended' | 'stopping' | 'stopped' | 'faulted';

export interface LifecycleEvent {
  readonly signal: LifecycleSignal;
  readonly timestamp: UnixMillis;
  readonly state: LifecycleState;
  readonly reason: string;
}

export interface RuntimeLifecycleControllerOptions {
  readonly onSuspend?: (event: LifecycleEvent) => Promise<void> | void;
  readonly onResume?: (event: LifecycleEvent) => Promise<void> | void;
  readonly onSave?: (event: LifecycleEvent) => Promise<void> | void;
  readonly onFlush?: (event: LifecycleEvent) => Promise<void> | void;
  readonly onNetworkChange?: (online: boolean, event: LifecycleEvent) => Promise<void> | void;
  readonly now?: () => UnixMillis;
  readonly observability?: RuntimeObservability;
  readonly debounceMs?: number;
}

type LifecycleCallback = (event: LifecycleEvent) => Promise<void> | void;
interface LifecycleCallbacks {
  readonly onSuspend?: LifecycleCallback;
  readonly onResume?: LifecycleCallback;
  readonly onSave?: LifecycleCallback;
  readonly onFlush?: LifecycleCallback;
  readonly onNetworkChange?: (online: boolean, event: LifecycleEvent) => Promise<void> | void;
}

export interface LifecycleStats {
  readonly state: LifecycleState;
  readonly events: number;
  readonly suspends: number;
  readonly resumes: number;
  readonly saves: number;
  readonly flushes: number;
  readonly online: boolean;
  readonly lastSignal: LifecycleSignal | null;
  readonly lastTimestamp: UnixMillis | null;
}

/** Central browser lifecycle policy with bounded, failure-isolated callbacks. */
export class RuntimeLifecycleController {
  readonly debounceMs: number;
  readonly observability: RuntimeObservability;
  #now: () => UnixMillis;
  #callbacks: LifecycleCallbacks;
  #state: LifecycleState = 'cold';
  #online = true;
  #listeners: Array<() => void> = [];
  #eventListeners = new Set<(event: LifecycleEvent) => void>();
  #events = 0;
  #suspends = 0;
  #resumes = 0;
  #saves = 0;
  #flushes = 0;
  #lastSignal: LifecycleSignal | null = null;
  #lastTimestamp: UnixMillis | null = null;
  #lastDispatchAt = -Infinity;
  #started = false;

  constructor(options: RuntimeLifecycleControllerOptions = {}) {
    this.#now = options.now ?? (() => Date.now() as UnixMillis);
    this.debounceMs = Math.max(0, Math.trunc(options.debounceMs ?? 100));
    this.observability = options.observability ?? new RuntimeObservability({ now: this.#now });
    this.#callbacks = {
      ...(options.onSuspend ? { onSuspend: options.onSuspend } : {}),
      ...(options.onResume ? { onResume: options.onResume } : {}),
      ...(options.onSave ? { onSave: options.onSave } : {}),
      ...(options.onFlush ? { onFlush: options.onFlush } : {}),
      ...(options.onNetworkChange ? { onNetworkChange: options.onNetworkChange } : {}),
    };
  }

  get state(): LifecycleState { return this.#state; }
  get online(): boolean { return this.#online; }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#state = 'starting';
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      this.#state = 'running';
      return;
    }
    const bind = (target: EventTarget, type: string, listener: EventListener): void => {
      target.addEventListener(type, listener);
      this.#listeners.push(() => target.removeEventListener(type, listener));
    };
    bind(document, 'visibilitychange', () => void this.dispatch(document.hidden ? 'visibility:hidden' : 'visibility:visible', document.hidden ? 'document hidden' : 'document visible'));
    bind(window, 'pagehide', () => void this.dispatch('pagehide', 'page lifecycle hide'));
    bind(window, 'pageshow', () => void this.dispatch('pageshow', 'page lifecycle show'));
    bind(window, 'online', () => void this.dispatch('online', 'network online'));
    bind(window, 'offline', () => void this.dispatch('offline', 'network offline'));
    if ('onfreeze' in document) bind(document, 'freeze', () => void this.dispatch('freeze', 'page freeze'));
    if ('onresume' in document) bind(document, 'resume', () => void this.dispatch('resume', 'page resume'));
    this.#state = 'running';
  }

  async stop(): Promise<void> {
    if (!this.#started) return;
    this.#state = 'stopping';
    const event = this.#makeEvent('pagehide', 'controller stop');
    await this.#safe('stop-save', this.#callbacks.onSave, event);
    await this.#safe('stop-flush', this.#callbacks.onFlush, event);
    for (const dispose of this.#listeners.splice(0)) dispose();
    this.#state = 'stopped';
    this.#started = false;
  }

  async dispatch(signal: LifecycleSignal, reason: string): Promise<void> {
    const now = this.#now();
    if (signal !== 'pagehide' && signal !== 'pageshow' && Number(now) - Number(this.#lastDispatchAt) < this.debounceMs) return;
    this.#lastDispatchAt = now;
    const event = this.#makeEvent(signal, reason, now);
    this.#events += 1;
    this.#lastSignal = signal;
    this.#lastTimestamp = now;
    this.observability.count(`lifecycle.${signal}`, 1);
    for (const listener of this.#eventListeners) listener(event);

    if (signal === 'visibility:hidden' || signal === 'freeze' || signal === 'pagehide') {
      if (this.#state !== 'suspended') this.#suspends += 1;
      this.#state = 'suspended';
      await this.#safe('lifecycle-save', this.#callbacks.onSave, event);
      if (this.#callbacks.onSave) this.#saves += 1;
      await this.#safe('lifecycle-suspend', this.#callbacks.onSuspend, event);
      await this.#safe('lifecycle-flush', this.#callbacks.onFlush, event);
      if (this.#callbacks.onFlush) this.#flushes += 1;
      return;
    }
    if (signal === 'visibility:visible' || signal === 'resume' || signal === 'pageshow') {
      if (this.#state === 'suspended') this.#resumes += 1;
      this.#state = 'running';
      await this.#safe('lifecycle-resume', this.#callbacks.onResume, event);
      return;
    }
    if (signal === 'online' || signal === 'offline') {
      this.#online = signal === 'online';
      await this.#safeNetwork('lifecycle-network', this.#callbacks.onNetworkChange, this.#online, event);
      return;
    }
    await this.#safe('lifecycle-flush-memory', this.#callbacks.onFlush, event);
    if (this.#callbacks.onFlush) this.#flushes += 1;
  }

  on(listener: (event: LifecycleEvent) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  stats(): LifecycleStats {
    return Object.freeze({ state: this.#state, events: this.#events, suspends: this.#suspends, resumes: this.#resumes, saves: this.#saves, flushes: this.#flushes, online: this.#online, lastSignal: this.#lastSignal, lastTimestamp: this.#lastTimestamp });
  }

  async memoryPressure(): Promise<void> { await this.dispatch('memory-pressure', 'manual memory-pressure signal'); }

  dispose(): void {
    for (const dispose of this.#listeners.splice(0)) dispose();
    this.#eventListeners.clear();
    this.#state = 'stopped';
    this.#started = false;
  }

  #makeEvent(signal: LifecycleSignal, reason: string, timestamp = this.#now()): LifecycleEvent {
    return Object.freeze({ signal, timestamp, state: this.#state, reason: reason.slice(0, 256) });
  }

  async #safe(name: string, callback: LifecycleCallback | undefined, event: LifecycleEvent): Promise<void> {
    if (!callback) return;
    const span = this.observability.start('recovery', 0 as never, { operation: name });
    try { await callback(event); span.end(true); } catch { span.fail(); }
  }

  async #safeNetwork(name: string, callback: LifecycleCallbacks['onNetworkChange'], online: boolean, event: LifecycleEvent): Promise<void> {
    if (!callback) return;
    const span = this.observability.start('recovery', 0 as never, { operation: name, online });
    try { await callback(online, event); span.end(true); } catch { span.fail(); }
  }
}
