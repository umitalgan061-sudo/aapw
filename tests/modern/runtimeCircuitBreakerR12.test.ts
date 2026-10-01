import { describe, expect, it } from 'vitest';
import { RuntimeCircuitBreakerR12 } from '../../src/3d/strict/runtimeCircuitBreakerR12.ts';

describe('R12 runtime circuit breaker', () => {
  it('opens after the configured failure threshold and blocks execution during cooldown', () => {
    let now = 0;
    const circuit = new RuntimeCircuitBreakerR12({
      failureThreshold: 2,
      cooldownMs: 500,
      now: () => now,
    });

    expect(circuit.canExecute()).toBe(true);
    circuit.recordFailure('frame', new Error('one'));
    expect(circuit.snapshot().state).toBe('closed');
    circuit.recordFailure('frame', new Error('two'));

    expect(circuit.snapshot().state).toBe('open');
    expect(circuit.canExecute()).toBe(false);

    now = 500;
    expect(circuit.canExecute()).toBe(true);
    expect(circuit.snapshot().state).toBe('half-open');
  });

  it('requires multiple successful probes before recovery', () => {
    let now = 0;
    const circuit = new RuntimeCircuitBreakerR12({
      failureThreshold: 1,
      cooldownMs: 10,
      recoverySuccesses: 2,
      now: () => now,
    });

    circuit.recordFailure('renderer', new Error('boom'));
    now = 10;
    expect(circuit.canExecute()).toBe(true);
    circuit.recordSuccess('probe-1');
    expect(circuit.snapshot().state).toBe('half-open');
    circuit.recordSuccess('probe-2');
    expect(circuit.snapshot().state).toBe('closed');
    expect(circuit.canExecute()).toBe(true);
  });

  it('keeps history bounded and dispose is final', () => {
    const circuit = new RuntimeCircuitBreakerR12({ historyCapacity: 8 });
    for (let index = 0; index < 32; index += 1) circuit.recordFailure('test', new Error(String(index)));
    expect(circuit.snapshot().history.length).toBeLessThanOrEqual(8);
    circuit.dispose();
    expect(circuit.snapshot().state).toBe('disposed');
    expect(circuit.canExecute()).toBe(false);
  });
});
