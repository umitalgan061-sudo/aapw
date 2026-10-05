import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PLAYER_INPUT_CONTRACT_VERSION,
  createPlayerInputFrame,
  PlayerInputActionBuffer,
  PlayerInputRecorder,
  normalizePlayerInputBindings,
  normalizePlayerInputCalibration,
  readPlayerInputDeviceSnapshot,
  diffPlayerInputFrames,
} from '../../src/3d/input.ts';

describe('Kızıl Ufuk touch/input parity contract', () => {
  it('keeps the touch controller on the same versioned frame contract', () => {
    const frame = createPlayerInputFrame({
      device: 'touch',
      sequence: 11,
      forward: 1,
      strafe: 0,
      running: true,
      guarding: true,
      dodgeRequested: true,
      parryRequested: true,
      lightRequested: true,
      heavyRequested: true,
    });
    expect(frame.version).toBe(PLAYER_INPUT_CONTRACT_VERSION);
    expect(frame.device).toBe('touch');
    expect(frame.dodgeRequested).toBe(true);
    expect(frame.parryRequested).toBe(true);
    expect(frame.lightRequested).toBe(true);
    expect(frame.heavyRequested).toBe(true);
  });

  it('keeps a bounded action buffer usable as a cross-device command latch', () => {
    const buffer = new PlayerInputActionBuffer({ maxEntries: 4, ttlSeconds: 0.3 });
    buffer.enqueue('jump', 'touch', 'jump', 10);
    buffer.enqueue('dodge', 'touch', 'dodge', 10.01);
    buffer.enqueue('parry', 'touch', 'parry', 10.02);
    expect(buffer.peek(10.1).map((entry) => entry.device)).toEqual(['touch', 'touch', 'touch']);
    expect(buffer.drain(10.1, 10)).toHaveLength(3);
    expect(buffer.peek(10.4)).toEqual([]);
  });

  it('keeps persistence and calibration adapters serializable', () => {
    const bindings = normalizePlayerInputBindings({ lightAttack: ['KeyF'], heavyAttack: ['KeyG'] });
    expect(JSON.parse(JSON.stringify(bindings)).lightAttack).toEqual(['KeyF']);
    const calibration = normalizePlayerInputCalibration({ deadzone: 0.22, curve: 1.35, maxMagnitude: 0.9 });
    expect(calibration.deadzone).toBe(0.22);
    expect(calibration.curve).toBe(1.35);
    expect(calibration.maxMagnitude).toBe(0.9);
  });

  it('keeps device snapshot safe in a PWA with no gamepad', () => {
    const snapshot = readPlayerInputDeviceSnapshot();
    expect(snapshot.version).toBe(PLAYER_INPUT_CONTRACT_VERSION);
    expect(snapshot.gamepadIndex).toBeNull();
    expect(snapshot.gamepad).toBe(false);
  });

  it('does not flag device-only provenance changes as gameplay divergence', () => {
    const left = createPlayerInputFrame({ sequence: 1, device: 'touch', forward: 0.5, strafe: 0.1, running: true });
    const right = createPlayerInputFrame({ sequence: 7, device: 'gamepad', forward: 0.5, strafe: 0.1, running: true });
    expect(diffPlayerInputFrames(left, right)).toEqual({ equal: true, reasons: [] });
  });

  it('keeps replay history bounded', () => {
    const recorder = new PlayerInputRecorder({ maxFrames: 2 });
    recorder.start();
    recorder.record(createPlayerInputFrame({ sequence: 1 }));
    recorder.record(createPlayerInputFrame({ sequence: 2 }));
    recorder.record(createPlayerInputFrame({ sequence: 3 }));
    recorder.stop();
    expect(recorder.snapshot().frames.map((frame) => frame.sequence)).toEqual([2, 3]);
  });

  it('proves the touch owner actually consumes the same input API', () => {
    const source = readFileSync(new URL('../../src/3d/ui/touchJoystick.ts', import.meta.url), 'utf8');
    expect(source).toContain("from '../input.ts'");
    expect(source).toContain('PlayerInputActionBuffer');
    expect(source).toContain('createPlayerInputFrame');
    expect(source).toContain("this._queueAction('dodge')");
    expect(source).toContain("this._queueAction('parry')");
    expect(source).toContain("this._vibrate(34)");
    expect(source).toContain("this._vibrate(22)");
    expect(source).toContain('consumeActionBuffer');
    expect(source).toContain('setEnabled');
    expect(source).not.toContain('@ts-nocheck');
  });
});
