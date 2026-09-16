import { freeze } from '../domain/contracts.ts';

export type LifecycleState = 'initializing' | 'active' | 'background' | 'hidden' | 'suspended' | 'disposed';

export interface LifecycleSnapshot {
  readonly state: LifecycleState;
  readonly visible: boolean;
  readonly focused: boolean;
  readonly online: boolean;
  readonly standalone: boolean;
  readonly reducedMotion: boolean;
  readonly saveData: boolean;
  readonly timestamp: number;
}

export interface LifecycleHooks {
  readonly onActive?: (snapshot: LifecycleSnapshot) => void;
  readonly onBackground?: (snapshot: LifecycleSnapshot) => void;
  readonly onHidden?: (snapshot: LifecycleSnapshot) => void;
  readonly onOnline?: () => void;
  readonly onOffline?: () => void;
  readonly onDispose?: () => void;
}

const getSnapshot = (state: LifecycleState): LifecycleSnapshot => {
  const media = typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  const connection = typeof navigator !== 'undefined' ? (navigator as Navigator & { connection?: { saveData?: boolean } }).connection : undefined;
  return freeze({
    state,
    visible: typeof document === 'undefined' || document.visibilityState === 'visible',
    focused: typeof document === 'undefined' || document.hasFocus(),
    online: typeof navigator === 'undefined' || navigator.onLine,
    standalone: typeof window !== 'undefined' && ('standalone' in navigator ? Boolean((navigator as Navigator & { standalone?: boolean }).standalone) : window.matchMedia?.('(display-mode: standalone)').matches === true),
    reducedMotion: media,
    saveData: connection?.saveData === true,
    timestamp: Date.now(),
  });
};

export class BrowserLifecycle {
  #state: LifecycleState = 'initializing';
  readonly #hooks: LifecycleHooks;
  #cleanup: Array<() => void> = [];
  #started = false;

  constructor(hooks: LifecycleHooks = {}) { this.#hooks = hooks; }

  start(): LifecycleSnapshot {
    if (this.#started) return getSnapshot(this.#state);
    this.#started = true;
    if (typeof window === 'undefined') { this.#state = 'active'; return getSnapshot(this.#state); }
    const onVisibility = () => {
      this.#state = document.visibilityState === 'hidden' ? 'hidden' : 'active';
      const snapshot = getSnapshot(this.#state);
      if (this.#state === 'hidden') this.#hooks.onHidden?.(snapshot); else this.#hooks.onActive?.(snapshot);
    };
    const onFocus = () => { this.#state = 'active'; this.#hooks.onActive?.(getSnapshot(this.#state)); };
    const onBlur = () => { this.#state = 'background'; this.#hooks.onBackground?.(getSnapshot(this.#state)); };
    const onOnline = () => this.#hooks.onOnline?.();
    const onOffline = () => { this.#state = 'background'; this.#hooks.onOffline?.(); this.#hooks.onBackground?.(getSnapshot(this.#state)); };
    document.addEventListener('visibilitychange', onVisibility, { passive: true });
    window.addEventListener('focus', onFocus, { passive: true });
    window.addEventListener('blur', onBlur, { passive: true });
    window.addEventListener('online', onOnline, { passive: true });
    window.addEventListener('offline', onOffline, { passive: true });
    this.#cleanup.push(
      () => document.removeEventListener('visibilitychange', onVisibility),
      () => window.removeEventListener('focus', onFocus),
      () => window.removeEventListener('blur', onBlur),
      () => window.removeEventListener('online', onOnline),
      () => window.removeEventListener('offline', onOffline),
    );
    this.#state = document.visibilityState === 'hidden' ? 'hidden' : 'active';
    const snapshot = getSnapshot(this.#state);
    if (this.#state === 'hidden') this.#hooks.onHidden?.(snapshot); else this.#hooks.onActive?.(snapshot);
    return snapshot;
  }

  snapshot(): LifecycleSnapshot { return getSnapshot(this.#state); }

  suspend(): void { if (this.#state === 'disposed') return; this.#state = 'suspended'; this.#hooks.onBackground?.(this.snapshot()); }
  resume(): void { if (this.#state === 'disposed') return; this.#state = 'active'; this.#hooks.onActive?.(this.snapshot()); }

  dispose(): void {
    if (this.#state === 'disposed') return;
    this.#state = 'disposed';
    for (const cleanup of this.#cleanup.splice(0)) cleanup();
    this.#hooks.onDispose?.();
  }
}
