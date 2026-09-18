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
});
