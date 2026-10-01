import type { DeviceClass, FeatureKey, R35FeatureSet } from './contracts';

export interface FeatureDefinition {
  readonly key: FeatureKey;
  readonly defaultEnabled: boolean;
  readonly requires?: readonly FeatureKey[];
  readonly devices?: readonly DeviceClass[];
  readonly rollout?: number;
  readonly reason?: string;
}

export interface FeatureContext {
  readonly device: DeviceClass;
  readonly seed: number;
  readonly explicit?: Partial<Record<FeatureKey, boolean>>;
  readonly capabilities?: Readonly<Record<string, boolean>>;
}

function hashSeed(seed: number, key: string): number {
  let hash = (seed >>> 0) ^ 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class R35FeatureRegistry {
  readonly definitions: readonly FeatureDefinition[];
  #definitions = new Map<FeatureKey, FeatureDefinition>();

  constructor(definitions: readonly FeatureDefinition[]) {
    this.definitions = Object.freeze(definitions.map((definition) => ({ ...definition })));
    for (const definition of definitions) {
      if (definition.rollout !== undefined && (definition.rollout < 0 || definition.rollout > 1)) throw new RangeError('rollout must be between 0 and 1');
      if (this.#definitions.has(definition.key)) throw new Error('duplicate feature ' + definition.key);
      this.#definitions.set(definition.key, definition);
    }
  }

  isEnabled(key: FeatureKey, context: FeatureContext, stack: Set<FeatureKey> = new Set()): boolean {
    const definition = this.#definitions.get(key);
    if (!definition) return false;
    if (stack.has(key)) throw new Error('feature dependency cycle at ' + key);
    stack.add(key);

    const explicit = context.explicit?.[key];
    if (explicit === false) return false;
    if (definition.devices && !definition.devices.includes(context.device)) return false;
    for (const dependency of definition.requires ?? []) {
      if (!this.isEnabled(dependency, context, stack)) return false;
    }
    if (explicit === true) return true;
    if (!definition.defaultEnabled) return false;
    const rollout = definition.rollout ?? 1;
    if (rollout >= 1) return true;
    const bucket = hashSeed(context.seed, key) / 0x1_0000_0000;
    return bucket < rollout;
  }

  resolve(context: FeatureContext): R35FeatureSet {
    const result: Record<string, boolean> = {};
    for (const definition of this.definitions) result[definition.key] = this.isEnabled(definition.key, context);
    return Object.freeze(result);
  }

  explain(key: FeatureKey, context: FeatureContext): readonly string[] {
    const definition = this.#definitions.get(key);
    if (!definition) return ['unknown feature'];
    const reasons: string[] = [];
    if (context.explicit?.[key] === false) reasons.push('explicitly disabled');
    if (definition.devices && !definition.devices.includes(context.device)) reasons.push('device excluded');
    for (const dependency of definition.requires ?? []) {
      if (!this.isEnabled(dependency, context)) reasons.push('dependency disabled: ' + dependency);
    }
    if (definition.defaultEnabled && (definition.rollout ?? 1) < 1) reasons.push('deterministic rollout bucket evaluated');
    if (definition.reason) reasons.push(definition.reason);
    return Object.freeze(reasons);
  }
}

export function createDefaultR35FeatureRegistry(): R35FeatureRegistry {
  return new R35FeatureRegistry([
    { key: 'deterministicSimulation', defaultEnabled: true, reason: 'fixed-step authority' },
    { key: 'prediction', defaultEnabled: true, requires: ['deterministicSimulation'] },
    { key: 'rollback', defaultEnabled: true, requires: ['prediction', 'deterministicSimulation'] },
    { key: 'streaming', defaultEnabled: true },
    { key: 'dynamicQuality', defaultEnabled: true, requires: ['diagnostics'] },
    { key: 'ai', defaultEnabled: true, requires: ['deterministicSimulation'] },
    { key: 'networkReplication', defaultEnabled: true, requires: ['diagnostics'], rollout: 0.95 },
    { key: 'offlinePersistence', defaultEnabled: true },
    { key: 'workerPool', defaultEnabled: true, devices: ['tablet', 'desktop', 'unknown'] },
    { key: 'accessibility', defaultEnabled: true },
    { key: 'diagnostics', defaultEnabled: true },
  ]);
}
