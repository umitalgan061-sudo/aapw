import { describe, expect, it } from 'vitest';
import {
  createPlayerCombatRuntimeFrameGuard,
  PLAYER_COMBAT_RUNTIME_FRAME_GUARD_VERSION,
} from '../../src/3d/gameplay/playerCombatRuntimeFrameGuard.js';

const frame = (payload = {}) => ({
  version: PLAYER_COMBAT_RUNTIME_FRAME_GUARD_VERSION,
  revision: 0,
  timestamp: 0,
  attack: { serial: 0 },
  payload,
});

describe('player combat runtime frame guard payload contract', () => {
  it('rejects non-plain object nodes instead of silently cloning them', () => {
    const guard = createPlayerCombatRuntimeFrameGuard();
    const result = guard.inspect(frame({ createdAt: new Date(0) }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('payload-object-type-unsupported');
    expect(guard.readState().rejected).toBe(1);
  });

  it('rejects executable and non-data primitive payload values', () => {
    const guard = createPlayerCombatRuntimeFrameGuard();
    expect(guard.inspect(frame({ callback: () => true })).reason).toBe('payload-value-type-unsupported');
    expect(guard.inspect(frame({ token: Symbol('token') })).reason).toBe('payload-value-type-unsupported');
    expect(guard.inspect(frame({ count: 1n })).reason).toBe('payload-value-type-unsupported');
    expect(guard.readState().accepted).toBe(0);
    expect(guard.readState().rejected).toBe(3);
  });

  it('rejects non-enumerable accessors instead of dropping hidden metadata during cloning', () => {
    const payload = {};
    Object.defineProperty(payload, 'hidden', {
      configurable: true,
      enumerable: false,
      get() {
        return 'unstable';
      },
    });
    const guard = createPlayerCombatRuntimeFrameGuard();
    const result = guard.inspect(frame(payload));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('payload-accessor-unsupported');
    expect(result.frame).toBe(null);
  });

  it('accepts null-prototype records and keeps the accepted snapshot immutable', () => {
    const payload = Object.create(null);
    payload.combo = { step: 1 };
    const guard = createPlayerCombatRuntimeFrameGuard();
    const result = guard.inspect(frame(payload));
    expect(result.ok).toBe(true);
    expect(Object.isFrozen(result.frame)).toBe(true);
    expect(Object.isFrozen(result.frame.payload)).toBe(true);
    expect(result.frame.payload.combo.step).toBe(1);
  });

  it('fails closed when a proxy throws during payload inspection', () => {
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error('hostile ownKeys');
      },
    });
    const guard = createPlayerCombatRuntimeFrameGuard();
    const result = guard.inspect(frame({ hostile }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('payload-inspection-failed');
    expect(result.frame).toBe(null);
  });
});
