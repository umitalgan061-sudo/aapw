import type { RenderFramePacket } from '../r27/renderAdapter.ts';
import type { RuntimeSnapshot, VisibilityDecision } from '../r27/contracts.ts';
import { RuntimeRenderAdapter } from '../r27/renderAdapter.ts';
import { VisibilityOracle } from '../r27/visibility.ts';

export interface RendererHandle {
  readonly setPixelRatio?: (value: number) => void;
  readonly setSize?: (width: number, height: number, updateStyle?: boolean) => void;
  readonly render?: (frame: RenderFramePacket) => void;
  readonly dispose?: () => void;
}

export interface RendererBridgeOptions {
  readonly renderer: RendererHandle;
  readonly pixelRatioCap?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
}

export class TypedRendererBridge {
  readonly renderer: RendererHandle;
  readonly adapter = new RuntimeRenderAdapter();
  readonly visibility = new VisibilityOracle();
  readonly options: Required<RendererBridgeOptions>;

  constructor(options: RendererBridgeOptions) {
    this.renderer = options.renderer;
    this.options = {
      renderer: options.renderer,
      pixelRatioCap: Math.max(1, options.pixelRatioCap ?? 2),
      maxWidth: Math.max(1, Math.floor(options.maxWidth ?? 4096)),
      maxHeight: Math.max(1, Math.floor(options.maxHeight ?? 4096)),
    };
  }

  resize(width: number, height: number, devicePixelRatio = 1): void {
    const safeWidth = Math.max(1, Math.min(this.options.maxWidth, Math.floor(width)));
    const safeHeight = Math.max(1, Math.min(this.options.maxHeight, Math.floor(height)));
    const dpr = Math.max(1, Math.min(this.options.pixelRatioCap, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1));
    this.renderer.setPixelRatio?.(dpr);
    this.renderer.setSize?.(safeWidth, safeHeight, false);
  }

  render(snapshot: RuntimeSnapshot, decisions?: readonly VisibilityDecision[]): RenderFramePacket {
    const frame = this.adapter.buildFrame(snapshot, decisions ?? []);
    this.renderer.render?.(frame);
    return frame;
  }

  dispose(): void {
    this.renderer.dispose?.();
  }
}
