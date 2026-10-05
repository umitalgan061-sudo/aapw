/**
 * Browser host bridge for R42.
 * Production TypeScript owner. DOM concerns stop at this boundary.
 */

import type { RenderCapabilities, RuntimeSnapshot } from './types.ts';
import { clamp, finite, deepFreeze } from './types.ts';

export interface BrowserHost {
  readonly canvas: HTMLCanvasElement | null;
  readonly reducedMotion: boolean;
  readonly saveData: boolean;
  readonly devicePixelRatio: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly now: () => number;
  readonly scheduleFrame: (callback: FrameRequestCallback) => number;
  readonly cancelFrame: (handle: number) => void;
}

export interface BrowserBridgeOptions {
  readonly root?: Document | null;
  readonly webgpu?: boolean;
  readonly webgl2?: boolean;
}

export interface RuntimeSurfaceAdapter {
  resize(width: number, height: number, pixelRatio: number): void;
  publish(snapshot: RuntimeSnapshot): void;
  dispose(): void;
}

export function createBrowserHost(options: BrowserBridgeOptions = {}): BrowserHost {
  const root = options.root ?? (typeof document !== 'undefined' ? document : null);
  const canvas = root?.querySelector<HTMLCanvasElement>('canvas') ?? null;
  const media = typeof window !== 'undefined'
    ? window.matchMedia?.('(prefers-reduced-motion: reduce)')
    : null;
  const connection = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    : undefined;

  return Object.freeze({
    canvas,
    reducedMotion: Boolean(media?.matches),
    saveData: Boolean(connection?.saveData),
    devicePixelRatio: typeof window !== 'undefined' ? clamp(finite(window.devicePixelRatio, 1), 1, 3) : 1,
    viewportWidth: typeof window !== 'undefined' ? Math.max(1, window.innerWidth) : 1,
    viewportHeight: typeof window !== 'undefined' ? Math.max(1, window.innerHeight) : 1,
    now: () => typeof performance !== 'undefined' ? performance.now() : 0,
    scheduleFrame: callback => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : 0,
    cancelFrame: handle => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle); },
  });
}

export async function detectRenderCapabilities(options: BrowserBridgeOptions = {}): Promise<RenderCapabilities> {
  const host = createBrowserHost(options);
  let webgpu = Boolean(options.webgpu);
  if (!webgpu && typeof navigator !== 'undefined') {
    webgpu = 'gpu' in navigator;
  }
  let webgl2 = Boolean(options.webgl2);
  let maxTextureSize = 4096;
  let maxSamples = 1;
  let compressedTextures = false;

  if (host.canvas) {
    const gl = host.canvas.getContext('webgl2', { powerPreference: 'high-performance' });
    if (gl) {
      webgl2 = true;
      maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      maxSamples = gl.getParameter(gl.MAX_SAMPLES) as number;
      compressedTextures = Boolean(
        gl.getExtension('WEBGL_compressed_texture_etc')
        || gl.getExtension('WEBGL_compressed_texture_s3tc')
        || gl.getExtension('WEBGL_compressed_texture_astc'),
      );
    }
  }

  return deepFreeze({
    webgpu,
    webgl2,
    maxTextureSize: Math.max(1024, Math.trunc(finite(maxTextureSize, 4096))),
    maxSamples: Math.max(1, Math.trunc(finite(maxSamples, 1))),
    compressedTextures,
    devicePixelRatio: host.devicePixelRatio,
    reducedMotion: host.reducedMotion,
    saveData: host.saveData,
  });
}
