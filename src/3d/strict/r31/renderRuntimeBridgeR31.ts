import type { RenderPortR31, RuntimeFrameR31 } from './applicationTypesR31.ts';

export interface RenderBridgeMetricsR31 {
  readonly frames: number;
  readonly beginCalls: number;
  readonly drawCalls: number;
  readonly endCalls: number;
  readonly resizeCalls: number;
  readonly rejectedFrames: number;
}

export class RenderRuntimeBridgeR31 {
  readonly #port: RenderPortR31;
  #frameOpen = false;
  #frames = 0;
  #beginCalls = 0;
  #drawCalls = 0;
  #endCalls = 0;
  #resizeCalls = 0;
  #rejectedFrames = 0;

  constructor(port: RenderPortR31) {
    this.#port = port;
  }

  render(frame: RuntimeFrameR31): boolean {
    if (this.#frameOpen) {
      this.#rejectedFrames++;
      return false;
    }
    try {
      this.#frameOpen = true;
      this.#port.beginFrame(frame);
      this.#beginCalls++;
      this.#port.draw();
      this.#drawCalls++;
      this.#port.endFrame();
      this.#endCalls++;
      this.#frames++;
      this.#frameOpen = false;
      return true;
    } catch {
      this.#frameOpen = false;
      this.#rejectedFrames++;
      return false;
    }
  }

  resize(width: number, height: number, pixelRatio = 1): void {
    if (!(width > 0 && height > 0 && pixelRatio > 0)) return;
    this.#port.resize(Math.floor(width), Math.floor(height), Math.min(3, pixelRatio));
    this.#resizeCalls++;
  }

  diagnostics(): RenderBridgeMetricsR31 {
    return Object.freeze({
      frames: this.#frames,
      beginCalls: this.#beginCalls,
      drawCalls: this.#drawCalls,
      endCalls: this.#endCalls,
      resizeCalls: this.#resizeCalls,
      rejectedFrames: this.#rejectedFrames,
    });
  }

  dispose(): void {
    this.#frameOpen = false;
    this.#port.dispose();
  }
}
