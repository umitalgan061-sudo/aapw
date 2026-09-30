import { describe, expect, it } from 'vitest';
import { RuntimeRecoveryController } from '../../../src/3d/modern/r28/errorRecovery.ts';
import { RuntimeSecurityBoundary } from '../../../src/3d/modern/r27/security.ts';
import { InputCommandBuffer, nextSequence, isSequenceNewer } from '../../../src/3d/modern/r27/network.ts';
import { entityId, zeroInputFrame } from '../../../src/3d/modern/r27/contracts.ts';

describe('R28 recovery and network policy', () => {
  it('moves to failed only after recovery options are exhausted', async () => {
    const controller = new RuntimeRecoveryController();
    controller.registerFailure();
    const first = await controller.recover([
      { id: 'unstable', priority: 5, maxAttempts: 2, cooldownTicks: 0, execute: async () => false },
    ], 1);
    expect(first.state).toBe('degraded');
    const second = await controller.recover([
      { id: 'unstable', priority: 5, maxAttempts: 2, cooldownTicks: 0, execute: async () => false },
    ], 2);
    expect(second.state).toBe('failed');
  });

  it('handles network sequence ordering and bounded input history', () => {
    const first = nextSequence({ value: 41 });
    expect(first.value).toBe(42);
    expect(isSequenceNewer(first, { value: 41 })).toBe(true);

    const buffer = new InputCommandBuffer(2);
    buffer.push({ sequence: { value: 1 }, tick: 1, input: zeroInputFrame(1), predicted: true });
    buffer.push({ sequence: { value: 2 }, tick: 2, input: zeroInputFrame(2), predicted: true });
    buffer.push({ sequence: { value: 3 }, tick: 3, input: zeroInputFrame(3), predicted: true });
    expect(buffer.size()).toBe(2);
    expect(buffer.since(2).map((item) => item.tick)).toEqual([2, 3]);
  });

  it('rejects commands after the per-tick security window is saturated', () => {
    const boundary = new RuntimeSecurityBoundary();
    expect(boundary.consumeCommandBudget(10, 120)).toBe(true);
    expect(boundary.consumeCommandBudget(10, 1)).toBe(false);
    expect(boundary.consumeCommandBudget(70, 1)).toBe(true);
    expect(entityId(1)).toBe(1);
  });
});
