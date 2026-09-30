/**
 * Machine-readable capability manifest for AAPW v3.
 *
 * The manifest is intentionally data-only. Tooling, diagnostics and boot logic can inspect the same
 * feature surface without importing individual implementation modules or relying on stringly-typed
 * assumptions scattered across the application.
 */

export interface RuntimeCapabilityV3 {
  readonly id: string;
  readonly category: 'simulation' | 'render' | 'network' | 'world' | 'security' | 'persistence' | 'platform';
  readonly version: 3;
  readonly status: 'stable' | 'experimental' | 'bridge';
  readonly deterministic: boolean;
}

export interface RuntimeManifestV3 {
  readonly runtime: 'aapw';
  readonly generation: 3;
  readonly nodeRequirement: string;
  readonly language: 'TypeScript';
  readonly capabilities: readonly RuntimeCapabilityV3[];
}

export const RUNTIME_MANIFEST_V3: RuntimeManifestV3 = Object.freeze({
  runtime: 'aapw',
  generation: 3,
  nodeRequirement: '>=24.21.0',
  language: 'TypeScript',
  capabilities: Object.freeze([
    { id: 'ecs.data-oriented', category: 'simulation', version: 3, status: 'stable', deterministic: true },
    { id: 'simulation.fixed-step', category: 'simulation', version: 3, status: 'stable', deterministic: true },
    { id: 'simulation.health-recovery', category: 'simulation', version: 3, status: 'stable', deterministic: true },
    { id: 'simulation.stamina-recovery', category: 'simulation', version: 3, status: 'stable', deterministic: true },
    { id: 'assets.integrity-cache', category: 'world', version: 3, status: 'stable', deterministic: false },
    { id: 'world.height-query', category: 'world', version: 3, status: 'stable', deterministic: true },
    { id: 'world.line-of-sight', category: 'world', version: 3, status: 'stable', deterministic: true },
    { id: 'network.replication-state', category: 'network', version: 3, status: 'stable', deterministic: true },
    { id: 'network.worker-protocol', category: 'network', version: 3, status: 'stable', deterministic: true },
    { id: 'security.command-boundary', category: 'security', version: 3, status: 'stable', deterministic: true },
    { id: 'security.rate-limit', category: 'security', version: 3, status: 'stable', deterministic: true },
    { id: 'persistence.versioned-save', category: 'persistence', version: 3, status: 'stable', deterministic: true },
    { id: 'performance.adaptive-governor', category: 'platform', version: 3, status: 'stable', deterministic: false },
    { id: 'performance.rolling-observability', category: 'platform', version: 3, status: 'stable', deterministic: false },
    { id: 'presentation.command-proxy', category: 'render', version: 3, status: 'bridge', deterministic: true },
    { id: 'input.semantic-intents', category: 'platform', version: 3, status: 'stable', deterministic: true },
    { id: 'runtime.dependency-orchestration', category: 'platform', version: 3, status: 'stable', deterministic: false },
  ]),
});

export const listCapabilitiesV3 = (category?: RuntimeCapabilityV3['category']): readonly RuntimeCapabilityV3[] =>
  Object.freeze(RUNTIME_MANIFEST_V3.capabilities.filter((capability) => category === undefined || capability.category === category));

export const hasCapabilityV3 = (id: string): boolean => RUNTIME_MANIFEST_V3.capabilities.some((capability) => capability.id === id);

export const assertRuntimeManifestV3 = (): void => {
  if (RUNTIME_MANIFEST_V3.runtime !== 'aapw' || RUNTIME_MANIFEST_V3.generation !== 3) throw new Error('Runtime manifest identity mismatch');
  const ids = new Set<string>();
  for (const capability of RUNTIME_MANIFEST_V3.capabilities) {
    if (ids.has(capability.id)) throw new Error(`Duplicate runtime capability: ${capability.id}`);
    ids.add(capability.id);
    if (capability.version !== 3) throw new Error(`Unsupported capability version: ${capability.id}`);
  }
};
