export interface ResizeTarget {
  readonly resize(width: number, height: number, devicePixelRatio?: number): void;
}

export interface ResizeState {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly changed: boolean;
}

export class RuntimeResizeManager {
  readonly target: ResizeTarget;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxDpr: number;
  #width = 1;
  #height = 1;
  #dpr = 1;

  constructor(target: ResizeTarget, options: { maxWidth?: number; maxHeight?: number; maxDpr?: number } = {}) {
    this.target = target;
    this.maxWidth = Math.max(1, Math.floor(options.maxWidth ?? 4096));
    this.maxHeight = Math.max(1, Math.floor(options.maxHeight ?? 4096));
    this.maxDpr = Math.max(1, options.maxDpr ?? 2);
  }

  apply(width: number, height: number, dpr = 1): ResizeState {
    const nextWidth = Math.max(1, Math.min(this.maxWidth, Math.floor(width)));
    const nextHeight = Math.max(1, Math.min(this.maxHeight, Math.floor(height)));
    const nextDpr = Math.max(1, Math.min(this.maxDpr, Number.isFinite(dpr) ? dpr : 1));
    const changed = nextWidth !== this.#width || nextHeight !== this.#height || nextDpr !== this.#dpr;
    if (changed) {
      this.#width = nextWidth;
      this.#height = nextHeight;
      this.#dpr = nextDpr;
      this.target.resize(nextWidth, nextHeight, nextDpr);
    }
    return { width: this.#width, height: this.#height, dpr: this.#dpr, changed };
  }

  observe(element: HTMLElement): () => void {
    if (typeof ResizeObserver === 'undefined') {
      const listener = (): void => this.apply(element.clientWidth, element.clientHeight, window.devicePixelRatio);
      window.addEventListener('resize', listener);
      listener();
      return () => window.removeEventListener('resize', listener);
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      this.apply(entry.contentRect.width, entry.contentRect.height, window.devicePixelRatio);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }

  state(): ResizeState {
    return { width: this.#width, height: this.#height, dpr: this.#dpr, changed: false };
  }
}
