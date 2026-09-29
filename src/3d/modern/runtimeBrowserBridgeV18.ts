/**
 * AAPW Browser Runtime Bridge V18.
 *
 * Browser-only composition adapter for RuntimeApplication.
 * It owns DOM event translation and the requestAnimationFrame lifecycle while
 * keeping simulation, world, assets, persistence and rendering policies DOM-free.
 */

import {
  RuntimeApplication,
  type RuntimeApplicationSnapshotV18,
} from './runtimeApplicationV18';
import type { InputCommandV18, InputPhaseV18 } from './inputPipelineV18';

export interface BrowserRuntimeBridgeOptionsV18 {
  readonly runtime?: RuntimeApplication;
  readonly canvas: HTMLCanvasElement;
  readonly loadingElement?: HTMLElement;
  readonly keyboardTarget?: EventTarget;
  readonly pointerTarget?: EventTarget;
  readonly visibilityDocument?: Document;
  readonly windowTarget?: Window;
  readonly autoStart?: boolean;
  readonly preventDefaultCodes?: readonly string[];
  readonly onSnapshot?: (snapshot: RuntimeApplicationSnapshotV18) => void;
  readonly onError?: (error: unknown) => void;
}

export interface BrowserRuntimeBridgeSnapshotV18 {
  readonly running: boolean;
  readonly paused: boolean;
  readonly frameHandle: number | null;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly lastTimestampMs: number | null;
  readonly lastSnapshot: RuntimeApplicationSnapshotV18 | null;
  readonly inputCommands: number;
  readonly resizeCount: number;
  readonly visibility: DocumentVisibilityState | 'unknown';
}

export interface BrowserRuntimeBridgeV18 {
  readonly runtime: RuntimeApplication;
  start(): Promise<void>;
  stop(): Promise<void>;
  pause(reason?: string): void;
  resume(reason?: string): void;
  dispose(): Promise<void>;
  snapshot(): BrowserRuntimeBridgeSnapshotV18;
  resize(): void;
  enqueueKeyboard(code: string, phase: InputPhaseV18): InputCommandV18 | null;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function finite(value: number | undefined | null, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function resolveNow(target: Window | undefined): number {
  return finite(target?.performance?.now?.(), performance.now());
}

function isHTMLElement(value: unknown): value is HTMLElement {
  return typeof HTMLElement !== 'undefined' && value instanceof HTMLElement;
}

const DEFAULT_PREVENT_CODES = Object.freeze([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

export function createBrowserRuntimeBridgeV18(
  options: BrowserRuntimeBridgeOptionsV18,
): BrowserRuntimeBridgeV18 {
  const runtime = options.runtime ?? new RuntimeApplication();
  const keyboardTarget = options.keyboardTarget ?? globalThis;
  const pointerTarget = options.pointerTarget ?? options.canvas;
  const visibilityDocument = options.visibilityDocument ??
    (typeof document === 'undefined' ? undefined : document);
  const windowTarget = options.windowTarget ??
    (typeof window === 'undefined' ? undefined : window);
  const preventCodes = new Set(
    options.preventDefaultCodes ?? DEFAULT_PREVENT_CODES,
  );

  let running = false;
  let paused = false;
  let frameHandle: number | null = null;
  let lastTimestampMs: number | null = null;
  let lastSnapshot: RuntimeApplicationSnapshotV18 | null = null;
  let inputCommands = 0;
  let resizeCount = 0;
  let disposed = false;
  let visibility: DocumentVisibilityState | 'unknown' =
    visibilityDocument?.visibilityState ?? 'unknown';

  const subscriptions: Array<() => void> = [];
  let resizeObserver: ResizeObserver | null = null;

  const onError = (error: unknown): void => {
    options.onError?.(error);
    console.error('[aapw/runtime-v18]', error);
  };

  const handleKeyboard = (phase: InputPhaseV18) => (event: KeyboardEvent): void => {
    if (preventCodes.has(event.code)) {
      event.preventDefault();
    }

    try {
      const command = runtime.inputFromKeyboard(event.code, phase);
      if (command) inputCommands += 1;
    } catch (error) {
      onError(error);
    }
  };

  const handlePointer = (phase: InputPhaseV18) => (event: PointerEvent): void => {
    try {
      const command = runtime.inputFromPointer(event.button, phase);
      if (command) inputCommands += 1;
    } catch (error) {
      onError(error);
    }
  };

  const handleTouch = (event: TouchEvent): void => {
    const touch = event.changedTouches[0];
    if (!touch) return;

    const rect = options.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const x = (touch.clientX - rect.left) / width * 2 - 1;
    const y = 1 - (touch.clientY - rect.top) / height * 2;

    try {
      runtime.enqueueTouch(x, y, 1, resolveNow(windowTarget));
      inputCommands += 1;
    } catch (error) {
      onError(error);
    }
  };

  const handleVisibility = (): void => {
    visibility = visibilityDocument?.visibilityState ?? 'unknown';

    if (visibility === 'hidden') {
      pause('visibility');
    } else {
      resume('visibility');
    }
  };

  const handleResize = (): void => {
    resize();
  };

  function publish(snapshot: RuntimeApplicationSnapshotV18): void {
    lastSnapshot = snapshot;
    options.onSnapshot?.(snapshot);
    if (isHTMLElement(options.loadingElement)) {
      options.loadingElement.hidden = false;
      options.loadingElement.setAttribute(
        'data-runtime-frame',
        String(snapshot.frame),
      );

      if (snapshot.state === 'running') {
        options.loadingElement.classList.add('g3d-loading-hidden');
      }
    }
  }

  async function frame(timestampMs: number): Promise<void> {
    if (!running || paused || disposed) return;

    const now = finite(timestampMs, resolveNow(windowTarget));

    try {
      publish(await runtime.tick(now));
      lastTimestampMs = now;
    } catch (error) {
      running = false;
      frameHandle = null;
      onError(error);
      return;
    }

    if (running && !paused && !disposed) {
      frameHandle = windowTarget?.requestAnimationFrame
        ? windowTarget.requestAnimationFrame((next) => {
            void frame(next);
          })
        : null;
    }
  }

  function listen(
    target: EventTarget | undefined,
    type: string,
    listener: EventListener,
    optionsInit?: AddEventListenerOptions,
  ): void {
    if (!target?.addEventListener) return;
    target.addEventListener(type, listener, optionsInit);
    subscriptions.push(() => {
      target.removeEventListener(type, listener, optionsInit);
    });
  }

  function installListeners(): void {
    listen(keyboardTarget, 'keydown', handleKeyboard('pressed') as EventListener, { passive: false });
    listen(keyboardTarget, 'keyup', handleKeyboard('released') as EventListener, { passive: false });
    listen(pointerTarget, 'pointerdown', handlePointer('pressed') as EventListener, { passive: true });
    listen(pointerTarget, 'pointerup', handlePointer('released') as EventListener, { passive: true });
    listen(pointerTarget, 'touchstart', handleTouch as EventListener, { passive: true });
    listen(visibilityDocument, 'visibilitychange', handleVisibility as EventListener, { passive: true });
    listen(windowTarget, 'resize', handleResize as EventListener, { passive: true });

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(options.canvas);
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
      Math.max(1, finite(windowTarget?.devicePixelRatio, 1)),
    );

    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    if (options.canvas.width !== pixelWidth) {
      options.canvas.width = pixelWidth;
    }
    if (options.canvas.height !== pixelHeight) {
      options.canvas.height = pixelHeight;
    }

    options.canvas.style.width = `${width}px`;
    options.canvas.style.height = `${height}px`;
    resizeCount += 1;
  }

  async function start(): Promise<void> {
    if (disposed) throw new Error('Browser runtime bridge is disposed.');
    if (running && !paused) return;

    resize();
    await runtime.start();
    running = true;
    paused = false;
    lastTimestampMs = resolveNow(windowTarget);

    if (frameHandle === null && windowTarget?.requestAnimationFrame) {
      frameHandle = windowTarget.requestAnimationFrame((timestamp) => {
        void frame(timestamp);
      });
    } else if (frameHandle === null) {
      publish(await runtime.tick(lastTimestampMs));
    }
  }

  async function stop(): Promise<void> {
    if (!running && runtime.state === 'stopped') return;

    running = false;
    paused = false;

    if (frameHandle !== null && windowTarget?.cancelAnimationFrame) {
      windowTarget.cancelAnimationFrame(frameHandle);
    }
    frameHandle = null;
    await runtime.stop();
  }

  function pause(reason = 'manual'): void {
    if (!running) return;

    paused = true;
    runtime.pause();
    if (frameHandle !== null && windowTarget?.cancelAnimationFrame) {
      windowTarget.cancelAnimationFrame(frameHandle);
    }
    frameHandle = null;

    if (isHTMLElement(options.loadingElement)) {
      options.loadingElement.setAttribute('data-runtime-paused', reason);
    }
  }

  function resume(reason = 'manual'): void {
    if (!running || disposed) return;

    paused = false;
    runtime.resume();
    lastTimestampMs = resolveNow(windowTarget);

    if (isHTMLElement(options.loadingElement)) {
      options.loadingElement.removeAttribute('data-runtime-paused');
    }

    if (windowTarget?.requestAnimationFrame && frameHandle === null) {
      frameHandle = windowTarget.requestAnimationFrame((timestamp) => {
        void frame(timestamp);
      });
    }
  }

  function enqueueKeyboard(
    code: string,
    phase: InputPhaseV18,
  ): InputCommandV18 | null {
    const command = runtime.inputFromKeyboard(code, phase);
    if (command) inputCommands += 1;
    return command;
  }

  async function dispose(): Promise<void> {
    if (disposed) return;

    disposed = true;

    for (const unsubscribe of subscriptions.splice(0)) {
      unsubscribe();
    }

    resizeObserver?.disconnect();
    resizeObserver = null;

    await stop();
  }

  installListeners();

  const bridge: BrowserRuntimeBridgeV18 = {
    runtime,
    start,
    stop,
    pause,
    resume,
    dispose,
    snapshot(): BrowserRuntimeBridgeSnapshotV18 {
      const rect = options.canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width || options.canvas.width || 1));
      const height = Math.max(1, Math.round(rect.height || options.canvas.height || 1));

      return freeze({
        running,
        paused,
        frameHandle,
        width,
        height,
        dpr: Math.min(3, Math.max(1, finite(windowTarget?.devicePixelRatio, 1))),
        lastTimestampMs,
        lastSnapshot,
        inputCommands,
        resizeCount,
        visibility,
      });
    },
    resize,
    enqueueKeyboard,
  };

  if (options.autoStart ?? false) {
    void start().catch(onError);
  }

  return Object.freeze(bridge);
}