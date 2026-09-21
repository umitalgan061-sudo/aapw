import { describe, expect, it, vi } from 'vitest';
import { RendererGpuTimer } from '../../src/3d/modern/rendererGpuTimer';
import { RendererPresentationBridge } from '../../src/3d/modern/rendererPresentationBridge';

function createFakeGpuContext() {
  let available = false;
  let disjoint = false;
  const query = {};
  return {
    QUERY_RESULT_AVAILABLE: 1,
    QUERY_RESULT: 2,
    createQuery: vi.fn(() => query),
    beginQuery: vi.fn(),
    endQuery: vi.fn(),
    getQueryParameter: vi.fn((_query: object, parameter: number) => parameter === 1 ? available : 5_000_000),
    getParameter: vi.fn(() => disjoint),
    deleteQuery: vi.fn(),
    getExtension: vi.fn(() => ({ TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 })),
    setAvailable(value: boolean) { available = value; },
    setDisjoint(value: boolean) { disjoint = value; },
  };
}

describe('RendererGpuTimer', () => {
  it('samples a completed WebGL2 timer query without blocking', () => {
    const context = createFakeGpuContext();
    const timer = new RendererGpuTimer({ getContext: () => context });

    expect(timer.supported).toBe(true);
    expect(timer.begin()).toBe(true);
    timer.end();
    expect(timer.poll()).toBeNull();

    context.setAvailable(true);
    expect(timer.poll()).toBe(5);
    expect(timer.diagnostics()).toMatchObject({ supported: true, samples: 1, lastGpuMs: 5, pending: false });
  });

  it('does not inspect disjoint state until the query is available', () => {
    const context = createFakeGpuContext();
    const timer = new RendererGpuTimer({ getContext: () => context });

    expect(timer.begin()).toBe(true);
    timer.end();
    context.setDisjoint(true);

    expect(timer.poll()).toBeNull();
    expect(context.deleteQuery).not.toHaveBeenCalled();

    context.setAvailable(true);
    expect(timer.poll()).toBeNull();
    expect(context.deleteQuery).toHaveBeenCalledTimes(1);
  });

  it('drops disjoint GPU samples instead of feeding corrupt timing into adaptive quality', () => {
    const context = createFakeGpuContext();
    const timer = new RendererGpuTimer({ getContext: () => context });
    expect(timer.begin()).toBe(true);
    timer.end();
    context.setDisjoint(true);
    context.setAvailable(true);

    expect(timer.poll()).toBeNull();
    expect(timer.diagnostics()).toMatchObject({ samples: 0, lastGpuMs: null, pending: false });
    expect(context.deleteQuery).toHaveBeenCalledTimes(1);
  });

  it('wraps the concrete renderer only when GPU timer queries are supported', () => {
    const context = createFakeGpuContext();
    const originalRender = vi.fn(() => 'frame');
    const renderer = {
      info: { render: { calls: 4, triangles: 800 } },
      shadowMap: { enabled: true },
      setPixelRatio: vi.fn(),
      getPixelRatio: () => 1,
      getContext: () => context,
      render: originalRender,
    };
    const bridge = new RendererPresentationBridge({ renderer, devicePixelRatio: () => 1, minFramesBetweenChanges: 4 });

    expect(renderer.render('scene', 'camera')).toBe('frame');
    expect(originalRender).toHaveBeenCalledTimes(1);

    context.setAvailable(true);
    renderer.render('scene', 'camera');
    expect(bridge.gpuMs()).toBe(5);

    bridge.dispose();
    expect(renderer.render).toBe(originalRender);
    expect(context.deleteQuery).toHaveBeenCalled();
  });

  it('does not alter a renderer without WebGL2 timer-query support', () => {
    const originalRender = vi.fn();
    const renderer = {
      info: { render: { calls: 1, triangles: 2 } },
      shadowMap: { enabled: true },
      setPixelRatio: vi.fn(),
      getPixelRatio: () => 1,
      getContext: () => ({ getExtension: vi.fn(() => null) }),
      render: originalRender,
    };
    const bridge = new RendererPresentationBridge({ renderer });
    expect(renderer.render).toBe(originalRender);
    bridge.dispose();
    expect(renderer.render).toBe(originalRender);
  });
});
