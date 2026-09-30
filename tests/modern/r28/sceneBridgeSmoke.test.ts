import { describe, expect, it } from 'vitest';
import { RuntimeSceneBridge } from '../../../src/3d/modern/r28/sceneBridge.ts';
import { BrowserRuntimeHost } from '../../../src/3d/modern/r28/browserHost.ts';
import { entityId, vec3 } from '../../../src/3d/modern/r27/contracts.ts';

describe('R28 scene bridge smoke', () => {
  it('keeps scene-facing state renderer-neutral', () => {
    const canvas = typeof document === 'undefined'
      ? ({ addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement)
      : document.createElement('canvas');
    const host = new BrowserRuntimeHost({ canvas, session: undefined });
    const rendered: unknown[] = [];
    const bridge = new RuntimeSceneBridge({
      canvas,
      renderer: {
        setPixelRatio: () => undefined,
        setSize: () => undefined,
        render: (frame) => rendered.push(frame),
        dispose: () => undefined,
      },
    }, host);

    const entity = entityId(1);
    bridge.addEntity({
      entity,
      bounds: { min: vec3(-1, 0, -1), max: vec3(1, 2, 1) },
      position: vec3(0, 1, 0),
      tags: ['player'],
      layer: 0,
      enabled: true,
    });

    bridge.updateCamera({ position: vec3(0, 2, 5) }, 1 / 60);
    bridge.render();
    expect(rendered).toHaveLength(1);
    bridge.resize(800, 600, 2);
    bridge.dispose();
  });
});
