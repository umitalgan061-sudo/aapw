export interface GpuTimerExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

export interface GpuTimerContext {
  readonly QUERY_RESULT_AVAILABLE: number;
  readonly QUERY_RESULT: number;
  createQuery(): object | null;
  beginQuery(target: number, query: object): void;
  endQuery(target: number): void;
  getQueryParameter(query: object, parameter: number): unknown;
  getParameter(parameter: number): unknown;
  deleteQuery(query: object): void;
  getExtension(name: 'EXT_disjoint_timer_query_webgl2'): GpuTimerExtension | null;
}

export interface GpuTimerRenderer {
  getContext?: () => unknown;
}

export interface RendererGpuTimerDiagnostics {
  readonly supported: boolean;
  readonly active: boolean;
  readonly pending: boolean;
  readonly samples: number;
  readonly lastGpuMs: number | null;
}

/**
 * Optional non-blocking WebGL2 GPU timer. Results are consumed only when the driver marks a query
 * available; a disjoint result is discarded. Unsupported browsers simply become a zero-cost no-op.
 */
export class RendererGpuTimer {
  #gl: GpuTimerContext | null = null;
  #extension: GpuTimerExtension | null = null;
  #pendingQuery: object | null = null;
  #activeQuery: object | null = null;
  #lastGpuMs: number | null = null;
  #samples = 0;

  constructor(renderer: GpuTimerRenderer | null | undefined) {
    const candidate = renderer?.getContext?.();
    if (!candidate || typeof candidate !== 'object') return;
    const gl = candidate as Partial<GpuTimerContext>;
    if (
      typeof gl.createQuery !== 'function'
      || typeof gl.beginQuery !== 'function'
      || typeof gl.endQuery !== 'function'
      || typeof gl.getQueryParameter !== 'function'
      || typeof gl.getParameter !== 'function'
      || typeof gl.deleteQuery !== 'function'
      || typeof gl.getExtension !== 'function'
    ) return;
    const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!extension) return;
    this.#gl = candidate as GpuTimerContext;
    this.#extension = extension;
  }

  get supported(): boolean { return this.#gl !== null && this.#extension !== null; }
  get lastGpuMs(): number | null { return this.#lastGpuMs; }

  begin(): boolean {
    const gl = this.#gl;
    const extension = this.#extension;
    if (!gl || !extension || this.#activeQuery || this.#pendingQuery) return false;
    try {
      const query = gl.createQuery();
      if (!query) return false;
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      this.#activeQuery = query;
      return true;
    } catch {
      this.#activeQuery = null;
      return false;
    }
  }

  end(): void {
    const gl = this.#gl;
    const extension = this.#extension;
    const query = this.#activeQuery;
    if (!gl || !extension || !query) return;
    try {
      gl.endQuery(extension.TIME_ELAPSED_EXT);
      this.#pendingQuery = query;
    } catch {
      gl.deleteQuery(query);
    } finally {
      this.#activeQuery = null;
    }
  }

  poll(): number | null {
    const gl = this.#gl;
    const extension = this.#extension;
    const query = this.#pendingQuery;
    if (!gl || !extension || !query) return this.#lastGpuMs;

    try {
      const available = Boolean(gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE));
      if (!available) return this.#lastGpuMs;
      const disjoint = Boolean(gl.getParameter(extension.GPU_DISJOINT_EXT));
      if (disjoint) {
        gl.deleteQuery(query);
        this.#pendingQuery = null;
        return this.#lastGpuMs;
      }
      const nanoseconds = Number(gl.getQueryParameter(query, gl.QUERY_RESULT));
      gl.deleteQuery(query);
      this.#pendingQuery = null;
      if (!Number.isFinite(nanoseconds) || nanoseconds < 0) return this.#lastGpuMs;
      this.#lastGpuMs = Math.min(250, nanoseconds / 1_000_000);
      this.#samples += 1;
      return this.#lastGpuMs;
    } catch {
      gl.deleteQuery(query);
      this.#pendingQuery = null;
      return this.#lastGpuMs;
    }
  }

  diagnostics(): RendererGpuTimerDiagnostics {
    return Object.freeze({
      supported: this.supported,
      active: this.#activeQuery !== null,
      pending: this.#pendingQuery !== null,
      samples: this.#samples,
      lastGpuMs: this.#lastGpuMs,
    });
  }

  dispose(): void {
    const gl = this.#gl;
    if (gl && this.#activeQuery) gl.deleteQuery(this.#activeQuery);
    if (gl && this.#pendingQuery) gl.deleteQuery(this.#pendingQuery);
    this.#activeQuery = null;
    this.#pendingQuery = null;
    this.#lastGpuMs = null;
  }
}

export function createRendererGpuTimer(renderer: GpuTimerRenderer | null | undefined): RendererGpuTimer {
  return new RendererGpuTimer(renderer);
}
