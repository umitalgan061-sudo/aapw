/** R21 strict-runtime-core migration ledger. */
export const R21_STRICT_RUNTIME_MODULES = Object.freeze([
  { id: 'signal-adapters', path: 'src/3d/runtime/runtimeSignalAdapters.ts', escapeHatches: 0, deterministic: true },
  { id: 'fixed-step-scheduler', path: 'src/3d/runtime/deterministicRuntimeScheduler.ts', escapeHatches: 0, deterministic: true },
  { id: 'feature-flags', path: 'src/3d/runtime/runtimeFeatureFlagRegistry.ts', escapeHatches: 0, deterministic: true },
  { id: 'health-monitor', path: 'src/3d/runtime/runtimeHealthMonitor.ts', escapeHatches: 0, deterministic: true },
  { id: 'diagnostics', path: 'src/3d/runtime/modernRuntimeDiagnostics.ts', escapeHatches: 0, deterministic: true },
  { id: 'platform-probe', path: 'src/3d/runtime/platformCapabilityProbe.ts', escapeHatches: 0, deterministic: false },
] as const);
export interface R21StrictRuntimeSnapshot { readonly version:21; readonly tracked:number; readonly strictOwners:number; readonly escapeHatches:number; readonly deterministicOwners:number; readonly coveragePercent:number; }
export function getR21StrictRuntimeSnapshot():R21StrictRuntimeSnapshot{
 const tracked=R21_STRICT_RUNTIME_MODULES.length;
 const strictOwners=R21_STRICT_RUNTIME_MODULES.filter(m=>m.escapeHatches===0).length;
 const deterministicOwners=R21_STRICT_RUNTIME_MODULES.filter(m=>m.deterministic).length;
 return Object.freeze({version:21,tracked,strictOwners,escapeHatches:tracked-strictOwners,deterministicOwners,coveragePercent:tracked===0?100:Number(((strictOwners/tracked)*100).toFixed(2))});
}
