import { describe, expect, it } from 'vitest';
import { ProductionRuntimeR42 } from '../../../src/3d/strict/r42/runtime.ts';

describe('R42 integrated runtime', () => {
  it('initializes and advances the complete runtime stack', async () => {
    const runtime = new ProductionRuntimeR42({
      capabilities: {
        webgpu: false,
        webgl2: true,
        devicePixelRatio: 1,
      },
    });
    runtime.spawn({ id: 'player', kind: 'player' });
    const frame = await runtime.frame({ deltaSeconds: 1 / 30 });
    expect(frame.snapshot.version).toBe(42);
    expect(frame.snapshot.entityCount).toBe(1);
    expect(frame.snapshot.checksum).toBeGreaterThan(0);
    await runtime.dispose();
    expect(runtime.mode).toBe('disposed');
  });

  it('publishes assets and typed commands without leaking state ownership', () => {
    const runtime = new ProductionRuntimeR42();
    runtime.spawn({ id: 'player', kind: 'player' });
    runtime.registerAsset({ id: 'tree', url: '/assets/tree.glb', priority: 'high' });
    expect(runtime.requestAsset('tree')).toBe(true);
    const frame = runtime.feedInput({ tick: 1, sequence: 1, attack: true });
    const commands = runtime.bindInput(frame, 'player');
    expect(commands.some(command => command.kind === 'attack')).toBe(true);
  });

  it('supports pause and resume transitions', async () => {
    const runtime = new ProductionRuntimeR42();
    await runtime.initialize();
    runtime.pause();
    expect(runtime.mode).toBe('paused');
    runtime.resume();
    expect(runtime.mode).toBe('running');
  });
});
