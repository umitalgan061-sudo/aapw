import { describe, expect, it } from 'vitest';
import {
  createPlayerAnimationSignalPacket,
  getPlayerAnimationSignalTypes,
  sanitizePlayerAnimationSignal,
  sanitizePlayerAnimationSignalBatch,
  validatePlayerAnimationSignal,
} from '../../src/3d/gameplay/playerAnimationSignalSanitizer.ts';

describe('Kızıl Ufuk strict animation signal sanitizer', () => {
  it('normalizes hostile presentation signals into bounded immutable packets', () => {
    const signal = sanitizePlayerAnimationSignal({
      type: 'footstep',
      sequence: -10,
      atSeconds: Number.NaN,
      intensity: 7,
      phase: -2.25,
      materialKey: 'stone'.repeat(30),
    });
    expect(signal).toMatchObject({ type: 'footstep', sequence: 0, atSeconds: 0, intensity: 1, materialKey: expect.any(String) });
    expect((signal.phase ?? 0)).toBeGreaterThanOrEqual(0);
    expect((signal.phase ?? 0)).toBeLessThan(1);
    expect(Object.isFrozen(signal)).toBe(true);
    expect(validatePlayerAnimationSignal(signal).ok).toBe(true);
  });

  it('keeps packet count and lifetime bounded', () => {
    const batch = sanitizePlayerAnimationSignalBatch(Array.from({ length: 20 }, (_, i) => ({
      type: i % 2 ? 'action-start' : 'footstep',
      sequence: i,
      atSeconds: i,
    })), 20);
    expect(batch).toHaveLength(8);

    const packet = createPlayerAnimationSignalPacket(batch, 4);
    expect(packet.count).toBeLessThanOrEqual(8);
    expect(packet.signals.every((entry) => Object.isFrozen(entry))).toBe(true);
    expect(getPlayerAnimationSignalTypes()).toContain('presentation-warning');
  });

  it('fails closed to presentation-warning for unknown signal kinds', () => {
    const signal = sanitizePlayerAnimationSignal({ type: 'teleport-player', action: 'x' });
    expect(signal.type).toBe('presentation-warning');
    expect(validatePlayerAnimationSignal(signal).ok).toBe(true);
  });
});
