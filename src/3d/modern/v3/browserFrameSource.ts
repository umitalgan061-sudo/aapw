import type { V3CameraState, V3FrameSource, V3Viewport } from './runtimeContracts.js';

const DEFAULT_CAMERA: V3CameraState = Object.freeze({
  position: Object.freeze({ x: 0, y: 80, z: 120 }),
  target: Object.freeze({ x: 0, y: 0, z: 0 }),
  fov: 60,
  near: 0.1,
  far: 30_000,
  dpr: 1,
});

export interface BrowserFrameSourceOptions {
  readonly canvas: HTMLCanvasElement;
  readonly maxDpr?: number;
  readonly cameraProvider?: () => V3CameraState;
}

export class BrowserFrameSource implements V3FrameSource {
  readonly #canvas: HTMLCanvasElement;
  readonly #maxDpr: number;
  readonly #cameraProvider?: () => V3CameraState;

  constructor(options: BrowserFrameSourceOptions) {
    this.#canvas = options.canvas;
    this.#maxDpr = Math.max(1, Math.min(4, options.maxDpr ?? 2.5));
    this.#cameraProvider = options.cameraProvider;
  }

  now(): number { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

  viewport(): V3Viewport {
    const rect = this.#canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || window.innerWidth));
    const height = Math.max(1, Math.round(rect.height || window.innerHeight));
    const dpr = Math.max(1, Math.min(this.#maxDpr, window.devicePixelRatio || 1));
    return Object.freeze({ width, height, dpr });
  }

  camera(): V3CameraState {
    if (this.#cameraProvider) return this.#cameraProvider();
    return Object.freeze({ ...DEFAULT_CAMERA, dpr: this.viewport().dpr });
  }
}

export const createBrowserFrameSource = (canvas: HTMLCanvasElement, options: Omit<BrowserFrameSourceOptions, 'canvas'> = {}): BrowserFrameSource => new BrowserFrameSource({ ...options, canvas });
