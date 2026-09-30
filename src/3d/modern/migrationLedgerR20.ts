/** R20 strict-policy migration ledger. */
export const R20_STRICT_POLICY_MODULES = Object.freeze([
  {
    id: 'world-surface-policy-schema',
    path: 'src/3d/world/WorldSurfacePolicySchema.ts',
    ownership: 'production',
    escapeHatches: 0,
    deterministic: true,
  },
  {
    id: 'road-surface-profile',
    path: 'src/3d/world/roadSurfaceProfile.ts',
    ownership: 'production',
    escapeHatches: 0,
    deterministic: true,
  },
] as const);

export interface R20StrictPolicySnapshot {
  readonly version: 20;
  readonly tracked: number;
  readonly strictOwners: number;
  readonly escapeHatches: number;
  readonly coveragePercent: 100;
}

export function getR20StrictPolicySnapshot(): R20StrictPolicySnapshot {
  const tracked = R20_STRICT_POLICY_MODULES.length;
  const strictOwners = R20_STRICT_POLICY_MODULES.filter((module) => module.escapeHatches === 0).length;
  return Object.freeze({
    version: 20,
    tracked,
    strictOwners,
    escapeHatches: 0,
    coveragePercent: strictOwners === tracked ? 100 : 0,
  });
}
