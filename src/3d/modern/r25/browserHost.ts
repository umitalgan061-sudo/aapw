import { RuntimeR25 } from './runtime.ts';
import {
  keyboardInput,
  pointerInput,
  type InputPhaseR25,
} from './inputIntent.ts';
import { createR25Renderer, type RendererBackendR25 } from './backend.ts';
import { MessageRateLimiterR25 } from './security.ts';

export interface BrowserHostR25Options {
  readonly canvas: HTMLCanvasElement;
  readonly runtime?: RuntimeR25;
  readonly legacyRuntime?: { readonly state: string; readonly tick: () => void | Promise<void> };
  readonly autoStart?: boolean;
  readonly keyboardTarget?: EventTarget;
  readonly pointerTarget?: EventTarget;
  readonly visibilityDocument?: Document;
  readonly windowTarget?: Window;
  readonly onSnapshot?: (snapshot: ReturnType<RuntimeR25['snapshot']>) => void;
  readonly onError?: (error: unknown) => void;
  readonly onRenderer?: (renderer: RendererBackendR25) => void;
  readonly enableRenderer?: boolean;
  readonly moduleLoader?: Parameters<typeof createR25Renderer>[0]['moduleLoader'];
}

export interface BrowserHostR25Snapshot {
  readonly running: boolean;
  readonly paused: boolean;
  readonly disposed: boolean;
  readonly frame: number;
  readonly rafHandle: number | null;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly rendererBackend: string | null;
  readonly lastSnapshot: ReturnType<RuntimeR25['snapshot']> | null;
  readonly keyboardEvents: number;
  readonly pointerEvents: number;
  readonly resizeEvents: number;
  readonly visibility: DocumentVisibilityState | 'unknown';
}

export interface BrowserHostR25 {
  readonly runtime: RuntimeR25;
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly pause: (reason?: string) => void;
  readonly resume: (reason?: string) => void;
  readonly resize: () => void;
  readonly snapshot: () => BrowserHostR25Snapshot;
  readonly dispose: () => Promise<void>;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function resolveNow(windowTarget?: Window): number {
  if (windowTarget?.performance?.now) return windowTarget.performance.now();
  if (typeof performance !== 'undefined') return performance.now();
  return Date.now();
}

export function createBrowserHostR25(
  options: BrowserHostR25Options,
): BrowserHostR25 {
  const runtime = options.runtime ?? new RuntimeR25();
  const keyboardTarget = options.keyboardTarget ?? (
    typeof window !== 'undefined' ? window : globalThis
  );
  const pointerTarget = options.pointerTarget ?? options.canvas;
  const visibilityDocument = options.visibilityDocument ?? (
    typeof document !== 'undefined' ? document : undefined
  );
  const windowTarget = options.windowTarget ?? (
    typeof window !== 'undefined' ? window : undefined
  );

  let running = false;
  let paused = false;
  let disposed = false;
  let rafHandle: number | null = null;
  let lastSnapshot: ReturnType<RuntimeR25['snapshot']> | null = null;
  let renderer: RendererBackendR25 | null = null;
  let keyboardEvents = 0;
  let pointerEvents = 0;
  let resizeEvents = 0;
  let visibility: DocumentVisibilityState | 'unknown' =
    visibilityDocument?.visibilityState ?? 'unknown';

  const subscriptions: Array<() => void> = [];
  const rateLimiter = new MessageRateLimiterR25(180);

  const onError = (error: unknown): void => {
    options.onError?.(error);
    console.error('[aapw/r25/browser]', error);
  };

  const listen = (
    target: EventTarget | undefined,
    type: string,
    listener: EventListener,
    optionsInit?: AddEventListenerOptions,
  ): void => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, listener, optionsInit);
    subscriptions.push(() => target.removeEventListener(type, listener, optionsInit));
  };

  const enqueueKey = (phase: InputPhaseR25) => (event: KeyboardEvent): void => {
    if (!rateLimiter.allow(resolveNow(windowTarget))) return;
    try {
      runtime.enqueueInput(
        keyboardInput(event.code, phase, resolveNow(windowTarget)),
      );
      keyboardEvents += 1;
    } catch (error) {
      onError(error);
    }
  };

  const enqueuePointer = (phase: InputPhaseR25) => (event: PointerEvent): void => {
    if (!rateLimiter.allow(resolveNow(windowTarget))) return;
    try {
      runtime.enqueueInput(
        pointerInput(event.button, phase, resolveNow(windowTarget)),
      );
      pointerEvents += 1;
    } catch (error) {
      onError(error);
    }
  };

  const onVisibility = (): void => {
    visibility = visibilityDocument?.visibilityState ?? 'unknown';
    if (visibility === 'hidden') {
      pause('visibility');
    } else {
      resume('visibility');
    }
  };

  const onResize = (): void => {
    resize();
  };

  async function frame(timestampMs: number): Promise<void> {
    if (!running || paused || disposed) return;

    const now = Math.max(0, finite(timestampMs, resolveNow(windowTarget)));
    try {
      const result = await runtime.tick(
        runtime.frame === 0
          ? runtime.clock.fixedStepMs()
          : Math.max(0.001, now - (lastSnapshot?.timestampMs ?? now - runtime.clock.fixedStepMs())),
      );

      lastSnapshot = result.snapshot;
      options.onSnapshot?.(result.snapshot);

      if (renderer) {
        const width = Math.max(1, options.canvas.clientWidth || options.canvas.width);
        const height = Math.max(1, options.canvas.clientHeight || options.canvas.height);
        renderer.resize(width, height, result.snapshot.profile.pixelRatio);
      }

      rafHandle = windowTarget?.requestAnimationFrame
        ? windowTarget.requestAnimationFrame((next) => {
            void frame(next);
          })
        : null;
    } catch (error) {
      running = false;
      rafHandle = null;
      onError(error);
    }
  }

  function resize(): void {
    const rect = options.canvas.getBoundingClientRect();
    const width = Math.max(
      1,
      Math.round(rect.width || windowTarget?.innerWidth || options.canvas.width || 1),
    );
    const height = Math.max(
      1,
      Math.round(rect.height || windowTarget?.innerHeight || options.canvas.height || 1),
    );
    const dpr = Math.min(
      3,
      Math.max(0.75, finite(windowTarget?.devicePixelRatio, 1)),
    );

    options.canvas.width = Math.max(1, Math.round(width * dpr));
    options.canvas.height = Math.max(1, Math.round(height * dpr));
    options.canvas.style.width = `${width}px`;
    options.canvas.style.height = `${height}px`;
    resizeEvents += 1;

    renderer?.resize(width, height, runtime.snapshot().profile.pixelRatio);
  }

  async function start(): Promise<void> {
    if (disposed) throw new Error('R25_BROWSER_HOST_DISPOSED');
    if (running && !paused) return;

    resize();
    await runtime.start();

    if (
      options.enableRenderer !== false &&
      !renderer &&
      options.moduleLoader
    ) {
      renderer = await createR25Renderer({
        canvas: options.canvas,
        profile: runtime.snapshot().profile,
        capabilities: runtime.capabilities,
        moduleLoader: options.moduleLoader,
      });
      options.onRenderer?.(renderer);
    }

    if (options.legacyRuntime) {
      runtime.attachLegacyTick(async () => {
        const legacyState = options.legacyRuntime;
        if (legacyState.state === 'running') {
          await legacyState.tick();
        }
      });
    }

    running = true;
    paused = false;
    const now = resolveNow(windowTarget);
    lastSnapshot = runtime.snapshot();

    if (windowTarget?.requestAnimationFrame) {
      rafHandle = windowTarget.requestAnimationFrame((timestamp) => {
        void frame(timestamp);
      });
    } else {
      await frame(now);
    }
  }

  async function stop(): Promise<void> {
    if (rafHandle !== null && windowTarget?.cancelAnimationFrame) {
      windowTarget.cancelAnimationFrame(rafHandle);
    }
    rafHandle = null;
    running = false;
    paused = false;
    await runtime.stop();
  }

  function pause(reason = 'manual'): void {
    if (!running) return;
    paused = true;
    runtime.pause();
    if (rafHandle !== null && windowTarget?.cancelAnimationFrame) {
      windowTarget.cancelAnimationFrame(rafHandle);
    }
    rafHandle = null;
    options.onSnapshot?.(runtime.snapshot());
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-aapw-r25-paused', reason);
    }
  }

  function resume(reason = 'manual'): void {
    if (!running || disposed) return;
    paused = false;
    runtime.resume();
    if (typeof document !== 'undefined') {
      document.documentElement.removeAttribute('data-aapw-r25-paused');
    }
    if (windowTarget?.requestAnimationFrame && rafHandle === null) {
      rafHandle = windowTarget.requestAnimationFrame((timestamp) => {
        void frame(timestamp);
      });
    }
    void reason;
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;

    for (const unsubscribe of subscriptions.splice(0)) unsubscribe();

    if (rafHandle !== null && windowTarget?.cancelAnimationFrame) {
      windowTarget.cancelAnimationFrame(rafHandle);
    }
    rafHandle = null;

    renderer?.dispose();
    renderer = null;
    await runtime.stop();
    runtime.dispose();
  }

  listen(keyboardTarget, 'keydown', enqueueKey('pressed') as EventListener, { passive: false });
  listen(keyboardTarget, 'keyup', enqueueKey('released') as EventListener, { passive: false });
  listen(pointerTarget, 'pointerdown', enqueuePointer('pressed') as EventListener, { passive: true });
  listen(pointerTarget, 'pointerup', enqueuePointer('released') as EventListener, { passive: true });
  listen(visibilityDocument, 'visibilitychange', onVisibility as EventListener, { passive: true });
  listen(windowTarget, 'resize', onResize as EventListener, { passive: true });

  const host: BrowserHostR25 = freeze({
    runtime,
    start,
    stop,
    pause,
    resume,
    resize,
    snapshot: () => {
      const rect = options.canvas.getBoundingClientRect();
      return freeze({
        running,
        paused,
        disposed,
        frame: runtime.frame,
        rafHandle,
        width: Math.max(1, Math.round(rect.width || options.canvas.width || 1)),
        height: Math.max(1, Math.round(rect.height || options.canvas.height || 1)),
        dpr: Math.min(3, Math.max(0.75, finite(windowTarget?.devicePixelRatio, 1))),
        rendererBackend: renderer?.backend ?? null,
        lastSnapshot,
        keyboardEvents,
        pointerEvents,
        resizeEvents,
        visibility,
      });
    },
    dispose,
  });

  if (options.autoStart) {
    void start().catch(onError);
  }

  return host;
}

