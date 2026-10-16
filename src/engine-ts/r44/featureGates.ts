/**
 * Deterministic runtime feature gates.
 *
 * Rollout assignment depends only on a stable subject identifier, flag key and
 * seed. No random API or wall clock is used; emergency overrides are explicit
 * mutations carrying the caller's logical tick.
 */
import {
  R44BoundaryError,
  type R44Fingerprint,
  type R44JsonValue,
  r44FiniteInteger,
  r44NormalizeId,
  r44NormalizeLabel,
} from "./contracts.js";
import { r44Fingerprint } from "./hash.js";

export interface R44FeatureGateDefinition {
  readonly key: string;
  readonly enabledByDefault: boolean;
  readonly rolloutPercent?: number;
  readonly seed?: string;
  readonly requires?: readonly string[];
  readonly conflictsWith?: readonly string[];
  readonly description?: string;
}

export type R44GateReason =
  | "default-on"
  | "default-off"
  | "rollout-on"
  | "rollout-off"
  | "emergency-enabled"
  | "emergency-disabled"
  | "dependency-disabled"
  | "conflict-enabled"
  | "unknown-gate";

export interface R44GateEvaluation {
  readonly key: string;
  readonly subject: string;
  readonly enabled: boolean;
  readonly reason: R44GateReason;
  readonly assignmentPercent: number | null;
  readonly dependencies: readonly string[];
  readonly conflicts: readonly string[];
  readonly evaluatedAtTick: number;
}

interface R44GateOverride {
  readonly enabled: boolean | null;
  readonly tick: number;
  readonly reason: string;
}

export interface R44FeatureGateOptions {
  readonly maxFlags?: number;
  readonly maxCacheEntries?: number;
}

export class R44FeatureGateRegistry {
  readonly #maxFlags: number;
  readonly #maxCacheEntries: number;
  readonly #definitions = new Map<string, R44FeatureGateDefinition>();
  readonly #overrides = new Map<string, R44GateOverride>();
  readonly #cache = new Map<string, R44GateEvaluation>();
  #tick = 0;
  #version = 0;

  constructor(options: R44FeatureGateOptions = {}) {
    this.#maxFlags = r44FiniteInteger(options.maxFlags ?? 2048, "maxFlags", 1, 100_000);
    this.#maxCacheEntries = r44FiniteInteger(options.maxCacheEntries ?? 8192, "maxCacheEntries", 1, 1_000_000);
  }

  get size(): number { return this.#definitions.size; }
  get version(): number { return this.#version; }

  register(definitionInput: R44FeatureGateDefinition): void {
    const key = r44NormalizeId(definitionInput.key, "feature gate", 128);
    if (this.#definitions.has(key)) throw new R44BoundaryError("gate-duplicate", "Feature gate already registered: " + key);
    if (this.#definitions.size >= this.#maxFlags) throw new R44BoundaryError("gate-capacity", "Feature gate capacity exceeded");
    const rolloutPercent = definitionInput.rolloutPercent ?? (definitionInput.enabledByDefault ? 100 : 0);
    if (!Number.isFinite(rolloutPercent) || rolloutPercent < 0 || rolloutPercent > 100) {
      throw new R44BoundaryError("gate-rollout", "rolloutPercent must be between 0 and 100");
    }
    const requires = Object.freeze((definitionInput.requires ?? []).map((item) => r44NormalizeId(item, "dependency flag", 128)));
    const conflictsWith = Object.freeze((definitionInput.conflictsWith ?? []).map((item) => r44NormalizeId(item, "conflicting flag", 128)));
    if (requires.includes(key) || conflictsWith.includes(key)) {
      throw new R44BoundaryError("gate-self-reference", "Feature gate cannot depend on or conflict with itself");
    }
    const definition = Object.freeze({
      ...definitionInput,
      key,
      rolloutPercent,
      seed: r44NormalizeId(definitionInput.seed ?? "r44-default-seed", "seed", 128),
      requires,
      conflictsWith,
      description: definitionInput.description === undefined ? "" : r44NormalizeLabel(definitionInput.description, 256),
    });
    this.#definitions.set(key, definition);
    try {
      this.#assertNoDependencyCycle(key);
    } catch (error) {
      this.#definitions.delete(key);
      throw error;
    }
    this.#changed();
  }

  setEmergencyOverride(keyInput: string, enabled: boolean | null, tickInput: number, reasonInput = "operator"): void {
    const key = r44NormalizeId(keyInput, "feature gate", 128);
    if (!this.#definitions.has(key)) throw new R44BoundaryError("gate-unknown", "Cannot override unknown gate: " + key);
    const tick = r44FiniteInteger(tickInput, "tick", this.#tick);
    const reason = r44NormalizeLabel(reasonInput, 128);
    this.#tick = tick;
    this.#overrides.set(key, Object.freeze({ enabled, tick, reason }));
    this.#changed();
  }

  advance(tickInput: number): void {
    this.#tick = r44FiniteInteger(tickInput, "tick", this.#tick);
  }

  evaluate(keyInput: string, subjectInput = "anonymous", tickInput = this.#tick): R44GateEvaluation {
    const key = r44NormalizeId(keyInput, "feature gate", 128);
    const subject = r44NormalizeId(subjectInput, "subject", 160);
    const tick = r44FiniteInteger(tickInput, "tick", 0);
    const cacheKey = this.#version + "|" + key + "|" + subject;
    const cached = this.#cache.get(cacheKey);
    if (cached !== undefined) return Object.freeze({ ...cached, evaluatedAtTick: tick });
    const definition = this.#definitions.get(key);
    if (definition === undefined) {
      return Object.freeze({
        key,
        subject,
        enabled: false,
        reason: "unknown-gate",
        assignmentPercent: null,
        dependencies: Object.freeze([]),
        conflicts: Object.freeze([]),
        evaluatedAtTick: tick,
      });
    }
    const base = this.#baseAssignment(definition, subject);
    const override = this.#overrides.get(key);
    let enabled = base.enabled;
    let reason = base.reason;
    if (override?.enabled !== null && override?.enabled !== undefined) {
      enabled = override.enabled;
      reason = override.enabled ? "emergency-enabled" : "emergency-disabled";
    }
    if (enabled) {
      for (const dependency of definition.requires ?? []) {
        const result = this.evaluate(dependency, subject, tick);
        if (!result.enabled) {
          enabled = false;
          reason = "dependency-disabled";
          break;
        }
      }
    }
    if (enabled) {
      // Conflicts are resolved deterministically: lexicographically earlier keys win.
      // This also prevents mutual-conflict declarations from recursing indefinitely.
      const priorConflicts = [...this.#definitions.values()]
        .filter((candidate) => candidate.key < key && (
          (definition.conflictsWith ?? []).includes(candidate.key) ||
          (candidate.conflictsWith ?? []).includes(key)
        ))
        .sort((left, right) => left.key.localeCompare(right.key));
      for (const conflict of priorConflicts) {
        if (this.evaluate(conflict.key, subject, tick).enabled) {
          enabled = false;
          reason = "conflict-enabled";
          break;
        }
      }
    }
    const result: R44GateEvaluation = Object.freeze({
      key,
      subject,
      enabled,
      reason,
      assignmentPercent: base.assignmentPercent,
      dependencies: Object.freeze([...(definition.requires ?? [])]),
      conflicts: Object.freeze([...(definition.conflictsWith ?? [])]),
      evaluatedAtTick: tick,
    });
    if (this.#cache.size >= this.#maxCacheEntries) {
      const oldest = this.#cache.keys().next().value as string | undefined;
      if (oldest !== undefined) this.#cache.delete(oldest);
    }
    this.#cache.set(cacheKey, result);
    return result;
  }

  isEnabled(key: string, subject = "anonymous", tick = this.#tick): boolean {
    return this.evaluate(key, subject, tick).enabled;
  }

  definitions(): readonly R44FeatureGateDefinition[] {
    return Object.freeze([...this.#definitions.values()].sort((a, b) => a.key.localeCompare(b.key)));
  }

  overrides(): Readonly<Record<string, R44JsonValue>> {
    const result: Record<string, R44JsonValue> = Object.create(null) as Record<string, R44JsonValue>;
    for (const [key, value] of this.#overrides) {
      result[key] = { enabled: value.enabled, tick: value.tick, reason: value.reason };
    }
    return Object.freeze(result);
  }

  snapshot(subject = "diagnostics"): Readonly<Record<string, R44JsonValue>> {
    const gates: Record<string, R44JsonValue> = Object.create(null) as Record<string, R44JsonValue>;
    for (const definition of this.definitions()) gates[definition.key] = this.evaluate(definition.key, subject) as unknown as R44JsonValue;
    return Object.freeze({ version: this.#version, tick: this.#tick, size: this.size, gates, overrides: this.overrides() });
  }

  #baseAssignment(definition: R44FeatureGateDefinition, subject: string): {
    enabled: boolean; reason: R44GateReason; assignmentPercent: number;
  } {
    const rollout = definition.rolloutPercent ?? (definition.enabledByDefault ? 100 : 0);
    const digest = r44Fingerprint({
      key: definition.key,
      subject,
      seed: definition.seed ?? "r44-default-seed",
    } as unknown as R44JsonValue).fingerprint;
    const hex = digest.slice(-8);
    const raw = Number.parseInt(hex, 16);
    const assignmentPercent = (raw % 10_000) / 100;
    if (rollout >= 100) return { enabled: true, reason: "default-on", assignmentPercent };
    if (rollout <= 0) return { enabled: false, reason: "default-off", assignmentPercent };
    const enabled = assignmentPercent < rollout;
    return {
      enabled,
      reason: enabled ? "rollout-on" : "rollout-off",
      assignmentPercent,
    };
  }

  #assertNoDependencyCycle(start: string): void {
    const stack = new Set<string>();
    const visited = new Set<string>();
    const visit = (key: string): void => {
      if (stack.has(key)) throw new R44BoundaryError("gate-cycle", "Feature gate dependency cycle at " + key);
      if (visited.has(key)) return;
      stack.add(key);
      for (const dependency of this.#definitions.get(key)?.requires ?? []) {
        if (this.#definitions.has(dependency)) visit(dependency);
      }
      stack.delete(key);
      visited.add(key);
    };
    visit(start);
  }

  #changed(): void {
    this.#version += 1;
    this.#cache.clear();
  }
}
