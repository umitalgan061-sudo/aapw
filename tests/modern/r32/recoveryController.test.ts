import { describe, expect, it } from 'vitest';
import {
  RuntimeRecoveryController,
  classifyRuntimeError,
  createFaultBoundary,
} from '../../../src/3d/modern/r32/recoveryController.ts';
import { RuntimeError } from '../../../src/3d/modern/r32/contracts.ts';

describe('R32 recovery controller', () => {
  it('backs off repeated recoverable faults', () => {
    const controller=new RuntimeRecoveryController({
      baseBackoffTicks:5,
      maxBackoffTicks:20,
      maxAttempts:4,
    });

    const first=controller.report({
      class:'render',
      message:'device timeout',
      tick:10,
      recoverable:true,
    });

    expect(first.state).toBe('suspect');
    expect(first.nextAttemptTick).toBe(15);
    expect(controller.beginAttempt(10)).toBe(false);
    expect(controller.beginAttempt(15)).toBe(true);

    controller.resolve(16);

    expect(controller.snapshot(16).state).toBe('healthy');
    expect(controller.snapshot(16).attempt).toBe(0);
  });

  it('quarantines non recoverable faults', () => {
    const controller=new RuntimeRecoveryController();

    const snapshot=controller.report({
      class:'state',
      message:'corrupt snapshot',
      tick:3,
      recoverable:false,
    });

    expect(snapshot.state).toBe('quarantined');
    expect(controller.canContinue()).toBe(false);
  });

  it('classifies runtime errors by subsystem', () => {
    expect(classifyRuntimeError(
      new RuntimeError({
        code:'R32_NETWORK_PACKET',
        message:'packet',
      }),
    )).toBe('network');

    expect(classifyRuntimeError(
      new RuntimeError({
        code:'R32_RENDER_CYCLE',
        message:'cycle',
      }),
    )).toBe('render');

    expect(classifyRuntimeError(new Error('unknown'))).toBe('unknown');
  });

  it('converts boundary failures into typed recovery errors', () => {
    const controller=new RuntimeRecoveryController();
    const boundary=createFaultBoundary(
      controller,
      () => 7,
      'world',
    );

    expect(() => boundary.execute(() => {
      throw new Error('broken');
    })).toThrow('Runtime operation failed');

    expect(controller.faults()).toHaveLength(1);
    expect(controller.faults()[0]?.class).toBe('world');
  });
});
