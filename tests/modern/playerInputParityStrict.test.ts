import { describe, expect, it } from 'vitest';
import { createPlayerInputParity, normalizeStick } from '../../src/3d/gameplay/playerInputParity.ts';

describe('Kızıl Ufuk player input parity', () => {
  it('keeps keyboard, mouse and touch on the same semantic action set', () => {
    const input = createPlayerInputParity();
    expect(input.ingestKeyboard('KeyW')).toBe(true);
    expect(input.ingestMouse(0)).toBe(true);
    expect(input.ingestTouch('heavy')).toBe(true);
    expect(input.snapshot().held).toEqual(['heavyAttack', 'lightAttack', 'moveForward']);
  });

  it('normalizes gamepad values around a finite deadzone', () => {
    expect(normalizeStick(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ x: 0, y: 0 });
    const input = createPlayerInputParity({ deadzone: 0.2 });
    const snap = input.ingestGamepad({ leftX: 0.7, leftY: -0.7, buttons: [1, 0, 0, 0, 1] });
    expect(snap.move.x).toBeGreaterThan(0.6);
    expect(snap.move.y).toBeLessThan(-0.6);
    expect(snap.held).toEqual(['heavyAttack', 'lightAttack', 'lockOn']);
  });

  it('consumes pressed edges without dropping held state', () => {
    const input = createPlayerInputParity();
    input.ingestKeyboard('Space');
    expect(input.consumePressed()).toEqual(['dodge']);
    expect(input.consumePressed()).toEqual([]);
    expect(input.snapshot().held).toEqual(['dodge']);
    input.ingestKeyboard('Space', false);
    expect(input.snapshot().held).toEqual([]);
  });
});
