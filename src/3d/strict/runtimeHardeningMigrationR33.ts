export interface RuntimeHardeningMigrationR33 {
  readonly version: 33;
  readonly modules: readonly {
    readonly path: string;
    readonly status: 'strict';
    readonly guarantees: readonly string[];
  }[];
}

export const RUNTIME_HARDENING_MIGRATION_R33: RuntimeHardeningMigrationR33 = Object.freeze({
  version: 33,
  modules: Object.freeze([
    {
      path: 'src/3d/camera.ts',
      status: 'strict',
      guarantees: Object.freeze(['no-ts-nocheck', 'typed-three-contracts', 'collision-return-type']),
    },
    {
      path: 'src/3d/renderBackendCapability.ts',
      status: 'strict',
      guarantees: Object.freeze(['no-ts-nocheck', 'typed-capability-contracts', 'headless-safe-detection']),
    },
    {
      path: 'src/3d/strict/runtimeWatchdogR33.ts',
      status: 'strict',
      guarantees: Object.freeze(['bounded-history', 'pressure-hysteresis', 'invalid-metric-sanitization']),
    },
  ]),
});
