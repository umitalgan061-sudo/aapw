import { describe, expect, it } from 'vitest';
import { createBrowserRuntimeBridgeV18 } from '../../src/3d/modern/runtimeBrowserBridgeV18';
import { MemoryPersistenceAdapterV18 } from '../../src/3d/modern/persistenceEnvelopeV18';
import { RuntimeApplication } from '../../src/3d/modern/runtimeApplicationV18';

class FakeTarget extends EventTarget {
  #raf = 0;
  #callbacks = new Map<number, FrameRequestCallback>();

  requestAnimationFrame(callback: FrameRequestCallback): number {
    this.#raf += 1;
    this.#callbacks.set(this.#raf, callback);
    return this.#raf;
  }

  cancelAnimationFrame(handle: number): void {
    this.#callbacks.delete(handle);
  }

  flush(time = 16.67): void {
    const callbacks = [...this.#callbacks.entries()];
    this.#callbacks.clear();
    for (const [, callback] of callbacks) callback(time);
  }
}

function canvas(): HTMLCanvasElement {
  const element = {
    width: 640,
    height: 360,
    style: { width: '', height: '' },
    getBoundingClientRect: () => ({
      width: 640,
      height: 360,
      left: 0,
      top: 0,
      right: 640,
      bottom: 360,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  };

  return element as unknown as HTMLCanvasElement;
}

describe('browser runtime bridge V18', () => {
  it('translates keyboard events into typed runtime input', async () => {
    const keyboard = new FakeTarget();
    const windowTarget = new FakeTarget();
    const runtime = new RuntimeApplication({
      persistence: new MemoryPersistenceAdapterV18(),
      clock: () => 16.67,
    });

    const bridge = createBrowserRuntimeBridgeV18({
      runtime,
      canvas: canvas(),
      keyboardTarget: keyboard,
      pointerTarget: keyboard,
      visibilityDocument: new EventTarget() as unknown as Document,
      windowTarget: windowTarget as unknown as Window,
    });

    const keydown = new Event('keydown', { cancelable: true });
    Object.defineProperty(keydown, 'code', { value: 'KeyW' });
    keyboard.dispatchEvent(keydown);

    expect(bridge.snapshot().inputCommands).toBe(1);
    expect(runtime.input.isActive('move-forward')).toBe(true);

    await bridge.dispose();
    expect(runtime.state).toBe('stopped');
  });

  it('resizes canvas using bounded device pixel ratio', () => {
    const windowTarget = new FakeTarget() as unknown as Window & {
      readonly devicePixelRatio: number;
    };

    Object.defineProperty(windowTarget, 'devicePixelRatio', {
      value: 5,
      configurable: true,
    });

    const bridge = createBrowserRuntimeBridgeV18({
      runtime: new RuntimeApplication({
        persistence: new MemoryPersistenceAdapterV18(),
      }),
      canvas: canvas(),
      windowTarget,
    });

    bridge.resize();
    const result = bridge.snapshot();

    expect(result.dpr).toBe(3);
    expect(result.width).toBe(640);
    expect(result.height).toBe(360);
    expect(result.resizeCount).toBeGreaterThan(0);
  });

  it('starts and publishes a runtime snapshot', async () => {
    const windowTarget = new FakeTarget();
    const runtime = new RuntimeApplication({
      persistence: new MemoryPersistenceAdapterV18(),
      clock: () => 16.67,
    });

    const bridge = createBrowserRuntimeBridgeV18({
      runtime,
      canvas: canvas(),
      windowTarget: windowTarget as unknown as Window,
    });

    await bridge.start();
    windowTarget.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bridge.snapshot().lastSnapshot?.state).toBe('running');

    await bridge.stop();
    expect(runtime.state).toBe('stopped');
  });

  it('pause/resume preserves the runtime object without spawning duplicate frames', async () => {
    const windowTarget = new FakeTarget();
    const runtime = new RuntimeApplication({
      persistence: new MemoryPersistenceAdapterV18(),
      clock: () => 16.67,
    });

    const bridge = createBrowserRuntimeBridgeV18({
      runtime,
      canvas: canvas(),
      windowTarget: windowTarget as unknown as Window,
    });

    await bridge.start();
    const beforePause = bridge.snapshot();
    bridge.pause('test');
    expect(bridge.snapshot().paused).toBe(true);
    bridge.resume('test');
    expect(bridge.snapshot().paused).toBe(false);
    expect(bridge.snapshot().frameHandle).not.toBe(beforePause.frameHandle);
    await bridge.dispose();
  });
});
