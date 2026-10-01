import { describe, expect, it } from 'vitest';
import { integratePlayerJumpArc, resolvePlayerJumpIntent } from '../../src/3d/gameplay/playerPhysics.ts';

describe('Kızıl Ufuk player jump stability', () => {
  it('buffers a jump pressed just before landing and consumes it once grounded', () => {
    const buffered = resolvePlayerJumpIntent({ isGrounded: false, jumpRequested: true, deltaSeconds: 0 });
    expect(buffered.shouldJump).toBe(false);
    expect(buffered.jumpBufferRemainingSeconds).toBeCloseTo(0.12, 3);
    const landed = resolvePlayerJumpIntent({
      isGrounded: true,
      jumpBufferRemainingSeconds: buffered.jumpBufferRemainingSeconds,
      deltaSeconds: 0.03,
    });
    expect(landed.shouldJump).toBe(true);
    expect(landed.jumpBufferRemainingSeconds).toBe(0);
  });

  it('allows a short coyote-time jump after leaving the ground, but never during run+jump dodge input', () => {
    const coyote = resolvePlayerJumpIntent({
      isGrounded: false,
      coyoteRemainingSeconds: 0.1,
      jumpRequested: true,
      deltaSeconds: 0.02,
    });
    expect(coyote.shouldJump).toBe(true);

    const dodgeIntent = resolvePlayerJumpIntent({
      isGrounded: true,
      jumpRequested: true,
      runIntent: true,
    });
    expect(dodgeIntent.shouldJump).toBe(false);
  });
  it('preserves landing at zero with a large frame gap', () => {
    const result = integratePlayerJumpArc(0.05, -2, 0.1, -20);
    expect(result.isGrounded).toBe(true);
    expect(result.heightAboveGroundMeters).toBe(0);
    expect(result.velocityYMps).toBe(0);
    expect(result.simulationSteps).toBeGreaterThan(1);
  });

  it('sub-steps a long browser frame instead of integrating one unstable jump step', () => {
    const result = integratePlayerJumpArc(10, 0, 0.5, -20);
    expect(result.simulationSteps).toBeGreaterThan(20);
    expect(result.isGrounded).toBe(false);
    expect(Number.isFinite(result.heightAboveGroundMeters)).toBe(true);
    expect(Number.isFinite(result.velocityYMps)).toBe(true);
  });

  it('fails closed for NaN/Infinity input', () => {
    const result = integratePlayerJumpArc(Number.NaN, Number.POSITIVE_INFINITY, Number.NaN, Number.NEGATIVE_INFINITY);
    expect(result.isGrounded).toBe(true);
    expect(result.heightAboveGroundMeters).toBe(0);
    expect(result.velocityYMps).toBe(0);
    expect(result.simulationSteps).toBe(0);
  });

  it('honors a stricter fall-speed ceiling without changing the ground contract', () => {
    const result = integratePlayerJumpArc(20, -100, 0.2, -20, { maxFallSpeedMps: 12, maxStepSeconds: 1 / 120 });
    expect(result.isGrounded).toBe(false);
    expect(result.velocityYMps).toBeGreaterThanOrEqual(-12);
    expect(result.simulationSteps).toBeGreaterThan(20);
  });
});
