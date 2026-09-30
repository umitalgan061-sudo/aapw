import { RuntimeHealth, stableChecksum } from './types.ts';

export interface RuntimeCapability {
  id: string;
  version: number;
  enabled: boolean;
  deterministic: boolean;
  browserSafe: boolean;
  budgetMs: number;
}

export interface RuntimeManifest {
  name: 'aapw-nextgen-runtime';
  version: 1;
  capabilities: readonly RuntimeCapability[];
  checksum: number;
}

const CAPABILITIES: readonly RuntimeCapability[] = [
  { id: 'ecs', version: 1, enabled: true, deterministic: true, browserSafe: true, budgetMs: 0.5 },
  { id: 'fixed-step', version: 1, enabled: true, deterministic: true, browserSafe: true, budgetMs: 0.25 },
  { id: 'scheduler', version: 1, enabled: true, deterministic: true, browserSafe: true, budgetMs: 1 },
  { id: 'command-bus', version: 1, enabled: true, deterministic: true, browserSafe: true, budgetMs: 0.5 },
  { id: 'input-prediction', version: 1, enabled: true, deterministic: true, browserSafe: true, budgetMs: 0.25 },
  { id: 'snapshot-replication', version: 2, enabled: true, deterministic: true, browserSafe: true, budgetMs: 1.5 },
  { id: 'terrain-query', version: 1, enabled: true, deterministic: true, browserSafe: true, budgetMs: 0.75 },
  { id: 'resource-cache', version: 1, enabled: true, deterministic: false, browserSafe: true, budgetMs: 1 },
  { id: 'worker-protocol', version: 1, enabled: true, deterministic: true, browserSafe: true, budgetMs: 0.5 },
  { id: 'save-codec', version: 1, enabled: true, deterministic: true, browserSafe: true, budgetMs: 1 },
  { id: 'quality-adaptation', version: 1, enabled: true, deterministic: false, browserSafe: true, budgetMs: 0.25 },
  { id: 'replay-verification', version: 1, enabled: true, deterministic: true, browserSafe: true, budgetMs: 2 },
  { id: 'runtime-validation', version: 1, enabled: true, deterministic: true, browserSafe: true, budgetMs: 0.5 },
  { id: 'runtime-invariants', version: 1, enabled: true, deterministic: true, browserSafe: true, budgetMs: 0.25 },
  { id: 'clock-diagnostics', version: 1, enabled: true, deterministic: true, browserSafe: true, budgetMs: 0.1 },
];

export function createRuntimeManifest(): RuntimeManifest {
  const body = { name: 'aapw-nextgen-runtime' as const, version: 1 as const, capabilities: CAPABILITIES };
  return { ...body, checksum: stableChecksum(body) };
}

export function validateRuntimeManifest(manifest: RuntimeManifest): boolean {
  if (manifest.name !== 'aapw-nextgen-runtime' || manifest.version !== 1) return false;
  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) return false;
  const ids = new Set<string>();
  for (const capability of manifest.capabilities) {
    if (ids.has(capability.id) || !capability.id.trim()) return false;
    if (!Number.isInteger(capability.version) || capability.version < 1) return false;
    if (!Number.isFinite(capability.budgetMs) || capability.budgetMs < 0) return false;
    ids.add(capability.id);
  }
  const body = { name: manifest.name, version: manifest.version, capabilities: manifest.capabilities };
  return stableChecksum(body) === manifest.checksum;
}

export function manifestHealth(health: RuntimeHealth, manifest = createRuntimeManifest()): { ready: boolean; failedCapabilities: string[] } {
  const failedCapabilities = manifest.capabilities
    .filter((capability) => !capability.enabled || capability.budgetMs <= 0)
    .map((capability) => capability.id);
  return { ready: health.status !== 'critical' && validateRuntimeManifest(manifest), failedCapabilities };
}

export function enabledCapabilities(manifest = createRuntimeManifest()): RuntimeCapability[] {
  return manifest.capabilities.filter((capability) => capability.enabled).map((capability) => ({ ...capability }));
}
