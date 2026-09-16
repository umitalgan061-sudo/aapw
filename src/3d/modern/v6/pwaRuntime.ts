/**
 * V6 browser/PWA lifecycle boundary.
 * Provides install/update/offline state, cache policy metadata and safe service
 * worker messaging without requiring a specific UI framework.
 */

export type Connectivity = 'online' | 'offline' | 'degraded';
export type UpdateState = 'unsupported' | 'idle' | 'checking' | 'available' | 'installing' | 'ready' | 'failed';
export type CacheClass = 'immutable' | 'versioned' | 'runtime' | 'ephemeral';

export interface PwaCapabilities {
  readonly serviceWorker: boolean;
  readonly cacheApi: boolean;
  readonly indexedDb: boolean;
  readonly broadcastChannel: boolean;
  readonly installPrompt: boolean;
  readonly share: boolean;
}

export interface CacheEntryPolicy {
  readonly key: string;
  readonly cache: CacheClass;
  readonly maxAgeSeconds: number;
  readonly maxBytes?: number;
  readonly staleWhileRevalidate: boolean;
  readonly critical: boolean;
}

export interface PwaState {
  readonly capabilities: PwaCapabilities;
  readonly connectivity: Connectivity;
  readonly updateState: UpdateState;
  readonly version: string;
  readonly installed: boolean;
  readonly updateError?: string;
}

export interface ServiceWorkerMessage {
  readonly type: 'PING' | 'SKIP_WAITING' | 'CACHE_WARM' | 'CACHE_CLEAR' | 'CLIENT_READY';
  readonly requestId: string;
  readonly payload?: Readonly<Record<string, string | number | boolean>>;
}

export interface ServiceWorkerReply {
  readonly requestId: string;
  readonly ok: boolean;
  readonly reason?: string;
}

export interface PwaEvent {
  readonly type: 'connectivity' | 'update' | 'install' | 'cache';
  readonly state: string;
  readonly tick: number;
}

function detectCapabilities(): PwaCapabilities {
  const scope = globalThis as typeof globalThis & { caches?: CacheStorage; indexedDB?: IDBFactory; BroadcastChannel?: typeof BroadcastChannel; onbeforeinstallprompt?: unknown; navigator?: Navigator };
  return {
    serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    cacheApi: typeof scope.caches !== 'undefined',
    indexedDb: typeof scope.indexedDB !== 'undefined',
    broadcastChannel: typeof scope.BroadcastChannel !== 'undefined',
    installPrompt: 'onbeforeinstallprompt' in scope,
    share: typeof navigator !== 'undefined' && typeof navigator.share === 'function',
  };
}

function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function safe(value: string, max = 128): string { return value.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max); }

export const DEFAULT_CACHE_POLICIES: readonly CacheEntryPolicy[] = [
  { key: '/src/', cache: 'versioned', maxAgeSeconds: 7 * 86400, staleWhileRevalidate: true, critical: true },
  { key: '/assets/', cache: 'immutable', maxAgeSeconds: 365 * 86400, maxBytes: 256 * 1024 * 1024, staleWhileRevalidate: false, critical: true },
  { key: '/fonts/', cache: 'immutable', maxAgeSeconds: 365 * 86400, maxBytes: 32 * 1024 * 1024, staleWhileRevalidate: false, critical: false },
  { key: '/api/', cache: 'runtime', maxAgeSeconds: 300, maxBytes: 16 * 1024 * 1024, staleWhileRevalidate: true, critical: false },
];

export class PwaRuntime {
  readonly #version: string;
  readonly #capabilities = detectCapabilities();
  readonly #listeners = new Set<(state: PwaState) => void>();
  readonly #events: PwaEvent[] = [];
  #connectivity: Connectivity = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online';
  #updateState: UpdateState = this.#capabilities.serviceWorker ? 'idle' : 'unsupported';
  #installed = false;
  #updateError?: string;
  #tick = 0;

  constructor(version: string) { this.#version = safe(version, 64) || 'v6'; }

  start(): PwaState {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.setConnectivity('online'));
      window.addEventListener('offline', () => this.setConnectivity('offline'));
      if (this.#capabilities.serviceWorker) void this.#bindServiceWorker();
    }
    return this.state();
  }

  state(): PwaState {
    return Object.freeze({
      capabilities: { ...this.#capabilities },
      connectivity: this.#connectivity,
      updateState: this.#updateState,
      version: this.#version,
      installed: this.#installed,
      updateError: this.#updateError,
    });
  }

  subscribe(listener: (state: PwaState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.state());
    return () => this.#listeners.delete(listener);
  }

  setTick(tick: number): void { this.#tick = Math.max(this.#tick, Math.floor(tick)); }

  setConnectivity(state: Connectivity): void {
    if (this.#connectivity === state) return;
    this.#connectivity = state;
    this.#emit({ type: 'connectivity', state, tick: this.#tick });
    this.#notify();
  }

  markInstalled(): void {
    this.#installed = true;
    this.#emit({ type: 'install', state: 'installed', tick: this.#tick });
    this.#notify();
  }

  async checkForUpdate(): Promise<PwaState> {
    if (!this.#capabilities.serviceWorker || typeof navigator === 'undefined') return this.state();
    this.#updateState = 'checking';
    this.#notify();
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        this.#updateState = 'failed';
        this.#updateError = 'service worker registration unavailable';
      } else {
        await registration.update();
        this.#updateState = registration.waiting ? 'available' : 'idle';
        this.#updateError = undefined;
      }
    } catch (error: unknown) {
      this.#updateState = 'failed';
      this.#updateError = safe(error instanceof Error ? error.message : String(error), 256);
    }
    this.#emit({ type: 'update', state: this.#updateState, tick: this.#tick });
    this.#notify();
    return this.state();
  }

  async applyUpdate(): Promise<boolean> {
    if (!this.#capabilities.serviceWorker || typeof navigator === 'undefined') return false;
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.waiting) return false;
    this.#updateState = 'installing';
    this.#notify();
    registration.waiting.postMessage({ type: 'SKIP_WAITING', requestId: `update-${this.#tick}` } satisfies ServiceWorkerMessage);
    this.#updateState = 'ready';
    this.#notify();
    return true;
  }

  async estimateStorage(): Promise<{ usageBytes: number; quotaBytes: number; ratio: number }> {
    if (typeof navigator === 'undefined' || !('storage' in navigator) || !navigator.storage?.estimate) return { usageBytes: 0, quotaBytes: 0, ratio: 0 };
    const estimate = await navigator.storage.estimate();
    const usageBytes = estimate.usage ?? 0;
    const quotaBytes = estimate.quota ?? 0;
    return { usageBytes, quotaBytes, ratio: quotaBytes > 0 ? clamp(usageBytes / quotaBytes, 0, 1) : 0 };
  }

  events(): readonly PwaEvent[] { return this.#events; }
  capabilities(): PwaCapabilities { return { ...this.#capabilities }; }

  async #bindServiceWorker(): Promise<void> {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return;
    if (registration.waiting) {
      this.#updateState = 'available';
      this.#notify();
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      this.#installed = true;
      this.#updateState = 'ready';
      this.#emit({ type: 'update', state: 'ready', tick: this.#tick });
      this.#notify();
    }, { once: false });
  }

  #emit(event: PwaEvent): void {
    this.#events.push(event);
    while (this.#events.length > 128) this.#events.shift();
  }

  #notify(): void { for (const listener of [...this.#listeners]) listener(this.state()); }
}

export function selectCachePolicy(url: string, policies: readonly CacheEntryPolicy[] = DEFAULT_CACHE_POLICIES): CacheEntryPolicy | undefined {
  return [...policies].sort((a, b) => b.key.length - a.key.length).find((policy) => url.includes(policy.key));
}

export function shouldCacheResponse(response: Response, policy: CacheEntryPolicy): boolean {
  if (!response.ok) return false;
  if (policy.cache === 'ephemeral') return false;
  const length = Number(response.headers.get('content-length') ?? 0);
  if (policy.maxBytes !== undefined && Number.isFinite(length) && length > policy.maxBytes) return false;
  return true;
}

export function buildWorkerMessage(type: ServiceWorkerMessage['type'], tick: number, payload?: Readonly<Record<string, string | number | boolean>>): ServiceWorkerMessage {
  return { type, requestId: `${type.toLowerCase()}-${Math.max(0, Math.floor(tick))}`, payload };
}
