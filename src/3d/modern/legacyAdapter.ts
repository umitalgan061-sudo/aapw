import type { InputAction, QualityTier, RuntimeSnapshot } from './types';
import { checksum } from './deterministic';
import { TypedEventBus } from './eventBus';
import { ModernStateStore } from './stateStore';
import { RuntimeKernel, type KernelFrameInput } from './runtimeKernel';

export interface LegacyEventSource {
  on?: (event: string, listener: (payload?: unknown) => void) => (() => void) | void;
  emit?: (event: string, payload?: unknown) => void;
}

export interface LegacyValueReader {
  get?: (key: string) => unknown;
  set?: (key: string, value: unknown) => void;
}

export interface LegacyAdapterOptions {
  readonly kernel: RuntimeKernel;
  readonly source?: LegacyEventSource;
  readonly state?: LegacyValueReader;
  readonly modernState?: ModernStateStore;
  readonly maxMirrors?: number;
}

export interface AdapterSnapshot {
  readonly connected: boolean;
  readonly mirroredKeys: number;
  readonly bridgedEvents: number;
  readonly lastRuntimeFrame: number;
  readonly lastQuality: QualityTier;
  readonly digest: string;
}

/**
 * Incremental compatibility adapter. It only mirrors stable primitive state and semantic actions;
 * no Three.js object or mutable scene reference crosses the migration boundary.
 */
export class LegacyRuntimeAdapter {
  readonly kernel: RuntimeKernel;
  readonly state: ModernStateStore;
  readonly events = new TypedEventBus<LegacyAdapterEvents>({ maxListeners: 128 });

  #source: LegacyEventSource;
  #legacyState: LegacyValueReader;
  #connected = false;
  #maxMirrors: number;
  #mirrors = new Map<string, string>();
  #unsubscribers: Array<() => void> = [];
  #bridgedEvents = 0;
  #lastRuntimeFrame = 0;
  #lastQuality: QualityTier;

  constructor(options: LegacyAdapterOptions) {
    this.kernel = options.kernel;
    this.state = options.modernState ?? new ModernStateStore();
    this.#source = options.source ?? {};
    this.#legacyState = options.state ?? {};
    this.#maxMirrors = Math.max(16, Math.min(512, Math.floor(options.maxMirrors ?? 128)));
    this.#lastQuality = this.kernel.quality.tier;
  }

  connect(): void {
    if (this.#connected) return;
    this.#connected = true;
    this.#bindLegacyEvent('quality:changed', (payload) => this.#onLegacyQuality(payload));
    this.#bindLegacyEvent('input:action', (payload) => this.#onLegacyInput(payload));
    this.#bindLegacyEvent('runtime:pause', () => this.kernel.stop());
    this.#bindLegacyEvent('runtime:resume', () => this.kernel.start());
    this.kernel.events.on('render:quality-changed', (change) => {
      this.#lastQuality = change.next;
      this.state.set('quality', change.next);
      this.#mirror('renderQuality', change.next);
    });
    this.kernel.events.on('runtime:frame', (frame) => {
      this.#lastRuntimeFrame = Number(frame.frame);
      this.#mirror('runtimeFrame', this.#lastRuntimeFrame);
      this.#mirror('runtimeWeather', frame.weather);
    });
    this.kernel.events.on('kernel:error', (error) => {
      this.#mirror('runtimeError', error.message);
      this.events.emit('adapter:error', error);
    });
    this.events.emit('adapter:connected', this.snapshot());
  }

  disconnect(): void {
    for (const remove of this.#unsubscribers.splice(0).reverse()) remove();
    this.#connected = false;
    this.events.emit('adapter:disconnected', this.snapshot());
  }

  mirror(legacyKey: string, modernKey: string): boolean {
    if (!legacyKey || !modernKey || this.#mirrors.size >= this.#maxMirrors) return false;
    this.#mirrors.set(legacyKey, modernKey);
    const value = this.state.get(modernKey as never);
    if (value !== undefined) this.#legacyState.set?.(legacyKey, value);
    return true;
  }

  async frame(input: KernelFrameInput): Promise<RuntimeSnapshot> {
    const result = await this.kernel.tick(input);
    this.#syncState(result.snapshot);
    return result.snapshot;
  }

  pushAction(action: InputAction): boolean {
    return this.kernel.input.push(action);
  }

  snapshot(): AdapterSnapshot {
    return Object.freeze({
      connected: this.#connected,
      mirroredKeys: this.#mirrors.size,
      bridgedEvents: this.#bridgedEvents,
      lastRuntimeFrame: this.#lastRuntimeFrame,
      lastQuality: this.#lastQuality,
      digest: checksum({ connected: this.#connected, mirrors: [...this.#mirrors], events: this.#bridgedEvents, frame: this.#lastRuntimeFrame, quality: this.#lastQuality }),
    });
  }

  #bindLegacyEvent(name: string, listener: (payload?: unknown) => void): void {
    const remove = this.#source.on?.(name, (payload) => {
      this.#bridgedEvents += 1;
      listener(payload);
    });
    if (typeof remove === 'function') this.#unsubscribers.push(remove);
  }

  #onLegacyQuality(payload: unknown): void {
    const quality = payload && typeof payload === 'object' && 'quality' in payload ? (payload as { quality?: unknown }).quality : payload;
    if (quality === 'minimal' || quality === 'balanced' || quality === 'high' || quality === 'ultra') this.kernel.quality.force(quality);
  }

  #onLegacyInput(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const input = payload as Partial<InputAction>;
    if (typeof input.action !== 'string' || typeof input.value !== 'number') return;
    if (input.source !== 'keyboard' && input.source !== 'pointer' && input.source !== 'touch' && input.source !== 'gamepad' && input.source !== 'virtual') return;
    this.pushAction({ action: input.action, value: input.value, source: input.source, timestamp: input.timestamp });
  }

  #syncState(snapshot: RuntimeSnapshot): void {
    this.state.patch({
      quality: snapshot.quality,
      backend: snapshot.backend,
      fps: snapshot.frame > 0 ? Number((snapshot.frame / Math.max(0.001, Number(snapshot.timestamp) / 1000)).toFixed(2)) : 60,
      frameMs: snapshot.metrics.find((metric) => metric.name === 'frame.ms')?.value ?? 16.67,
    });
    this.#mirror('renderQuality', snapshot.quality);
    this.#mirror('renderBackend', snapshot.backend);
    this.#mirror('renderPressure', snapshot.pressure.combined);
    this.#mirror('renderScale', snapshot.metrics.find((metric) => metric.name === 'render.scale')?.value ?? 1);
  }

  #mirror(legacyKey: string, value: unknown): void {
    if (this.#mirrors.has(legacyKey) || this.#mirrors.size < this.#maxMirrors) this.#legacyState.set?.(legacyKey, value);
  }
}

export interface LegacyAdapterEvents {
  readonly 'adapter:connected': AdapterSnapshot;
  readonly 'adapter:disconnected': AdapterSnapshot;
  readonly 'adapter:error': { readonly code: string; readonly message: string; readonly retryable: boolean };
}

export function createLegacyRuntimeAdapter(options: LegacyAdapterOptions): LegacyRuntimeAdapter {
  const adapter = new LegacyRuntimeAdapter(options);
  adapter.connect();
  return adapter;
}
