
import type { InputFrame, RuntimeSnapshot, RenderInput, Vec2, Vec3 } from './types.ts';
import { clamp, finite, vec2 } from './types.ts';
import { ProductionRuntimeR41, type RuntimeFrameInput } from './runtime.ts';

export interface BrowserBridgeOptions {
  readonly canvas?: HTMLCanvasElement;
  readonly runtime?: ProductionRuntimeR41;
  readonly maxInputHistory?: number;
  readonly installResizeObserver?: boolean;
  readonly autoStart?: boolean;
}

export interface BrowserBridgeState {
  readonly running: boolean;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly lastFrameMs: number;
  readonly lastSnapshot: RuntimeSnapshot | null;
  readonly inputSequence: number;
}

export interface BrowserBridge {
  readonly runtime: ProductionRuntimeR41;
  readonly state: () => BrowserBridgeState;
  readonly enqueueInput: (input: BrowserInput) => InputFrame;
  readonly step: (deltaSeconds: number) => Promise<RuntimeSnapshot>;
  readonly start: () => boolean;
  readonly stop: () => void;
  readonly dispose: () => void;
}

export interface BrowserInput {
  readonly moveX?: number;
  readonly moveY?: number;
  readonly lookX?: number;
  readonly lookY?: number;
  readonly jump?: boolean;
  readonly sprint?: boolean;
  readonly guard?: boolean;
  readonly attack?: boolean;
  readonly dodge?: boolean;
  readonly interact?: boolean;
  readonly source?: InputFrame['source'];
}

export function createBrowserRuntimeBridge(options: BrowserBridgeOptions = {}): BrowserBridge {
  const runtime = options.runtime ?? new ProductionRuntimeR41();
  const canvas = options.canvas;
  const maxHistory = Math.max(16, Math.trunc(options.maxInputHistory ?? 256));
  let running = false;
  let frameHandle: number | undefined;
  let lastTimestamp: number | undefined;
  let lastFrameMs = 0;
  let lastSnapshot: RuntimeSnapshot | null = null;
  let inputSequence = 0;
  let resizeObserver: ResizeObserver | undefined;

  runtime.registerDefaultPlayer();

  const viewport = (): { width: number; height: number; dpr: number } => {
    const width = Math.max(1, Math.round(canvas?.clientWidth || globalThis.innerWidth || 1));
    const height = Math.max(1, Math.round(canvas?.clientHeight || globalThis.innerHeight || 1));
    const dpr = clamp(typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1, 1, 2.5);
    return { width, height, dpr };
  };

  if (canvas && options.installResizeObserver !== false && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * viewport().dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * viewport().dpr));
    });
    resizeObserver.observe(canvas);
  }

  const enqueueInput = (input: BrowserInput): InputFrame => {
    inputSequence += 1;
    const frame = runtime.pushInput({
      tick: runtime.tick + 1,
      move: vec2(clamp(finite(input.moveX), -1, 1), clamp(finite(input.moveY), -1, 1)),
      look: vec2(clamp(finite(input.lookX), -1, 1), clamp(finite(input.lookY), -1, 1)),
      jump: input.jump === true,
      sprint: input.sprint === true,
      guard: input.guard === true,
      attack: input.attack === true,
      dodge: input.dodge === true,
      interact: input.interact === true,
      source: input.source ?? 'mixed',
    });
    if (inputSequence > maxHistory) inputSequence = maxHistory;
    return frame;
  };

  const frameInput = (deltaSeconds: number): RuntimeFrameInput => {
    const viewportSize = viewport();
    const reducedMotion = typeof globalThis.matchMedia === 'function'
      ? globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    const render: Partial<RenderInput> = {
      backend: 'webgl2',
      width: viewportSize.width,
      height: viewportSize.height,
      frameMs: lastFrameMs || 16.67,
      cpuMs: lastFrameMs || 8,
      gpuMs: null,
      memoryPressure: 0,
      thermalPressure: 0,
      reducedMotion,
      requestedFeatures: ['dynamicResolution', 'temporalHistory', 'taa', 'fog', 'instancing', 'occlusionHints'],
    };
    return { deltaSeconds, render };
  };

  const step = async (deltaSeconds: number): Promise<RuntimeSnapshot> => {
    if (!['running', 'degraded', 'loading'].includes(runtime.mode)) runtime.start();
    const start = performanceNow();
    const frame = await runtime.frame(frameInput(deltaSeconds));
    lastFrameMs = Math.max(0, performanceNow() - start);
    lastSnapshot = frame.snapshot;
    return frame.snapshot;
  };

  const loop = (time: number): void => {
    if (!running) return;
    const previous = lastTimestamp ?? time;
    lastTimestamp = time;
    void step(clamp((time - previous) / 1000, 0, 0.25))
      .catch(error => console.error('[R41 bridge] frame failed', error))
      .finally(() => {
        if (running && typeof globalThis.requestAnimationFrame === 'function') {
          frameHandle = globalThis.requestAnimationFrame(loop);
        }
      });
  };

  const start = (): boolean => {
    if (running) return true;
    if (!runtime.start()) return false;
    running = true;
    lastTimestamp = undefined;
    if (typeof globalThis.requestAnimationFrame === 'function') frameHandle = globalThis.requestAnimationFrame(loop);
    return true;
  };

  const stop = (): void => {
    running = false;
    if (frameHandle !== undefined && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(frameHandle);
    }
    frameHandle = undefined;
  };

  const dispose = (): void => {
    stop();
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    runtime.dispose();
  };

  const state = (): BrowserBridgeState => {
    const size = viewport();
    return Object.freeze({
      running,
      width: size.width,
      height: size.height,
      dpr: size.dpr,
      lastFrameMs,
      lastSnapshot,
      inputSequence: runtime.latestInputSequence(),
    });
  };

  const bridge: BrowserBridge = Object.freeze({
    runtime,
    state,
    enqueueInput,
    step,
    start,
    stop,
    dispose,
  });

  if (options.autoStart === true) start();
  return bridge;
}

export function normalizeKeyboardInput(event: KeyboardEvent, activeKeys: ReadonlySet<string>): BrowserInput {
  const key = event.key.toLowerCase();
  const forward = activeKeys.has('w') || activeKeys.has('arrowup') ? 1 : 0;
  const backward = activeKeys.has('s') || activeKeys.has('arrowdown') ? 1 : 0;
  const left = activeKeys.has('a') || activeKeys.has('arrowleft') ? 1 : 0;
  const right = activeKeys.has('d') || activeKeys.has('arrowright') ? 1 : 0;

  return Object.freeze({
    moveX: right - left,
    moveY: forward - backward,
    jump: key === ' ' || key === 'spacebar',
    sprint: activeKeys.has('shift'),
    guard: activeKeys.has('g'),
    attack: key === 'f',
    dodge: key === 'control' || key === 'ctrl',
    interact: key === 'e' || key === 'enter',
    lookX: 0,
    lookY: 0,
    source: 'keyboard',
  });
}

function performanceNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0;
}
