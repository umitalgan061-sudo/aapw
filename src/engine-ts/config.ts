import type { EngineResult } from './types.js';
import { clamp, positiveOr } from './deterministic.js';

export type ConfigValue = string | number | boolean | readonly ConfigValue[] | Readonly<Record<string, ConfigValue>>;
export type ConfigPrimitive = string | number | boolean;
export interface ConfigRule<T extends ConfigValue = ConfigValue> {
  readonly path: string;
  readonly defaultValue: T;
  readonly validate?: (value: unknown) => value is T;
  readonly normalize?: (value: T) => T;
  readonly min?: number;
  readonly max?: number;
  readonly description?: string;
  readonly mutableAtRuntime?: boolean;
}
export interface ConfigChange { readonly path: string; readonly previous: ConfigValue | undefined; readonly next: ConfigValue; readonly revision: number; }

export class RuntimeConfig implements Iterable<readonly [string, ConfigValue]> {
  private readonly rules = new Map<string, ConfigRule>();
  private readonly values = new Map<string, ConfigValue>();
  private readonly history: ConfigChange[] = [];
  private readonly maxHistory: number;
  private revision = 0;
  private locked = false;

  public constructor(rules: readonly ConfigRule[] = [], maxHistory = 256) {
    this.maxHistory = Math.max(1, Math.trunc(maxHistory));
    for (const rule of rules) this.define(rule);
  }

  public define<T extends ConfigValue>(rule: ConfigRule<T>): boolean {
    if (!rule.path || this.rules.has(rule.path)) return false;
    this.rules.set(rule.path, Object.freeze({ ...rule }));
    this.values.set(rule.path, this.normalize(rule, rule.defaultValue));
    return true;
  }

  public has(path: string): boolean { return this.rules.has(path); }
  public get<T extends ConfigValue>(path: string): T | undefined { return this.values.get(path) as T | undefined; }
  public getRule(path: string): ConfigRule | undefined { return this.rules.get(path); }

  public set<T extends ConfigValue>(path: string, value: T): EngineResult<void> {
    const rule = this.rules.get(path);
    if (!rule) return this.fail('CONFIG_UNKNOWN', path);
    if (this.locked && !rule.mutableAtRuntime) return this.fail('CONFIG_LOCKED', path);
    const normalized = this.normalize(rule, value);
    if (rule.validate && !rule.validate(normalized)) return this.fail('CONFIG_INVALID', path);
    if (typeof normalized === 'number' && !Number.isFinite(normalized)) return this.fail('CONFIG_NONFINITE', path);
    const previous = this.values.get(path);
    this.values.set(path, normalized);
    this.revision += 1;
    this.history.push(Object.freeze({ path, previous, next: normalized, revision: this.revision }));
    while (this.history.length > this.maxHistory) this.history.shift();
    return { ok: true, meta: { status: 'ok', code: 'CONFIG_SET' } };
  }

  public patch(values: Readonly<Record<string, ConfigValue>>): EngineResult<void> {
    const entries = Object.entries(values);
    const backups = entries.map(([path]) => [path, this.values.get(path)] as const);
    for (const [path, value] of entries) {
      const result = this.set(path, value);
      if (!result.ok) {
        for (const [rollbackPath, previous] of backups) {
          if (previous === undefined) this.values.delete(rollbackPath);
          else this.values.set(rollbackPath, previous);
        }
        return result;
      }
    }
    return { ok: true, meta: { status: 'ok', code: 'CONFIG_PATCHED' } };
  }

  public lock(): void { this.locked = true; }
  public unlock(): void { this.locked = false; }
  public get isLocked(): boolean { return this.locked; }
  public get version(): number { return this.revision; }
  public changesSince(revision: number): readonly ConfigChange[] { return this.history.filter(change => change.revision > revision).map(change => Object.freeze({ ...change })); }
  public snapshot(): Readonly<Record<string, ConfigValue>> { const result: Record<string, ConfigValue> = {}; for (const [path, value] of this.values) result[path] = clone(value); return Object.freeze(result); }
  public entries(): IterableIterator<readonly [string, ConfigValue]> { return this.values.entries(); }
  public [Symbol.iterator](): IterableIterator<readonly [string, ConfigValue]> { return this.entries(); }

  private normalize<T extends ConfigValue>(rule: ConfigRule<T>, value: T): T {
    let next = rule.normalize ? rule.normalize(value) : value;
    if (typeof next === 'number') next = clamp(next, rule.min ?? -Number.MAX_SAFE_INTEGER, rule.max ?? Number.MAX_SAFE_INTEGER) as T;
    return next;
  }
  private fail(code: string, path: string): EngineResult<void> { return { ok: false, meta: { status: 'rejected', code, message: path } }; }
}

export const numericRule = (path: string, defaultValue: number, min = -Infinity, max = Infinity, mutableAtRuntime = true): ConfigRule<number> => ({ path, defaultValue, min, max, mutableAtRuntime, normalize: value => positiveOr(value, defaultValue, Math.max(0, min)) });
export const booleanRule = (path: string, defaultValue: boolean, mutableAtRuntime = true): ConfigRule<boolean> => ({ path, defaultValue, mutableAtRuntime, validate: (value): value is boolean => typeof value === 'boolean' });
export const stringRule = (path: string, defaultValue: string, mutableAtRuntime = true): ConfigRule<string> => ({ path, defaultValue, mutableAtRuntime, validate: (value): value is string => typeof value === 'string' });

const clone = <T extends ConfigValue>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  return structuredClone(value);
};
