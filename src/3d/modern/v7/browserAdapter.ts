import { chooseDeviceProfile, type DeviceProfile } from './rendererAdapter.js';
import { clamp, type Disposable } from './primitives.js';

export interface BrowserLifecycleState { readonly visible: boolean; readonly online: boolean; readonly pageHiddenAt: number | null; readonly reducedMotion: boolean; readonly saveData: boolean; readonly hardwareConcurrency: number; }
export interface BrowserCapabilities extends DeviceProfile { readonly workers: boolean; readonly offscreenCanvas: boolean; readonly indexedDb: boolean; readonly serviceWorker: boolean; readonly broadcastChannel: boolean; readonly webTransport: boolean; readonly touch: boolean; readonly dpr: number; readonly memoryGb: number | null; }
export interface BrowserAdapterOptions { readonly windowTarget?: EventTarget; readonly now?: () => number; }

export class BrowserRuntimeAdapter implements Disposable {
  readonly capabilities: BrowserCapabilities; #state: BrowserLifecycleState; #target: EventTarget | null; #now: () => number; #listeners: Array<() => void> = []; #disposed = false;
  constructor(options: BrowserAdapterOptions = {}) {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined; const win = typeof window !== 'undefined' ? window : undefined; const profile = chooseDeviceProfile(); const connection = nav && 'connection' in nav ? (nav as Navigator & { connection?: { saveData?: boolean } }).connection : undefined;
    this.capabilities = Object.freeze({ ...profile, workers: typeof Worker !== 'undefined', offscreenCanvas: typeof OffscreenCanvas !== 'undefined', indexedDb: typeof indexedDB !== 'undefined', serviceWorker: Boolean(nav?.serviceWorker), broadcastChannel: typeof BroadcastChannel !== 'undefined', webTransport: typeof WebTransport !== 'undefined', touch: Number(nav?.maxTouchPoints ?? 0) > 0, dpr: typeof devicePixelRatio === 'number' ? clamp(devicePixelRatio, .5, 4) : 1, memoryGb: nav && 'deviceMemory' in nav ? (Number((nav as Navigator & { deviceMemory?: number }).deviceMemory) || null) : null });
    this.#state = Object.freeze({ visible: typeof document === 'undefined' ? true : document.visibilityState !== 'hidden', online: typeof navigator === 'undefined' ? true : navigator.onLine !== false, pageHiddenAt: null, reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, saveData: Boolean(connection?.saveData), hardwareConcurrency: Math.max(1, Math.trunc(nav?.hardwareConcurrency ?? 4)) }); this.#target = options.windowTarget ?? win ?? null; this.#now = options.now ?? (() => typeof performance !== 'undefined' ? performance.now() : Date.now());
  }
  attach(): () => void {
    if (this.#disposed || !this.#target) return () => undefined; const target = this.#target; const onVisibility = () => { const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden'; this.#state = Object.freeze({ ...this.#state, visible, pageHiddenAt: visible ? null : this.#now() }); }; const onOnline = () => { this.#state = Object.freeze({ ...this.#state, online: true }); }; const onOffline = () => { this.#state = Object.freeze({ ...this.#state, online: false }); }; const onPageHide = () => { this.#state = Object.freeze({ ...this.#state, visible: false, pageHiddenAt: this.#now() }); }; target.addEventListener('visibilitychange', onVisibility); target.addEventListener('online', onOnline); target.addEventListener('offline', onOffline); target.addEventListener('pagehide', onPageHide); const detach = () => { target.removeEventListener('visibilitychange', onVisibility); target.removeEventListener('online', onOnline); target.removeEventListener('offline', onOffline); target.removeEventListener('pagehide', onPageHide); }; this.#listeners.push(detach); return detach;
  }
  state(): BrowserLifecycleState { return this.#state; }
  shouldRender(): boolean { return this.#state.visible && !this.#state.saveData; }
  recommendedWorkers(): number { const cpu = this.#state.hardwareConcurrency; const memory = this.capabilities.memoryGb ?? 4; return clamp(Math.trunc(Math.min(cpu - 1, memory * 2)), 1, 8); }
  recommendedResolutionScale(): number { if (this.#state.saveData || this.#state.reducedMotion) return .75; if (this.capabilities.dpr > 2) return .8; return this.capabilities.backend === 'webgpu' ? 1 : .9; }
  dispose(): void { this.#disposed = true; for (const detach of this.#listeners.splice(0)) detach(); this.#target = null; }
}
