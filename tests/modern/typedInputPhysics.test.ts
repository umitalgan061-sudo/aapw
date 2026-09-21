import { describe, expect, it } from 'vitest';
import {
  createCircleCollider,
  createComposedCollider,
  integrateJumpArc,
} from '../../src/3d/physics.ts';
import {
  applyGamepadRadialDeadzone,
  applyGamepadTriggerDeadzone,
  resolveGamepadSprintIntent,
  samplePlayerGamepad,
  selectPlayerGamepad,
} from '../../src/3d/input.ts';

describe('typed physics boundary', () => {
  it('resolves circle penetration including the center-degenerate case', () => {
    const collider = createCircleCollider([{ x: 10, z: 20, radius: 2 }], 0.5);
    expect(collider.resolveXZ(10, 20)).toEqual({ x: 12.5, z: 20 });
    expect(collider.resolveXZ(0, 0)).toEqual({ x: 0, z: 0 });
  });

  it('composes colliders in deterministic order and supports dynamic registration', () => {
    const composed = createComposedCollider([{
      resolveXZ: () => ({ x: 2, z: 3 }),
    }]);
    composed.registerDynamicCollider({
      resolveXZ: (x, z) => ({ x: x + 5, z: z - 1 }),
    });
    expect(composed.resolveXZ(0, 0)).toEqual({ x: 7, z: 2 });
  });

  it('lands jump arcs at an exact grounded state', () => {
    expect(integrateJumpArc(0.25, -2, 0.2, -9.81)).toEqual({
      heightAboveGroundMeters: 0,
      velocityYMps: 0,
      isGrounded: true,
    });
  });

  it('rejects non-finite jump inputs', () => {
    expect(() => integrateJumpArc(Number.NaN, 0, 0.1, -9.81)).toThrow(RangeError);
  });
});

function makeGamepad(index: number, pressed: readonly number[] = []): Gamepad {
  const buttonSet = new Set(pressed);
  const buttons = Array.from({ length: 16 }, (_, i) => ({
    pressed: buttonSet.has(i),
    touched: buttonSet.has(i),
    value: buttonSet.has(i) ? 1 : 0,
  })) as unknown as readonly GamepadButton[];
  return {
    id: 'AAPW Test Pad',
    index,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0.8, -0.8, 0, 0],
    buttons,
    hapticActuators: [],
    vibrationActuator: null,
  } as unknown as Gamepad;
}

describe('typed gamepad boundary', () => {
  it('remaps radial deadzones without changing direction', () => {
    const sample = applyGamepadRadialDeadzone(0.8, -0.8, 0.2);
    expect(sample.magnitude).toBeGreaterThan(0);
    expect(Math.sign(sample.x)).toBe(1);
    expect(Math.sign(sample.y)).toBe(-1);
  });

  it('normalizes trigger deadzones and sprint hysteresis', () => {
    expect(applyGamepadTriggerDeadzone(0.04)).toBe(0);
    expect(applyGamepadTriggerDeadzone(0.54)).toBeGreaterThan(0);
    expect(resolveGamepadSprintIntent(0.6, true, true)).toBe(true);
    expect(resolveGamepadSprintIntent(0.6, true, false)).toBe(false);
  });

  it('sticks to the preferred connected standard gamepad', () => {
    const pads = [makeGamepad(3), makeGamepad(1)];
    expect(selectPlayerGamepad(pads, 3)?.index).toBe(3);
    expect(selectPlayerGamepad(pads)?.index).toBe(1);
  });

  it('emits edge-triggered actions once per button transition', () => {
    const gamepad = makeGamepad(1, [0, 2]);
    const sample = samplePlayerGamepad(gamepad, { jump: false, light: false }, false);
    expect(sample.jumpPressed).toBe(true);
    expect(sample.lightPressed).toBe(true);
    const held = samplePlayerGamepad(gamepad, sample.buttons, false);
    expect(held.jumpPressed).toBe(false);
    expect(held.lightPressed).toBe(false);
  });
});
