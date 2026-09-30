/** R16 strict-runtime ledger: tracked production owners with TypeScript escape hatches removed. */
export const R16_STRICT_RUNTIME_MODULES = Object.freeze([
  { id: 'render-quality', legacyPath: 'src/3d/renderQuality.js', modernPath: 'src/3d/renderQuality.ts', strict: true },
  { id: 'fog', legacyPath: 'src/3d/fog.js', modernPath: 'src/3d/fog.ts', strict: true },
  { id: 'safe-mode', legacyPath: 'src/3d/safeMode.js', modernPath: 'src/3d/safeMode.ts', strict: true },
  { id: 'health', legacyPath: 'src/3d/gameplay/health.js', modernPath: 'src/3d/gameplay/health.ts', strict: true },
] as const);

export interface R16StrictRuntimeSnapshot {
  readonly version: 16;
  readonly tracked: number;
  readonly strictOwners: number;
  readonly coveragePercent: number;
}

export function getR16StrictRuntimeSnapshot(): R16StrictRuntimeSnapshot {
  const tracked = R16_STRICT_RUNTIME_MODULES.length;
  const strictOwners = R16_STRICT_RUNTIME_MODULES.filter((entry) => entry.strict).length;
  return Object.freeze({
    version: 16,
    tracked,
    strictOwners,
    coveragePercent: tracked === 0 ? 100 : Number(((strictOwners / tracked) * 100).toFixed(2)),
  });
}
