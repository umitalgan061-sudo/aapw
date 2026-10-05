import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  PLAYER_INPUT_BINDINGS_STORAGE_KEY,
  PLAYER_INPUT_CONTRACT_VERSION,
  PlayerInputActionBuffer,
  PlayerInputRecorder,
  PlayerInputLatencyMonitor,
  DEFAULT_PLAYER_INPUT_BINDINGS,
  DEFAULT_PLAYER_INPUT_CALIBRATION,
  KeyboardInput,
  applyGamepadRadialDeadzone,
  applyGamepadTriggerDeadzone,
  applyPlayerInputCurve,
  calibratePlayerInputAxis,
  createPlayerInputFrame,
  createPlayerInputSettingsStore,
  deserializePlayerInputBindings,
  diffPlayerInputFrames,
  normalizePlayerInputAxis,
  normalizePlayerInputBindings,
  validatePlayerInputBindings,
  mergePlayerInputBindings,
  resolvePlayerInputKeyAction,
  normalizePlayerInputCalibration,
  normalizePlayerInputFrame,
  readPlayerInputDeviceSnapshot,
  replayPlayerInputFrames,
  decodePlayerInputReplay,
  encodePlayerInputReplay,
  stablePlayerInputChecksum,
  quantizePlayerInputFrame,
  quantizePlayerInputTimestamp,
  createPlayerInputSampleClock,
  resolvePlayerInputDevicePriority,
  PlayerInputLatencyMonitor,
  resolveGamepadSprintIntent,
  resolvePlayerCombatFeedbackHaptic,
  samplePlayerGamepad,
  selectPlayerGamepad,
  serializePlayerInputBindings,
} from '../../src/3d/input.ts';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

class FakeInputTarget extends EventTarget {
  hidden = false;

  dispatchKeyboard(code: string): void {
    const event = new Event('keydown');
    Object.defineProperty(event, 'code', { value: code });
    Object.defineProperty(event, 'target', { value: null });
    this.dispatchEvent(event);
  }

  dispatchKeyUp(code: string): void {
    const event = new Event('keyup');
    Object.defineProperty(event, 'code', { value: code });
    this.dispatchEvent(event);
  }

  dispatch(type: string): void {
    this.dispatchEvent(new Event(type));
  }
}

const makePad = ({
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
} = {}) => ({
  index,
  mapping,
  connected,
  axes,
  buttons: Array.from({ length: 16 }, (_, buttonIndex) => ({
    pressed: Boolean(pressed[buttonIndex]) || Number(values[buttonIndex] ?? 0) >= 0.5,
    value: Number(values[buttonIndex] ?? (pressed[buttonIndex] ? 1 : 0)),
  })),
});

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

beforeEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      getGamepads: () => [],
      maxTouchPoints: 0,
    },
  });
});

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete (globalThis as { navigator?: unknown }).navigator;
});

describe('Kızıl Ufuk — cross-device input contract', () => {
  it('exposes one versioned immutable frame contract', () => {
    const frame = createPlayerInputFrame({
      device: 'touch',
      sequence: 4,
      timestampSeconds: 2.25,
      forward: 0.75,
      strafe: -0.25,
      running: true,
      guarding: false,
      jumpRequested: true,
      lightRequested: true,
    });
    expect(frame.version).toBe(PLAYER_INPUT_CONTRACT_VERSION);
    expect(frame.sequence).toBe(4);
    expect(frame.device).toBe('touch');
    expect(frame.forward).toBe(0.75);
    expect(frame.jumpRequested).toBe(true);
    expect(frame.lightRequested).toBe(true);
    expect(Object.isFrozen(frame)).toBe(true);
  });

  it('normalizes corrupted frame and axis values fail-closed', () => {
    const axis = normalizePlayerInputAxis(Number.POSITIVE_INFINITY, Number.NaN);
    expect(axis).toEqual({ x: 0, y: 0, magnitude: 0 });

    const frame = normalizePlayerInputFrame({
      forward: Number.POSITIVE_INFINITY,
      strafe: Number.NaN,
      lookX: Number.NEGATIVE_INFINITY,
      cameraZoom: 99,
      sequence: -1,
      actionCount: -2,
      timestampSeconds: Number.NaN,
    });
    expect(frame.forward).toBe(0);
    expect(frame.strafe).toBe(0);
    expect(frame.lookX).toBe(0);
    expect(frame.cameraZoom).toBe(1);
    expect(frame.sequence).toBe(0);
    expect(frame.actionCount).toBe(0);
    expect(frame.timestampSeconds).toBe(0);
  });

  it('keeps gamepad radial and trigger deadzones bounded', () => {
    expect(applyGamepadRadialDeadzone(0.01, -0.02)).toEqual({ x: 0, y: 0, magnitude: 0 });
    const diagonal = applyGamepadRadialDeadzone(0.7, -0.7);
    expect(diagonal.magnitude).toBeGreaterThan(0.8);
    expect(diagonal.magnitude).toBeLessThanOrEqual(1);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeLessThanOrEqual(1.000001);

    expect(applyGamepadTriggerDeadzone(0.05)).toBe(0);
    expect(applyGamepadTriggerDeadzone(0.08)).toBe(0);
    expect(applyGamepadTriggerDeadzone(0.5)).toBeGreaterThan(0.45);
    expect(applyGamepadTriggerDeadzone(1)).toBe(1);
  });

  it('keeps sprint hysteresis deterministic around the threshold', () => {
    expect(resolveGamepadSprintIntent(0.71, true, false)).toBe(false);
    expect(resolveGamepadSprintIntent(0.72, true, false)).toBe(true);
    expect(resolveGamepadSprintIntent(0.58, true, true)).toBe(true);
    expect(resolveGamepadSprintIntent(0.54, true, true)).toBe(false);
    expect(resolveGamepadSprintIntent(1, false, true)).toBe(false);
  });

  it('preserves dpad diagonal normalization and analog precedence', () => {
    const dpad = samplePlayerGamepad(makePad({ pressed: { 12: true, 15: true } }));
    expect(dpad.forward).toBeCloseTo(Math.SQRT1_2, 6);
    expect(dpad.strafe).toBeCloseTo(Math.SQRT1_2, 6);
    expect(dpad.magnitude).toBe(1);

    const analog = samplePlayerGamepad(makePad({ axes: [-0.6, 0], pressed: { 15: true } }));
    expect(analog.strafe).toBeLessThan(0);
    expect(analog.magnitude).toBeGreaterThan(0);
  });

  it('emits each gamepad action only on the press edge', () => {
    const first = samplePlayerGamepad(makePad({
      pressed: { 0: true, 1: true, 2: true, 3: true, 5: true, 11: true },
    }));
    expect(first.jumpPressed).toBe(true);
    expect(first.dodgePressed).toBe(true);
    expect(first.lightPressed).toBe(true);
    expect(first.heavyPressed).toBe(true);
    expect(first.parryPressed).toBe(true);
    expect(first.lockOnPressed).toBe(true);

    const held = samplePlayerGamepad(makePad({
      pressed: { 0: true, 1: true, 2: true, 3: true, 5: true, 11: true },
    }), first.buttons);
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

  it('fails closed for disconnected or unmapped gamepads', () => {
    const disconnected = samplePlayerGamepad(makePad({ connected: false }));
    const unmapped = samplePlayerGamepad(makePad({ mapping: '', axes: [1, -1, 1, -1], pressed: { 0: true, 2: true, 3: true } }));
    expect(disconnected.forward).toBe(0);
    expect(unmapped.forward).toBe(0);
    expect(unmapped.lookX).toBe(0);
    expect(unmapped.running).toBe(false);
    expect(unmapped.lightPressed).toBe(false);
  });

  it('selects a standard connected controller deterministically', () => {
    const pads = [makePad({ index: 3, mapping: '' }), makePad({ index: 2 }), makePad({ index: 1 })];
    expect(selectPlayerGamepad(pads)?.index).toBe(1);
    expect(selectPlayerGamepad(pads, 2)?.index).toBe(2);
    expect(selectPlayerGamepad([pads[0]], 3)).toBeNull();
  });

  it('resolves combat haptic feedback only from authoritative evidence', () => {
    expect(resolvePlayerCombatFeedbackHaptic({ outcome: 'hit', appliedAmount: 12 })).not.toBeNull();
    expect(resolvePlayerCombatFeedbackHaptic({ outcome: 'guard', blockedAmount: 8 })).not.toBeNull();
    expect(resolvePlayerCombatFeedbackHaptic({ outcome: 'dodge', blockedAmount: 0 })).toBeNull();
    expect(resolvePlayerCombatFeedbackHaptic({ outcome: 'hit', appliedAmount: 0 })).toBeNull();
    expect(resolvePlayerCombatFeedbackHaptic({ outcome: 'guard-break', appliedAmount: 0, blockedAmount: 0 })).toBeNull();
    expect(resolvePlayerCombatFeedbackHaptic({ outcome: '__proto__', appliedAmount: 12 })).toBeNull();
  });

  it('buffers actions in FIFO order with bounded TTL and capacity', () => {
    const buffer = new PlayerInputActionBuffer({ maxEntries: 3, ttlSeconds: 0.2 });
    const first = buffer.enqueue('light', 'keyboard', 'KeyE', 1);
    const second = buffer.enqueue('heavy', 'mouse', 'button0', 1.02);
    const third = buffer.enqueue('dodge', 'gamepad', 'button1', 1.04);
    const fourth = buffer.enqueue('parry', 'touch', 'pointerdown', 1.05);
    expect([first.sequence, second.sequence, third.sequence, fourth.sequence]).toEqual([1, 2, 3, 4]);
    expect(buffer.peek(1.1).map((entry) => entry.sequence)).toEqual([2, 3, 4]);
    expect(buffer.drain(1.1, 2).map((entry) => entry.action)).toEqual(['heavy', 'dodge']);
    expect(buffer.peek(1.3)).toEqual([]);
  });

  it('never lets the action queue grow past its hard cap', () => {
    const buffer = new PlayerInputActionBuffer({ maxEntries: 3, ttlSeconds: 1 });
    for (let index = 0; index < 10; index += 1) buffer.enqueue('light', 'keyboard', String(index), 1 + index * 0.01);
    expect(buffer.peek(1.2)).toHaveLength(3);
  });

  it('normalizes, persists and restores remappable controls', () => {
    const bindings = normalizePlayerInputBindings({
      forward: ['KeyI', 'KeyI', '', 7],
      back: ['KeyK'],
      lightAttack: ['KeyF'],
      heavyAttack: ['KeyG'],
    });
    const restored = deserializePlayerInputBindings(serializePlayerInputBindings(bindings));
    expect(restored).toEqual(bindings);
    expect(restored.forward).toEqual(['KeyI']);
    expect(deserializePlayerInputBindings('broken-json')).toEqual(DEFAULT_PLAYER_INPUT_BINDINGS);

    const storage = new MemoryStorage();
    const store = createPlayerInputSettingsStore(storage);
    store.save(bindings);
    expect(storage.getItem(PLAYER_INPUT_BINDINGS_STORAGE_KEY)).toContain('KeyF');
    expect(store.load()).toEqual(bindings);
    store.clear();
    expect(store.load()).toEqual(DEFAULT_PLAYER_INPUT_BINDINGS);
  });

  it('calibrates stick response with deterministic curves and sensitivity bounds', () => {
    expect(applyPlayerInputCurve(0.5, 2)).toBeCloseTo(0.25, 8);
    expect(applyPlayerInputCurve(-0.5, 2)).toBeCloseTo(-0.25, 8);
    const calibration = normalizePlayerInputCalibration({
      deadzone: 0.2,
      curve: 1.7,
      lookSensitivity: 1.5,
      zoomSensitivity: 2,
      maxMagnitude: 0.8,
    });
    expect(calibration.deadzone).toBe(0.2);
    const axis = calibratePlayerInputAxis(0.8, -0.4, calibration);
    expect(Math.hypot(axis.x, axis.y)).toBeLessThanOrEqual(0.800001);
  });

  it('keeps a replay envelope tamper-evident and fixed-tick deterministic', () => {
    const frames = [
      createPlayerInputFrame({ sequence: 1, timestampSeconds: 0.010, device: 'keyboard', forward: 1 }),
      createPlayerInputFrame({ sequence: 2, timestampSeconds: 0.028, device: 'gamepad', forward: 0.5 }),
    ];
    const encoded = encodePlayerInputReplay(frames, 1 / 60);
    const decoded = decodePlayerInputReplay(encoded);
    expect(decoded.ok).toBe(true);
    expect(decoded.envelope?.checksum).toBe(stablePlayerInputChecksum(frames));
    expect(decoded.envelope?.tickSeconds).toBeCloseTo(1 / 60, 6);
    expect(decoded.envelope?.frames).toHaveLength(2);

    const tampered = encoded.replace('0.5', '0.6');
    expect(decodePlayerInputReplay(tampered).ok).toBe(false);
    expect(decodePlayerInputReplay('bad json').error).toBe('invalid-json');
    expect(decodePlayerInputReplay(JSON.stringify({ version: 'wrong', frames: [] })).error).toBe('invalid-version-or-frames');

    expect(quantizePlayerInputTimestamp(0.024, 1 / 60)).toBeCloseTo(1 / 60, 6);
    const quantized = quantizePlayerInputFrame(frames[0], 1 / 60);
    expect(quantized.timestampSeconds).toBeCloseTo(1 / 60, 6);
  });

  it('advances the input sample clock on deterministic fixed ticks', () => {
    const clock = createPlayerInputSampleClock(1 / 60);
    expect(clock.tickIndex).toBe(0);
    expect(clock.advance(0.010)).toBe(0);
    expect(clock.advance(0.010)).toBe(1);
    expect(clock.tickIndex).toBe(1);
    expect(clock.timestampSeconds).toBeCloseTo(1 / 60, 6);
    expect(clock.advance(0.050)).toBe(3);
    expect(clock.tickIndex).toBe(4);
    clock.reset(0.5);
    expect(clock.tickIndex).toBe(30);
    expect(clock.timestampSeconds).toBeCloseTo(0.5, 6);
  });

  it('prioritizes the last active device while preserving availability', () => {
    const gamepadFirst = resolvePlayerInputDevicePriority('gamepad', {
      gamepad: true,
      touch: true,
      keyboard: true,
      mouse: true,
    });
    expect(gamepadFirst[0].device).toBe('gamepad');
    expect(gamepadFirst[0].score).toBeGreaterThan(gamepadFirst[1].score);

    const touchFirst = resolvePlayerInputDevicePriority('touch', { gamepad: false, touch: true });
    expect(touchFirst[0].device).toBe('touch');
    expect(touchFirst.find((entry) => entry.device === 'gamepad')?.available).toBe(false);
  });

  it('keeps latency monitor statistics bounded and healthy under normal input timing', () => {
    const monitor = new PlayerInputLatencyMonitor(32);
    const buffer = new PlayerInputActionBuffer({ maxEntries: 32, ttlSeconds: 1 });
    for (let index = 0; index < 8; index += 1) {
      const record = buffer.enqueue('light', 'keyboard', 'KeyE', index);
      monitor.mark(record);
      monitor.observe(createPlayerInputFrame({
        sequence: record.sequence,
        device: 'keyboard',
        timestampSeconds: index + 0.02,
      }));
    }
    const snapshot = monitor.snapshot();
    expect(snapshot.sampleCount).toBe(8);
    expect(snapshot.meanSeconds).toBeCloseTo(0.02, 4);
    expect(snapshot.p50Seconds).toBeCloseTo(0.02, 4);
    expect(snapshot.p95Seconds).toBeCloseTo(0.02, 4);
    expect(snapshot.maxSeconds).toBeCloseTo(0.02, 4);
    expect(snapshot.healthy).toBe(true);
  });

  it('records only while enabled and enforces bounded replay history', () => {
    const recorder = new PlayerInputRecorder({ maxFrames: 2 });
    const frames = [1, 2, 3].map((sequence) => createPlayerInputFrame({
      sequence,
      device: sequence % 2 === 0 ? 'gamepad' : 'keyboard',
      timestampSeconds: sequence / 60,
      forward: sequence / 3,
    }));
    recorder.record(frames[0]);
    expect(recorder.snapshot().frameCount).toBe(0);
    recorder.start();
    frames.forEach((frame) => recorder.record(frame));
    recorder.stop();
    expect(recorder.snapshot().frames.map((frame) => frame.sequence)).toEqual([2, 3]);
    const clone = new PlayerInputRecorder({ maxFrames: 2 });
    expect(clone.load(JSON.parse(recorder.serialize()))).toBe(2);
    expect(clone.next()?.sequence).toBe(2);
    expect(clone.next()?.sequence).toBe(3);
  });

  it('compares replay frames by gameplay values rather than source device metadata', () => {
    const keyboard = createPlayerInputFrame({ sequence: 1, device: 'keyboard', forward: 0.4, strafe: 0.2 });
    const gamepad = createPlayerInputFrame({ sequence: 8, device: 'gamepad', forward: 0.4, strafe: 0.2 });
    expect(diffPlayerInputFrames(keyboard, gamepad)).toEqual({ equal: true, reasons: [] });
    const drift = createPlayerInputFrame({ sequence: 9, device: 'gamepad', forward: 0.41, strafe: 0.2 });
    expect(diffPlayerInputFrames(keyboard, drift).reasons).toContain('forward');
  });

  it('replays frames in exact source order', () => {
    const frames = [1, 2, 3].map((sequence) => createPlayerInputFrame({ sequence, forward: sequence / 3 }));
    const seen: number[] = [];
    replayPlayerInputFrames(frames, (frame, index) => seen.push(frame.sequence * 10 + index));
    expect(seen).toEqual([10, 21, 32]);
  });

  it('keeps the existing KeyboardInput owner compatible with getAxes()', () => {
    const target = new FakeInputTarget();
    const controller = new KeyboardInput(target as unknown as EventTarget & { hidden?: boolean });
    target.dispatchKeyboard('KeyW');
    expect(controller.getAxes().forward).toBe(1);
    target.dispatchKeyUp('KeyW');
    expect(controller.getAxes().forward).toBe(0);
    controller.dispose();
  });

  it('supports constructor-level remapping without creating another input framework', () => {
    const target = new FakeInputTarget();
    const controller = new KeyboardInput(target as unknown as EventTarget & { hidden?: boolean }, {
      bindings: { forward: ['KeyI'], back: ['KeyK'], left: ['KeyJ'], right: ['KeyL'] },
    });
    target.dispatchKeyboard('KeyI');
    expect(controller.getAxes().forward).toBe(1);
    target.dispatchKeyUp('KeyI');
    target.dispatchKeyboard('KeyW');
    expect(controller.getAxes().forward).toBe(0);
    controller.dispose();
  });

  it('latches and exposes keyboard combat edges through the canonical buffer', () => {
    const target = new FakeInputTarget();
    const controller = new KeyboardInput(target as unknown as EventTarget & { hidden?: boolean });
    target.dispatchKeyboard('KeyE');
    target.dispatchKeyboard('KeyE');
    const action = controller.consumeActionBuffer();
    expect(action.map((entry) => entry.action)).toEqual(['light']);
    controller.dispose();
  });

  it('disarms held and buffered inputs when the page loses focus', () => {
    const target = new FakeInputTarget();
    const controller = new KeyboardInput(target as unknown as EventTarget & { hidden?: boolean });
    target.dispatchKeyboard('KeyE');
    target.dispatchKeyboard('Space');
    expect(controller.consumeActionBuffer().length).toBe(2);
    target.dispatch('blur');
    expect(controller.consumeActionBuffer()).toEqual([]);
    expect(controller.getAxes().jumpRequested).toBe(false);
    controller.dispose();
  });

  it('keeps input device snapshot finite and safe with no controller attached', () => {
    const snapshot = readPlayerInputDeviceSnapshot();
    expect(snapshot.version).toBe(PLAYER_INPUT_CONTRACT_VERSION);
    expect(snapshot.gamepad).toBe(false);
    expect(snapshot.gamepadIndex).toBeNull();
    expect(typeof snapshot.keyboard).toBe('boolean');
    expect(typeof snapshot.pointer).toBe('boolean');
    expect(typeof snapshot.touch).toBe('boolean');
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});
