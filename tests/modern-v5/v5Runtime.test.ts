import { describe, expect, it } from 'vitest';
import { asEntityId, asTick } from '../../src/3d/modern/v5/domain.ts';
import { command } from '../../src/3d/modern/v5/commandBus.ts';
import { ModernRuntimeV5 } from '../../src/3d/modern/v5/runtime.ts';
import { InputBufferV5, toIntent } from '../../src/3d/modern/v5/input.ts';
import { NetworkStateV5 } from '../../src/3d/modern/v5/network.ts';

describe('modern-v5 integrated runtime', () => {
  it('records buffered input as deterministic intent data', () => {
    const buffer = new InputBufferV5();
    const raw = { moveX: 1, moveY: 0, lookX: 0.5, lookY: 0, jump: true, sprint: false, dodge: false, primary: false, secondary: false, interact: false };
    buffer.push(3, raw);
    const intent = toIntent(asEntityId(2), asTick(3), buffer.get(3)!);
    expect(intent.entity).toBe(2);
    expect(intent.jump).toBe(true);
    expect(intent.move.x).toBe(1);
  });

  it('produces compact network deltas and applies them back', () => {
    const network = new NetworkStateV5();
    const empty = network.snapshot(asTick(1), [], true);
    const runtime = new ModernRuntimeV5();
    const entity = runtime.world.spawnWithDefaults(['transform', 'health']);
    const current = network.snapshot(asTick(2), runtime.world.snapshot(), true);
    const codec = network.codec;
    const delta = codec.encode(empty, current);
    expect(delta.upserts.map((entry) => Number(entry.id))).toEqual([entity]);
    const reconstructed = codec.apply(empty, delta);
    expect(reconstructed.entities.map((entry) => Number(entry.id))).toEqual([entity]);
  });

  it('submits input through the secured command path', async () => {
    const runtime = new ModernRuntimeV5({ maxCatchUpSteps: 2 });
    runtime.start();
    const accepted = await runtime.submitIntent({
      tick: asTick(0), entity: asEntityId(1), move: { x: 1, y: 0 }, look: { x: 0, y: 0 },
      jump: false, sprint: false, dodge: false, primary: false, secondary: false, interact: false,
    });
    expect(accepted).toBe(true);
    const step = await runtime.step(1 / 30);
    expect(step.ticksSimulated).toBeGreaterThan(0);
  });

  it('keeps command checksums stable for equivalent payloads', () => {
    const a = command('demo', { b: 2, a: 1 }, 4);
    const b = command('demo', { a: 1, b: 2 }, 4);
    expect(a.id).toBe(b.id);
  });
});
