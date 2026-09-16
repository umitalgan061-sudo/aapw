import { hashString, stableStringify } from './types.ts';

export type PolicyMode = 'strict' | 'balanced' | 'permissive';
export type FeatureState = 'enabled' | 'disabled' | 'shadow';

export interface RuntimePolicy {
  mode: PolicyMode;
  maxEntities: number;
  maxCommandsPerTick: number;
  maxEventsPerTick: number;
  maxNetworkBytesPerSecond: number;
  maxAssetBytes: number;
  maxWorkerRequests: number;
  strictDeterminism: boolean;
  allowDynamicCode: boolean;
  allowRemoteAssets: boolean;
  enableDiagnostics: boolean;
}

export interface FeatureFlag {
  id: string;
  state: FeatureState;
  rollout: number;
  requires?: readonly string[];
}

export interface PolicyViolation {
  code: string;
  subsystem: string;
  actual: number;
  limit: number;
  fatal: boolean;
}

export interface CapabilitySnapshot {
  features: readonly FeatureFlag[];
  policy: RuntimePolicy;
  checksum: number;
}

const DEFAULT_POLICY: RuntimePolicy = {
  mode: 'strict',
  maxEntities: 100_000,
  maxCommandsPerTick: 512,
  maxEventsPerTick: 1024,
  maxNetworkBytesPerSecond: 8 * 1024 * 1024,
  maxAssetBytes: 256 * 1024 * 1024,
  maxWorkerRequests: 256,
  strictDeterminism: true,
  allowDynamicCode: false,
  allowRemoteAssets: false,
  enableDiagnostics: true,
};

export class RuntimePolicyV2 {
  #policy: RuntimePolicy;
  readonly #features = new Map<string, FeatureFlag>();
  readonly #dependencies = new Map<string, Set<string>>();

  constructor(policy: Partial<RuntimePolicy> = {}) {
    this.#policy = { ...DEFAULT_POLICY, ...policy };
    this.#validatePolicy();
  }

  policy(): RuntimePolicy { return { ...this.#policy }; }

  registerFeature(feature: FeatureFlag): void {
    if (!feature.id.trim()) throw new Error('Feature id must not be empty');
    if (!Number.isFinite(feature.rollout) || feature.rollout < 0 || feature.rollout > 1) throw new RangeError('Feature rollout must be between 0 and 1');
    const normalized = Object.freeze({ ...feature, requires: feature.requires ? [...feature.requires] : undefined });
    this.#features.set(feature.id, normalized);
    this.#dependencies.set(feature.id, new Set(feature.requires ?? []));
  }

  setFeature(id: string, state: FeatureState): void {
    const feature = this.#features.get(id);
    if (!feature) throw new Error(`Unknown feature: ${id}`);
    this.#features.set(id, Object.freeze({ ...feature, state }));
  }

  isEnabled(id: string, rolloutKey = id): boolean {
    const feature = this.#features.get(id);
    if (!feature || feature.state === 'disabled') return false;
    if (feature.state === 'shadow') return false;
    for (const dependency of this.#dependencies.get(id) ?? []) if (!this.isEnabled(dependency, rolloutKey)) return false;
    const hash = hashString(`${id}:${rolloutKey}`) / 0x1_0000_0000;
    return hash <= feature.rollout;
  }

  evaluate(input: { entities?: number; commands?: number; events?: number; networkBytes?: number; assetBytes?: number; workerRequests?: number }): readonly PolicyViolation[] {
    const violations: PolicyViolation[] = [];
    if (input.entities !== undefined) this.#check(violations, 'entities', input.entities, this.#policy.maxEntities, true);
    if (input.commands !== undefined) this.#check(violations, 'commands', input.commands, this.#policy.maxCommandsPerTick, true);
    if (input.events !== undefined) this.#check(violations, 'events', input.events, this.#policy.maxEventsPerTick, true);
    if (input.networkBytes !== undefined) this.#check(violations, 'network_bytes', input.networkBytes, this.#policy.maxNetworkBytesPerSecond, false);
    if (input.assetBytes !== undefined) this.#check(violations, 'asset_bytes', input.assetBytes, this.#policy.maxAssetBytes, true);
    if (input.workerRequests !== undefined) this.#check(violations, 'worker_requests', input.workerRequests, this.#policy.maxWorkerRequests, true);
    return Object.freeze(violations);
  }

  snapshot(): CapabilitySnapshot {
    const features = Object.freeze([...this.#features.values()].sort((a, b) => a.id.localeCompare(b.id)));
    const policy = this.policy();
    return Object.freeze({ features, policy, checksum: stableHash({ features, policy }) });
  }

  restore(snapshot: CapabilitySnapshot): void {
    if (stableHash({ features: snapshot.features, policy: snapshot.policy }) !== snapshot.checksum) throw new Error('Runtime policy snapshot checksum mismatch');
    this.#policy = { ...snapshot.policy };
    this.#features.clear();
    this.#dependencies.clear();
    for (const feature of snapshot.features) this.registerFeature(feature);
    this.#validatePolicy();
  }

  #check(violations: PolicyViolation[], subsystem: string, actual: number, limit: number, fatal: boolean): void {
    if (!Number.isFinite(actual) || actual < 0) {
      violations.push({ code: `${subsystem}_invalid`, subsystem, actual, limit, fatal: true });
      return;
    }
    if (actual > limit) violations.push({ code: `${subsystem}_limit`, subsystem, actual, limit, fatal });
  }

  #validatePolicy(): void {
    const numeric = [
      this.#policy.maxEntities,
      this.#policy.maxCommandsPerTick,
      this.#policy.maxEventsPerTick,
      this.#policy.maxNetworkBytesPerSecond,
      this.#policy.maxAssetBytes,
      this.#policy.maxWorkerRequests,
    ];
    if (numeric.some((value) => !Number.isFinite(value) || value <= 0)) throw new RangeError('Runtime limits must be positive');
  }
}

function stableHash(value: unknown): number {
  return hashString(stableStringify(value));
}
