export interface ProductionRuntimeSupervisorMigrationR36 {
  readonly version: 36;
  readonly owner: 'strict-runtime';
  readonly productionOwner: 'src/3d/strict/productionRuntimeSupervisorR36.ts';
  readonly dependencies: readonly [
    'runtimeWatchdogR33',
    'runtimeHardeningV25',
    'runtimeCircuitBreakerR12',
    'renderBackendRuntime',
  ];
  readonly deterministic: true;
  readonly adaptiveQuality: true;
  readonly deviceLossRecovery: true;
  readonly boundedHistory: true;
  readonly immutableDecisions: true;
}

export const PRODUCTION_RUNTIME_SUPERVISOR_MIGRATION_R36: ProductionRuntimeSupervisorMigrationR36 = Object.freeze({
  version: 36,
  owner: 'strict-runtime',
  productionOwner: 'src/3d/strict/productionRuntimeSupervisorR36.ts',
  dependencies: Object.freeze([
    'runtimeWatchdogR33',
    'runtimeHardeningV25',
    'runtimeCircuitBreakerR12',
    'renderBackendRuntime',
  ] as const),
  deterministic: true,
  adaptiveQuality: true,
  deviceLossRecovery: true,
  boundedHistory: true,
  immutableDecisions: true,
});
