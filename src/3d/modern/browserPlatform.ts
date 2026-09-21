import type { RenderBackend, Result, UnixMillis } from './types';
import { clampFinite } from './runtimeContracts';

export type BrowserFeature =
  | 'webgpu'
  | 'webgl2'
  | 'offscreenCanvas'
  | 'sharedArrayBuffer'
  | 'webWorker'
  | 'serviceWorker'
  | 'indexedDb'
  | 'broadcastChannel'
  | 'gamepad'
  | 'touch'
  | 'deviceMemory'
  | 'connectionHints';

export interface BrowserCapabilities {
  readonly secureContext: boolean;
  readonly features: Readonly<Record<BrowserFeature, boolean>>;
  readonly rendererOrder: readonly RenderBackend[];
  readonly deviceMemoryGb: number | null;
  readonly hardwareConcurrency: number;
  readonly reducedMotion: boolean;
  readonly saveData: boolean;
  readonly connectionType: string | null;
  readonly viewport: { readonly width: number; readonly height: number; readonly dpr: number };
}

export interface BrowserCapabilityOptions {
  readonly navigatorObject?: Navigator;
  readonly windowObject?: Window;
  readonly documentObject?: Document;
}

function has(value: unknown): boolean {
  return Boolean(value);
}

/** Pure feature probe; safe to run in workers and headless test environments. */
export function detectBrowserCapabilities(options: BrowserCapabilityOptions = {}): BrowserCapabilities {
  const nav = options.navigatorObject ?? (typeof navigator !== 'undefined' ? navigator : undefined);
  const win = options.windowObject ?? (typeof window !== 'undefined' ? window : undefined);
  const doc = options.documentObject ?? (typeof document !== 'undefined' ? document : undefined);
  const connection = nav && 'connection' in nav ? (nav as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection : undefined;
  const memory = nav && 'deviceMemory' in nav ? Number((nav as Navigator & { deviceMemory?: number }).deviceMemory) : NaN;
  const features: Record<BrowserFeature, boolean> = {
    webgpu: has(nav?.gpu),
    webgl2: Boolean(doc?.createElement('canvas').getContext?.('webgl2')),
    offscreenCanvas: has((win as Window & { OffscreenCanvas?: unknown } | undefined)?.OffscreenCanvas),
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined' && Boolean((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated),
    webWorker: typeof Worker !== 'undefined',
    serviceWorker: Boolean(nav?.serviceWorker),
    indexedDb: typeof indexedDB !== 'undefined',
    broadcastChannel: typeof BroadcastChannel !== 'undefined',
    gamepad: Boolean(nav?.getGamepads),
    touch: Boolean(nav?.maxTouchPoints && nav.maxTouchPoints > 0),
    deviceMemory: Number.isFinite(memory) && memory > 0,
    connectionHints: Boolean(connection),
  };
  const reducedMotion = Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const width = Math.max(1, win?.innerWidth ?? 1280);
  const height = Math.max(1, win?.innerHeight ?? 720);
  const dpr = clampFinite(win?.devicePixelRatio ?? 1, 1, 4, 1);
  const rendererOrder: RenderBackend[] = features.webgpu ? ['webgpu', 'webgl2', 'headless'] : features.webgl2 ? ['webgl2', 'headless'] : ['headless'];
  return Object.freeze({
    secureContext: Boolean(win?.isSecureContext ?? (globalThis as { isSecureContext?: boolean }).isSecureContext),
    features: Object.freeze(features),
    rendererOrder: Object.freeze(rendererOrder),
    deviceMemoryGb: features.deviceMemory ? memory : null,
    hardwareConcurrency: Math.max(1, Math.min(64, Math.trunc(nav?.hardwareConcurrency ?? 4))),
    reducedMotion,
    saveData: Boolean(connection?.saveData),
    connectionType: connection?.effectiveType ?? null,
    viewport: Object.freeze({ width, height, dpr }),
  });
}

export interface LifecycleEvent {
  readonly type: 'visible' | 'hidden' | 'pagehide' | 'pageshow' | 'online' | 'offline' | 'freeze' | 'resume';
  readonly timestamp: UnixMillis;
  readonly persisted: boolean;
}

export interface LifecycleControllerOptions {
  readonly target?: EventTarget;
  readonly now?: () => UnixMillis;
  readonly onEvent?: (event: LifecycleEvent) => void;
}

/** Central lifecycle controller that translates browser signals into one debounced stream. */
export class BrowserLifecycleController {
  #target?: EventTarget;
  #now: () => UnixMillis;
  #onEvent?: (event: LifecycleEvent) => void;
  #disposers: Array<() => void> = [];
  #lastType: string | null = null;
  #running = false;

  constructor(options: LifecycleControllerOptions = {}) {
    this.#target = options.target ?? (typeof window !== 'undefined' ? window : undefined);
    this.#now = options.now ?? (() => Date.now() as UnixMillis);
    this.#onEvent = options.onEvent;
  }

  start(): void {
    if (this.#running || !this.#target) return;
    this.#running = true;
    this.#bind('visibilitychange', () => {
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      this.#emit(hidden ? 'hidden' : 'visible', false);
    });
    this.#bind('pagehide', (event) => this.#emit('pagehide', Boolean((event as PageTransitionEvent).persisted)));
    this.#bind('pageshow', (event) => this.#emit('pageshow', Boolean((event as PageTransitionEvent).persisted)));
    this.#bind('online', () => this.#emit('online', false));
    this.#bind('offline', () => this.#emit('offline', false));
    this.#bind('freeze', () => this.#emit('freeze', false));
    this.#bind('resume', () => this.#emit('resume', false));
  }

  stop(): void {
    for (const dispose of this.#disposers.splice(0)) dispose();
    this.#running = false;
    this.#lastType = null;
  }

  get running(): boolean { return this.#running; }

  #bind(type: string, listener: EventListener): void {
    this.#target?.addEventListener(type, listener);
    this.#disposers.push(() => this.#target?.removeEventListener(type, listener));
  }

  #emit(type: LifecycleEvent['type'], persisted: boolean): void {
    if (type === this.#lastType && type !== 'visible' && type !== 'hidden') return;
    this.#lastType = type;
    this.#onEvent?.(Object.freeze({ type, timestamp: this.#now(), persisted }));
  }
}

export interface NetworkState {
  readonly online: boolean;
  readonly effectiveType: string | null;
  readonly downlinkMbps: number | null;
  readonly rttMs: number | null;
  readonly saveData: boolean;
}

export function readNetworkState(navigatorObject?: Navigator): NetworkState {
  const nav = navigatorObject ?? (typeof navigator !== 'undefined' ? navigator : undefined);
  const connection = nav && 'connection' in nav ? (nav as Navigator & { connection?: { saveData?: boolean; effectiveType?: string; downlink?: number; rtt?: number } }).connection : undefined;
  return Object.freeze({
    online: nav?.onLine ?? true,
    effectiveType: connection?.effectiveType ?? null,
    downlinkMbps: Number.isFinite(connection?.downlink) ? Number(connection?.downlink) : null,
    rttMs: Number.isFinite(connection?.rtt) ? Number(connection?.rtt) : null,
    saveData: Boolean(connection?.saveData),
  });
}

export interface InstallPromptController {
  readonly canPrompt: boolean;
  prompt(): Promise<boolean>;
  dismiss(): void;
}

interface BeforeInstallPromptEventLike extends Event {
  prompt(): Promise<unknown>;
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** PWA install prompt adapter that does nothing outside Chromium-style install events. */
export class BrowserInstallPrompt implements InstallPromptController {
  #event: BeforeInstallPromptEventLike | null = null;
  #target: EventTarget;
  #bound: (event: Event) => void;

  constructor(target: EventTarget = typeof window !== 'undefined' ? window : new EventTarget()) {
    this.#target = target;
    this.#bound = (event) => {
      event.preventDefault();
      this.#event = event as BeforeInstallPromptEventLike;
    };
    this.#target.addEventListener('beforeinstallprompt', this.#bound);
  }

  get canPrompt(): boolean { return this.#event !== null; }

  async prompt(): Promise<boolean> {
    const event = this.#event;
    if (!event) return false;
    this.#event = null;
    await event.prompt();
    const choice = await event.userChoice;
    return choice?.outcome === 'accepted';
  }

  dismiss(): void { this.#event = null; }

  dispose(): void { this.#target.removeEventListener('beforeinstallprompt', this.#bound); this.#event = null; }
}

export interface VisibilityLock {
  readonly acquired: boolean;
  release(): void;
}

/** Prevents accidental duplicate fullscreen/pointer-lock operations during transitions. */
export class AsyncTransitionGate {
  #busy = false;

  acquire(): VisibilityLock {
    if (this.#busy) return { acquired: false, release: () => undefined };
    this.#busy = true;
    let released = false;
    return { acquired: true, release: () => { if (!released) { released = true; this.#busy = false; } } };
  }

  get busy(): boolean { return this.#busy; }
}

export interface ServiceWorkerRegistrationOptions {
  readonly scriptUrl?: string;
  readonly scope?: string;
  readonly targetNavigator?: Navigator;
}

export async function registerServiceWorker(options: ServiceWorkerRegistrationOptions = {}): Promise<Result<ServiceWorkerRegistration | null>> {
  const nav = options.targetNavigator ?? (typeof navigator !== 'undefined' ? navigator : undefined);
  if (!nav?.serviceWorker) return { ok: true, value: null };
  try {
    const registration = await nav.serviceWorker.register(options.scriptUrl ?? './sw.js', options.scope ? { scope: options.scope } : undefined);
    return { ok: true, value: registration };
  } catch (cause) {
    return { ok: false, error: { code: 'SERVICE_WORKER_REGISTER_FAILED', message: String(cause), retryable: true, cause } };
  }
}

export function chooseBackend(capabilities: BrowserCapabilities): RenderBackend {
  return capabilities.rendererOrder[0] ?? 'headless';
}
