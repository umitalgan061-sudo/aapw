import type { HardeningPolicy } from '../strict/runtimeHardeningV25.ts';

export interface RuntimeHardeningMigrationV25 {
  readonly version: 25;
  readonly owner: 'modern-runtime-facade';
  readonly implementation: 'src/3d/strict/runtimeHardeningV25.ts';
  readonly capabilities: readonly string[];
  readonly policy: HardeningPolicy;
}

export const RUNTIME_HARDENING_MIGRATION_V25: RuntimeHardeningMigrationV25 = Object.freeze({
  version: 25,
  owner: 'modern-runtime-facade',
  implementation: 'src/3d/strict/runtimeHardeningV25.ts',
  capabilities: Object.freeze([
    'bounded-health-budget',
    'failure-window-circuit-breaker',
    'operation-abort-timeout',
    'hysteretic-recovery',
    'immutable-diagnostics-snapshot',
    'typed-failure-records',
  ]),
  policy: Object.freeze({
    failureWindowMs: 8_000,
    maxFailuresPerWindow: 5,
    recoverySamples: 6,
    operationTimeoutMs: 12_000,
    historyCapacity: 96,
  }),
});
