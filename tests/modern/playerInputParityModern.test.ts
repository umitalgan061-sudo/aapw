import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  PLAYER_INPUT_CONTRACT_VERSION,
  PlayerInputActionBuffer,
  applyGamepadRadialDeadzone,
  applyGamepadTriggerDeadzone,
  auditPlayerInputParity,
  createPlayerInputFrame,
  emitPlayerInputAction,
  emitPlayerCombatIntent,
  normalizePlayerInputAxis,
  normalizePlayerInputFrame,
  resolveGamepadSprintIntent,
  resolvePlayerCombatFeedbackHaptic,
  samplePlayerGamepad,
  selectPlayerGamepad,
  KeyboardInput,
} from '../../src/3d/input.ts';

type FakeGamepad = Partial<Gamepad> & {
  index: number;
  connected: boolean;
  mapping: GamepadMappingType | string;
  axes: number[];
  buttons: Array<{ pressed: boolean; value: number }>;
};

function makePad({
  index = 0,
  mapping = 'standard',
  connected = true,
  axes = [0, 0, 0, 0],
  pressed = {},
  values = {},
}: {
  index?: number;
  mapping?: string;
  connected?: boolean;
  axes?: number[];
  pressed?: Record<number, boolean>;
  values?: Record<number, number>;
} = {}): FakeGamepad {
  return {
    index,
    mapping,
    connected,
    axes,
    buttons: Array.from({ length: 16 }, (_, buttonIndex) => ({
      pressed: Boolean(pressed[buttonIndex]) || Number(values[buttonIndex] ?? 0) >= 0.5,
      value: Number(values[buttonIndex] ?? (pressed[buttonIndex] ? 1 : 0)),
    })),
  };
}

class FakeTarget extends EventTarget {
  hidden = false;
  dispatch(type: string, init: Record<string, unknown> = {}): void {
    const event = new Event(type);
    Object.assign(event, init);
    this.dispatchEvent(event);
  }
}

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

beforeEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { getGamepads: () => [] },
  });
});

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete (globalThis as { navigator?: unknown }).navigator;
});

describe('Kızıl Ufuk — cross-device input contract', () => {
  it('reports a healthy immutable parity audit', () => {
    const report = auditPlayerInputParity();
    expect(report.version).toBe(PLAYER_INPUT_CONTRACT_VERSION);
    expect(report.ok).toBe(true);
    expect(report.finiteAxis).toBe(true);
    expect(report.boundedAxis).toBe(true);
    expect(report.deterministicSequence).toBe(true);
    expect(report.expiryBounded).toBe(true);
    expect(report.immutableFrame).toBe(true);
    expect(report.deviceCoverage).toEqual(['keyboard', 'mouse', 'gamepad', 'touch']);
  });

  it('normalizes analog values once for every device family', () => {
    const axis = normalizePlayerInputAxis(2, Number.NaN);
    expect(axis).toEqual({ x: 1, y: 0, magnitude: 1 });
    expect(Object.isFrozen(axis)).toBe(true);

    const quiet = normalizePlayerInputAxis(0.01, -0.02);
    expect(quiet).toEqual({ x: 0, y: 0, magnitude: 0 });

    const frame = normalizePlayerInputFrame({
      sequence: -1,
      timestampSeconds: Number.NEGATIVE_INFINITY,
      forward: 4,
      strafe: -4,
      lookX: Number.POSITIVE_INFINITY,
      lookY: Number.NaN,
      cameraZoom: 4,
      actionCount: -8,
      device: 'touch',
    });
    expect(frame).toMatchObject({
      version: PLAYER_INPUT_CONTRACT_VERSION,
      sequence: 0,
      timestampSeconds: 0,
      forward: 1,
      strafe: -1,
      lookX: 0,
      lookY: 0,
      cameraZoom: 1,
      actionCount: 0,
      device: 'touch',
    });
    expect(Object.isFrozen(frame)).toBe(true);
  });

  it('keeps the radial deadzone continuous and bounded', () => {
    expect(applyGamepadRadialDeadzone(0, 0)).toEqual({ x: 0, y: 0, magnitude: 0 });
    expect(applyGamepadRadialDeadzone(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ x: 0, y: 0, magnitude: 0 });
    const diagonal = applyGamepadRadialDeadzone(0.7, -0.7);
    expect(diagonal.magnitude).toBeGreaterThan(0.8);
    expect(diagonal.magnitude).toBeLessThanOrEqual(1);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeLessThanOrEqual(1.000001);
  });

  it('keeps trigger deadzone monotonic', () => {
    expect(applyGamepadTriggerDeadzone(-1)).toBe(0);
    expect(applyGamepadTriggerDeadzone(0.08)).toBe(0);
    expect(applyGamepadTriggerDeadzone(0.5)).toBeGreaterThan(0.45);
    expect(applyGamepadTriggerDeadzone(0.9)).toBeGreaterThan(applyGamepadTriggerDeadzone(0.5));
    expect(applyGamepadTriggerDeadzone(1)).toBe(1);
  });

  it('preserves sprint hysteresis', () => {
    expect(resolveGamepadSprintIntent(0.71, true, false)).toBe(false);
    expect(resolveGamepadSprintIntent(0.72, true, false)).toBe(true);
    expect(resolveGamepadSprintIntent(0.58, true, true)).toBe(true);
    expect(resolveGamepadSprintIntent(0.54, true, true)).toBe(false);
    expect(resolveGamepadSprintIntent(1, false, true)).toBe(false);
  });

  it('keeps digital dpad parity and analog precedence deterministic', () => {
    const dpad = samplePlayerGamepad(makePad({ pressed: { 12: true, 15: true } }));
    expect(dpad.forward).toBeCloseTo(Math.SQRT1_2, 6);
    expect(dpad.strafe).toBeCloseTo(Math.SQRT1_2, 6);
    expect(dpad.magnitude).toBe(1);

    const analog = samplePlayerGamepad(makePad({ axes: [-0.6, 0], pressed: { 15: true } }));
    expect(analog.strafe).toBeLessThan(0);
    expect(analog.magnitude).toBeGreaterThan(0);
  });

  it('emits edge-triggered gamepad actions exactly once per press', () => {
    const first = samplePlayerGamepad(makePad({ pressed: { 0: true, 1: true, 2: true, 3: true, 5: true, 11: true } }));
    expect(first.jumpPressed).toBe(true);
    expect(first.dodgePressed).toBe(true);
    expect(first.lightPressed).toBe(true);
    expect(first.heavyPressed).toBe(true);
    expect(first.parryPressed).toBe(true);
    expect(first.lockOnPressed).toBe(true);

    const held = samplePlayerGamepad(makePad({ pressed: { 0: true, 1: true, 2: true, 3: true, 5: true, 11: true } }), first.buttons);
    expect(held.jumpPressed).toBe(false);
    expect(held.dodgePressed).toBe(false);
    expect(held.lightPressed).toBe(false);
    expect(held.heavyPressed).toBe(false);
    expect(held.parryPressed).toBe(false);
    expect(held.lockOnPressed).toBe(false);

    const released = samplePlayerGamepad(makePad());
    const secondPress = samplePlayerGamepad(makePad({ pressed: { 2: true } }), released.buttons);
    expect(secondPress.lightPressed).toBe(true);
  });

  it('selects connected standard gamepads with sticky-index preference', () => {
    const pads = [
      makePad({ index: 3, mapping: '' }),
      makePad({ index: 2 }),
      makePad({ index: 1 }),
    ];
    expect(selectPlayerGamepad(pads)?.index).toBe(1);
    expect(selectPlayerGamepad(pads, 2)?.index).toBe(2);
    expect(selectPlayerGamepad([pads[0]], 3)).toBeNull();
  });

  it('fails closed for unmapped gamepads', () => {
    const sample = samplePlayerGamepad(makePad({
      mapping: '',
      axes: [1, -1, 1, -1],
      pressed: { 0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 10: true, 11: true },
      values: { 6: 1, 7: 1 },
    }));
    expect(sample.forward).toBe(0);
    expect(sample.strafe).toBe(0);
    expect(sample.lookX).toBe(0);
    expect(sample.lookY).toBe(0);
    expect(sample.running).toBe(false);
    expect(sample.dodgePressed).toBe(false);
  });

  it('resolves haptic feedback only from authoritative evidence', () => {
    expect(resolvePlayerCombatFeedbackHaptic({ outcome: 'hit', appliedAmount: 12 })).not.toBeNull();
    expect(resolvePlayerCombatFeedbackHaptic({ outcome: 'guard', blockedAmount: 8 })).not.toBeNull();
    expect(resolvePlayerCombatFeedbackHaptic({ outcome: 'dodge', blockedAmount: 0 })).toBeNull();
    expect(resolvePlayerCombatFeedbackHaptic({ outcome: 'hit', appliedAmount: 0 })).toBeNull();
    expect(resolvePlayerCombatFeedbackHaptic({ outcome: 'guard-break', appliedAmount: 0, blockedAmount: 0 })).toBeNull();
    expect(resolvePlayerCombatFeedbackHaptic({ outcome: '__proto__', appliedAmount: 12 })).toBeNull();
  });

  it('buffers actions in FIFO order with deterministic expiry', () => {
    const buffer = new PlayerInputActionBuffer({ maxEntries: 3, ttlSeconds: 0.25 });
    const a = buffer.enqueue('light', 'keyboard', 'KeyE', 10);
    const b = buffer.enqueue('heavy', 'gamepad', 'button3', 10.05);
    const c = buffer.enqueue('dodge', 'touch', 'dodge', 10.1);
    expect([a.sequence, b.sequence, c.sequence]).toEqual([1, 2, 3]);
    expect(buffer.peek(10.2).map((entry) => entry.action)).toEqual(['light', 'heavy', 'dodge']);
    expect(buffer.drain(10.2, 2).map((entry) => entry.sequence)).toEqual([1, 2]);
    expect(buffer.peek(10.5)).toEqual([]);
    expect(buffer.snapshot(10.5).nextSequence).toBe(4);
  });

  it('bounds the action queue and never grows without limit', () => {
    const buffer = new PlayerInputActionBuffer({ maxEntries: 3, ttlSeconds: 1 });
    buffer.enqueue('light', 'keyboard', '1', 1);
    buffer.enqueue('heavy', 'keyboard', '2', 1.01);
    buffer.enqueue('parry', 'gamepad', '3', 1.02);
    buffer.enqueue('dodge', 'touch', '4', 1.03);
    expect(buffer.peek(1.04).map((entry) => entry.sequence)).toEqual([2, 3, 4]);
  });

  it('does not allocate combat input events for invalid action kinds', () => {
    expect(emitPlayerCombatIntent('light', 'test')).toBe(true);
    expect(emitPlayerCombatIntent('heavy', 'test')).toBe(true);
  });

  it('publishes cross-device input action events with frozen detail', () => {
    const events: unknown[] = [];
    const handler = (event: Event) => {
      if (event instanceof CustomEvent && event.type === 'aapw:player-input-action') events.push(event.detail);
    };
    globalThis.addEventListener('aapw:player-input-action', handler);
    try {
      expect(emitPlayerInputAction('jump', 'keyboard', 'keyboard')).toBe(true);
      expect(events).toHaveLength(1);
      const detail = events[0] as Record<string, unknown>;
      expect(detail).toMatchObject({ action: 'jump', source: 'keyboard', device: 'keyboard' });
      expect(typeof detail.timestampSeconds).toBe('number');
      expect(Object.isFrozen(detail)).toBe(true);
    } finally {
      globalThis.removeEventListener('aapw:player-input-action', handler);
    }
  });

  it('keeps KeyboardInput focus-loss semantics deterministic', () => {
    const target = new FakeTarget();
    const controller = new KeyboardInput(target as unknown as EventTarget & { hidden?: boolean });
    target.dispatch('keydown', {
      get code() { return 'KeyE'; },
      get target() { return null; },
      preventDefault() {},
    });
    expect(controller.consumeActionBuffer().map((entry) => entry.action)).toEqual(['light']);

    target.hidden = true;
    target.dispatch('visibilitychange');
    expect(controller.getInputFrame().actionCount).toBe(0);
    controller.dispose();
  });

  it('keeps the public frame sequence monotonic without requiring a game loop rewrite', () => {
    const target = new FakeTarget();
    const controller = new KeyboardInput(target as unknown as EventTarget & { hidden?: boolean });
    target.dispatch('keydown', {
      get code() { return 'Space'; },
      get target() { return null; },
      preventDefault() {},
    });
    const firstFrame = controller.getInputFrame();
    expect(firstFrame.version).toBe(PLAYER_INPUT_CONTRACT_VERSION);
    expect(firstFrame.sequence).toBeGreaterThan(0);
    const secondFrame = controller.getInputFrame();
    expect(secondFrame.sequence).toBeGreaterThanOrEqual(firstFrame.sequence);
    controller.dispose();
  });
});

describe('Kızıl Ufuk — event parity helpers', () => {
  it('keeps combat source-to-device mapping stable', () => {
    expect(emitPlayerCombatIntent('light', 'keyboard')).toBe(true);
    expect(emitPlayerCombatIntent('light', 'mouse')).toBe(true);
    expect(emitPlayerCombatIntent('light', 'gamepad')).toBe(true);
    expect(emitPlayerCombatIntent('light', 'touch')).toBe(true);
    expect(emitPlayerCombatIntent('heavy', 'keyboard')).toBe(true);
    expect(emitPlayerCombatIntent('heavy', 'mouse')).toBe(true);
    expect(emitPlayerCombatIntent('heavy', 'gamepad')).toBe(true);
    expect(emitPlayerCombatIntent('heavy', 'touch')).toBe(true);
  });
});
