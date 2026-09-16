export type RuntimeMode = 'development' | 'production' | 'benchmark' | 'replay' | 'safe';
export type FeatureState = 'enabled' | 'disabled' | 'degraded';

export interface RuntimePolicy {
  mode: RuntimeMode;
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

export interface PolicyViolation {
  code: string;
  subsystem: string;
  actual: number;
  limit: number;
  fatal: boolean;
}

export interface PolicyDecision {
  accepted: boolean;
  violations: readonly PolicyViolation[];
  actions: readonly string[];
}

export interface FeatureFlag {
  id: string;
  state: FeatureState;
  rollout: number;
  requires?: readonly string[];
}

export interface CapabilitySnapshot {
  features: readonly FeatureFlag[];
  policy: RuntimePolicy;
  checksum: number;
}

const DEFAULT_POLICY: RuntimePolicy = {
  mode: 'production',
  maxEntities: 12000,
  maxCommandsPerTick: 512,
  maxEventsPerTick: 2048,
  maxNetworkBytesPerSecond: 512 * 1024,
  maxAssetBytes: 64 * 1024 * 1024,
  maxWorkerRequests: 256,
  strictDeterminism: true,
  allowDynamicCode: false,
  allowRemoteAssets: true,
  enableDiagnostics: true,
};

function clampRollout(value: number): number { return Math.min(1, Math.max(0, value)); }
function finiteNonNegative(value: number): boolean { return Number.isFinite(value) && value >= 0; }

export class RuntimePolicyV2 {
  readonly #policy: RuntimePolicy;
  readonly #features = new Map<string, FeatureFlag>();
  readonly #dependencies = new Map<string, Set<string>>();

  constructor(policy: Partial<RuntimePolicy> = {}) {
    this.#policy = { ...DEFAULT_POLICY, ...policy };
    this.#validatePolicy();
  }

  get policy(): RuntimePolicy { return { ...this.#policy }; }

  setMode(mode: RuntimeMode): void {
    this.#policy.mode = mode;
    if (mode === 'safe' || mode === 'replay') this.#policy.allowDynamicCode = false;
    if (mode === 'replay') this.#policy.strictDeterminism = true;
  }

  registerFeature(feature: FeatureFlag): void {
    if (!feature.id.trim() || feature.id.length > 128) throw new RangeError('Invalid feature id');
    if (this.#features.has(feature.id)) throw new Error(`Feature ${feature.id} already registered`);
    this.#features.set(feature.id, { ...feature, rollout: clampRollout(feature.rollout), requires: feature.requires ? [...feature.requires] : feature.requires });
    this.#dependencies.set(feature.id, new Set(feature.requires ?? []));
  }

  updateFeature(id: string, state: FeatureState, rollout = this.#features.get(id)?.rollout ?? 1): boolean {
    const feature = this.#features.get(id);
    if (!feature) return false;
    feature.state = state;
    feature.rollout = clampRollout(rollout);
    return true;
  }

  featureEnabled(id: string, cohortValue = 0): boolean {
    const feature = this.#features.get(id);
    if (!feature || feature.state !== 'enabled') return false;
    if (cohortValue < 0 || cohortValue > 1) return false;
    if (cohortValue > feature.rollout) return false;
    for (const dependency of this.#dependencies.get(id) ?? []) if (!this.featureEnabled(dependency, cohortValue)) return false;
    return true;
  }

  features(): FeatureFlag[] {
    return [...this.#features.values()].sort((a, b) => a.id.localeCompare(b.id)).map((feature) => ({ ...feature, requires: feature.requires ? [...feature.requires] : feature.requires }));
  }

  evaluate(input: { entities: number; commands: number; events: number; networkBytesPerSecond: number; largestAssetBytes: number; workerRequests: number; dynamicCodeRequested?: boolean; remoteAssetRequested?: boolean }): PolicyDecision {
    const violations: PolicyViolation[] = [];
    const actions: string[] = [];
    this.#check(violations, 'entities', input.entities, this.#policy.maxEntities, false);
    this.#check(violations, 'commands', input.commands, this.#policy.maxCommandsPerTick, true);
    this.#check(violations, 'events', input.events, this.#policy.maxEventsPerTick, true);
    this.#check(violations, 'network', input.networkBytesPerSecond, this.#policy.maxNetworkBytesPerSecond, false);
    this.#check(violations, 'asset', input.largestAssetBytes, this.#policy.maxAssetBytes, true);
    this.#check(violations, 'worker', input.workerRequests, this.#policy.maxWorkerRequests, true);
    if (input.dynamicCodeRequested && !this.#policy.allowDynamicCode) violations.push({ code: 'dynamic_code_denied', subsystem: 'security', actual: 1, limit: 0, fatal: true });
    if (input.remoteAssetRequested && !this.#policy.allowRemoteAssets) violations.push({ code: 'remote_asset_denied', subsystem: 'security', actual: 1, limit: 0, fatal: true });
    if (violations.some((violation) => violation.fatal)) actions.push('enter_safe_mode');
    if (violations.some((violation) => violation.subsystem === 'network')) actions.push('reduce_replication');
    if (violations.some((violation) => violation.subsystem === 'worker')) actions.push('shed_background_work');
    if (violations.some((violation) => violation.subsystem === 'entities')) actions.push('reduce_population_lod');
    return { accepted: violations.every((violation) => !violation.fatal), violations, actions };
  }

  snapshot(): CapabilitySnapshot {
    const body = { features: this.features(), policy: this.policy };
    const checksum = stableHash(body);
    return { ...body, checksum };
  }

  restore(snapshot: CapabilitySnapshot): void {
    if (stableHash({ features: snapshot.features, policy: snapshot.policy }) !== snapshot.checksum) throw new Error('Runtime policy snapshot checksum mismatch');
    this.#policy.mode = snapshot.policy.mode;
    this.#policy.maxEntities = snapshot.policy.maxEntities;
    this.#policy.maxCommandsPerTick = snapshot.policy.maxCommandsPerTick;
    this.#policy.maxEventsPerTick = snapshot.policy.maxEventsPerTick;
    this.#policy.maxNetworkBytesPerSecond = snapshot.policy.maxNetworkBytesPerSecond;
    this.#policy.maxAssetBytes = snapshot.policy.maxAssetBytes;
    this.#policy.maxWorkerRequests = snapshot.policy.maxWorkerRequests;
    this.#policy.strictDeterminism = snapshot.policy.strictDeterminism;
    this.#policy.allowDynamicCode = snapshot.policy.allowDynamicCode;
    this.#policy.allowRemoteAssets = snapshot.policy.allowRemoteAssets;
    this.#policy.enableDiagnostics = snapshot.policy.enableDiagnostics;
    this.#features.clear();
    this.#dependencies.clear();
    for (const feature of snapshot.features) this.registerFeature(feature);
    this.#validatePolicy();
  }

  private #check(violations: PolicyViolation[], subsystem: string, actual: number, limit: number, fatal: boolean): void {
    if (!Number.isFinite(actual) || actual < 0) {
      violations.push({ code: `${subsystem}_invalid`, subsystem, actual, limit, fatal: true });
      return;
    }
    if (actual > limit) violations.push({ code: `${subsystem}_limit`, subsystem, actual, limit, fatal });
  }

  #validatePolicy(): void {
    const numeric = [this.#policy.maxEntities, this.#policy.maxCommandsPerTick, this.#policy.maxEventsPerTick, this.#policy.maxNetworkBytesPerSecond, this.#policy.maxAssetBytes, this.#policy.maxWorkerRequests];
    if (numeric.some((value) => !Number.isInteger(value) ? !finiteNonNegative(value) : value <= 0)) throw new RangeError('Runtime limits must be positive');
  }
}

function stableHash(value: unknown): number {
  const text = JSON.stringify(sortValue(value));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sortValue(entry)]));
  return value;
}
