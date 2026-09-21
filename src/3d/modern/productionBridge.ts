import type { ProductionRuntime } from './productionRuntime';
import type { RuntimeInputSource } from './runtimeContracts';

export interface RuntimeFrameEventDetail { readonly deltaMs: number; readonly timestamp: number; }
export interface RuntimeActionEventDetail { readonly type: string; readonly payload?: unknown; readonly source?: RuntimeInputSource; }

export interface ProductionBridgeOptions {
  readonly runtime: ProductionRuntime;
  readonly target?: EventTarget;
  readonly frameEvent?: string;
  readonly actionEvent?: string;
  readonly pauseEvent?: string;
  readonly resumeEvent?: string;
}

/**
 * Tiny browser event bridge used by the legacy JavaScript renderer. It keeps the actual game loop
 * independent from TypeScript implementation details while allowing the modern runtime to receive
 * the exact frame cadence and user intents. Every listener is removable.
 */
export class ProductionRuntimeBridge {
  readonly runtime: ProductionRuntime;
  readonly target: EventTarget;
  readonly frameEvent: string;
  readonly actionEvent: string;
  readonly pauseEvent: string;
  readonly resumeEvent: string;
  #disposers: Array<() => void> = [];
  #attached = false;

  constructor(options: ProductionBridgeOptions) {
    this.runtime = options.runtime;
    this.target = options.target ?? (typeof window !== 'undefined' ? window : new EventTarget());
    this.frameEvent = options.frameEvent ?? 'aapw-runtime-frame';
    this.actionEvent = options.actionEvent ?? 'aapw-runtime-action';
    this.pauseEvent = options.pauseEvent ?? 'aapw-runtime-pause';
    this.resumeEvent = options.resumeEvent ?? 'aapw-runtime-resume';
  }

  attach(): void {
    if (this.#attached) return;
    this.#attached = true;
    const onFrame = (event: Event): void => {
      const detail = (event as CustomEvent<RuntimeFrameEventDetail>).detail;
      const deltaMs = typeof detail?.deltaMs === 'number' ? detail.deltaMs : undefined;
      void this.runtime.frame(deltaMs);
    };
    const onAction = (event: Event): void => {
      const detail = (event as CustomEvent<RuntimeActionEventDetail>).detail;
      if (!detail || typeof detail.type !== 'string') return;
      this.runtime.dispatchAction({ type: detail.type, payload: detail.payload, source: detail.source === 'network' ? 'network' : detail.source === 'replay' ? 'replay' : detail.source === 'engine' ? 'engine' : 'ui' });
    };
    const onPause = (): void => { void this.runtime.pause('bridge'); };
    const onResume = (): void => { void this.runtime.resume('bridge'); };
    this.target.addEventListener(this.frameEvent, onFrame);
    this.target.addEventListener(this.actionEvent, onAction);
    this.target.addEventListener(this.pauseEvent, onPause);
    this.target.addEventListener(this.resumeEvent, onResume);
    this.#disposers.push(() => this.target.removeEventListener(this.frameEvent, onFrame), () => this.target.removeEventListener(this.actionEvent, onAction), () => this.target.removeEventListener(this.pauseEvent, onPause), () => this.target.removeEventListener(this.resumeEvent, onResume));
  }

  detach(): void {
    for (const dispose of this.#disposers.splice(0)) dispose();
    this.#attached = false;
  }

  get attached(): boolean { return this.#attached; }

  dispose(): void { this.detach(); }
}

export function createProductionRuntimeBridge(options: ProductionBridgeOptions): ProductionRuntimeBridge {
  const bridge = new ProductionRuntimeBridge(options);
  bridge.attach();
  return bridge;
}

export function dispatchRuntimeFrame(target: EventTarget, deltaMs: number): void {
  target.dispatchEvent(new CustomEvent<RuntimeFrameEventDetail>('aapw-runtime-frame', { detail: { deltaMs, timestamp: Date.now() } }));
}

export function dispatchRuntimeAction(target: EventTarget, type: string, payload?: unknown, source: RuntimeInputSource = 'programmatic'): void {
  target.dispatchEvent(new CustomEvent<RuntimeActionEventDetail>('aapw-runtime-action', { detail: { type, payload, source } }));
}

export function dispatchRuntimePause(target: EventTarget): void { target.dispatchEvent(new Event('aapw-runtime-pause')); }
export function dispatchRuntimeResume(target: EventTarget): void { target.dispatchEvent(new Event('aapw-runtime-resume')); }
