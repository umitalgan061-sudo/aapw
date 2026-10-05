import { describe, expect, it } from 'vitest';
import { InputCommandBufferR42, InputNormalizerR42, inputToCommands, normalizeAxisPair } from '../../../src/3d/strict/r42/input.ts';

describe('R42 input pipeline', () => {
  it('applies deadzone and unit normalization', () => {
    expect(normalizeAxisPair(0, 0)).toEqual({ x: 0, y: 0 });
    const value = normalizeAxisPair(1, 1);
    expect(Math.hypot(value.x, value.y)).toBeCloseTo(1);
  });

  it('normalizes sequences monotonically', () => {
    const input = new InputNormalizerR42();
    const a = input.normalize({ sequence: 10, tick: 1, moveX: 1 });
    const b = input.normalize({ sequence: 2, tick: 1, moveY: 1 });
    expect(b.sequence).toBe(11);
    expect(input.history()).toHaveLength(2);
    expect(a.sequence).toBe(10);
  });

  it('builds deterministic commands and drains them by tick', () => {
    const input = new InputNormalizerR42();
    const frame = input.normalize({ tick: 4, attack: true, jump: true, moveX: 1 });
    const commands = inputToCommands(frame, 'player');
    expect(commands.map(command => command.kind)).toEqual(['move', 'jump', 'attack']);
    const buffer = new InputCommandBufferR42(8, 32);
    for (const command of commands) expect(buffer.push(command)).toBe(true);
    const drained = buffer.drain(4);
    expect(drained).toHaveLength(3);
    expect(buffer.pending()).toHaveLength(0);
  });

  it('caps a saturated command buffer', () => {
    const buffer = new InputCommandBufferR42(1, 8);
    const command = {
      id: 'one',
      entityId: 'player',
      tick: 0,
      sequence: 0,
      kind: 'interact' as const,
      payload: {},
    };
    expect(buffer.push(command)).toBe(true);
    expect(buffer.push({ ...command, id: 'two', sequence: 1 })).toBe(false);
  });
});
