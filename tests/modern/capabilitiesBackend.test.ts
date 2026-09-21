import { describe, expect, it, vi } from 'vitest';
import { negotiateRenderCapabilities } from '../../src/3d/modern/capabilities';

describe('render capability backend hints', () => {
  it('can force headless without touching browser GPU APIs', async () => {
    const requestAdapter = vi.fn(async () => ({ requestDevice: vi.fn(), limits: {}, features: new Set() }));
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { gpu: { requestAdapter } },
    });

    const capabilities = await negotiateRenderCapabilities({ backendHint: 'headless' });

    expect(capabilities.backend).toBe('headless');
    expect(requestAdapter).not.toHaveBeenCalled();
  });

  it('reports WebGL2 when the concrete renderer is WebGL2 even if WebGPU exists', async () => {
    const requestAdapter = vi.fn(async () => {
      throw new Error('WebGPU should not be requested for an existing WebGL2 renderer');
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { gpu: { requestAdapter } },
    });

    const context = {
      MAX_TEXTURE_SIZE: 0x0d33,
      MAX_COLOR_ATTACHMENTS: 0x8cdf,
      getParameter: vi.fn((token: number) => token === 0x0d33 ? 8192 : 8),
      getExtension: vi.fn((name: string) => name === 'EXT_disjoint_timer_query_webgl2' ? {} : null),
    };
    const canvas = { getContext: vi.fn(() => context) } as unknown as HTMLCanvasElement;

    const capabilities = await negotiateRenderCapabilities({ canvas, backendHint: 'webgl2' });

    expect(capabilities.backend).toBe('webgl2');
    expect(capabilities.webgpu).toBe(false);
    expect(capabilities.timestampQueries).toBe(true);
    expect(capabilities.limits.maxTextureDimension2D).toBe(8192);
    expect(requestAdapter).not.toHaveBeenCalled();
  });
});
