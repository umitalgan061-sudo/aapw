import { ApplicationKernel, type ApplicationKernelOptions } from './applicationKernel.ts';

export interface BrowserHostOptions extends ApplicationKernelOptions { readonly canvas?: HTMLCanvasElement; readonly autoStart?: boolean; readonly maxFrameDeltaMs?: number; }
export interface BrowserHost { readonly kernel: ApplicationKernel; start(): Promise<void>; stop(): Promise<void>; pause(): void; resume(): void; dispose(): Promise<void>; }

const browserNow = (): number => typeof performance !== 'undefined' ? performance.now() : Date.now();

export class ModernBrowserHost implements BrowserHost {
  readonly kernel: ApplicationKernel;
  readonly #canvas?: HTMLCanvasElement;
  readonly #maxDelta: number;
  #raf = 0;
  #running = false;
  #disposed = false;
  #lastNow = 0;
  #visibilityHandler = (): void => { if (document.hidden) this.pause(); else this.resume(); };
  #keyDownHandler = (event: KeyboardEvent): void => { this.kernel.input.setKey(event.code, true); };
  #keyUpHandler = (event: KeyboardEvent): void => { this.kernel.input.setKey(event.code, false); };
  #pointerDownHandler = (event: PointerEvent): void => { this.kernel.input.setButton(event.button === 0 ? 'primary' : 'secondary', true); };
  #pointerUpHandler = (event: PointerEvent): void => { this.kernel.input.setButton(event.button === 0 ? 'primary' : 'secondary', false); };
  #pointerMoveHandler = (event: PointerEvent): void => { this.kernel.input.setPointer(event.clientX, event.clientY, event.movementX, event.movementY, document.pointerLockElement === this.#canvas); };
  #blurHandler = (): void => { this.pause(); this.kernel.input.reset(); };

  constructor(options: BrowserHostOptions = {}) {
    this.kernel = new ApplicationKernel(options);
    this.#canvas = options.canvas;
    this.#maxDelta = Math.max(16.67, Math.floor(options.maxFrameDeltaMs ?? 100));
    if (options.autoStart) void this.start();
  }

  async start(): Promise<void> {
    if (this.#disposed) throw new Error('Browser host has been disposed.');
    await this.kernel.boot();
    this.kernel.start();
    if (this.#running) return;
    this.#running = true;
    this.#lastNow = browserNow();
    this.#attach();
    this.#raf = requestAnimationFrame(this.#loop);
  }

  async stop(): Promise<void> {
    if (!this.#running && this.kernel.phase() === 'stopped') return;
    this.#running = false;
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#detach();
    await this.kernel.stop();
  }

  pause(): void { this.kernel.pause(); }
  resume(): void { if (!this.#running) return; this.kernel.resume(); this.#lastNow = browserNow(); }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    await this.stop();
  }

  #loop = (now: number): void => {
    if (!this.#running || this.#disposed) return;
    const delta = Math.max(0, Math.min(this.#maxDelta, now - this.#lastNow));
    this.#lastNow = now;
    try {
      const frame = this.kernel.frame(delta);
      this.kernel.submitPerformance({ frameMs: delta, cpuMs: frame.report.elapsedMs, renderMs: 0, memoryMb: this.#memoryMb() ?? undefined });
    } catch (error) {
      this.kernel.report({ code: 'HOST_FRAME_FAILED', subsystem: 'simulation', severity: 'critical', message: error instanceof Error ? error.message : String(error), frame: this.kernel.latest()?.runtime.simulation.frame ?? 0, tick: this.kernel.latest()?.runtime.simulation.frame ?? 0 });
      this.pause();
    }
    this.#raf = requestAnimationFrame(this.#loop);
  };

  #attach(): void {
    window.addEventListener('keydown', this.#keyDownHandler, { passive: true });
    window.addEventListener('keyup', this.#keyUpHandler, { passive: true });
    window.addEventListener('blur', this.#blurHandler, { passive: true });
    document.addEventListener('visibilitychange', this.#visibilityHandler, { passive: true });
    if (this.#canvas) {
      this.#canvas.addEventListener('pointerdown', this.#pointerDownHandler, { passive: true });
      this.#canvas.addEventListener('pointerup', this.#pointerUpHandler, { passive: true });
      this.#canvas.addEventListener('pointermove', this.#pointerMoveHandler, { passive: true });
    }
  }

  #detach(): void {
    window.removeEventListener('keydown', this.#keyDownHandler);
    window.removeEventListener('keyup', this.#keyUpHandler);
    window.removeEventListener('blur', this.#blurHandler);
    document.removeEventListener('visibilitychange', this.#visibilityHandler);
    if (this.#canvas) {
      this.#canvas.removeEventListener('pointerdown', this.#pointerDownHandler);
      this.#canvas.removeEventListener('pointerup', this.#pointerUpHandler);
      this.#canvas.removeEventListener('pointermove', this.#pointerMoveHandler);
    }
  }

  #memoryMb(): number | null {
    const performanceMemory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
    const bytes = performanceMemory?.usedJSHeapSize;
    return typeof bytes === 'number' && Number.isFinite(bytes) ? bytes / (1024 * 1024) : null;
  }
}

export const createModernBrowserHost = (options?: BrowserHostOptions): ModernBrowserHost => new ModernBrowserHost(options);
