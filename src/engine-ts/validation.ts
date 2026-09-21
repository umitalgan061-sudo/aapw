import type { Aabb3, CapabilitySnapshot, ComponentSchema, EngineResult, FrameCommand, RuntimeHealth, SpatialEntry, Transform, Vec3 } from './types.js';
import { clamp } from './deterministic.js';

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
  readonly value?: unknown;
}
export interface ValidationReport {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly checked: number;
  readonly revision: number;
}

export class Validator {
  private readonly issues: ValidationIssue[] = [];
  private checked = 0;
  private revision = 0;

  public check(condition: boolean, path: string, code: string, message: string, value?: unknown): boolean {
    this.checked += 1;
    if (condition) return true;
    this.issues.push(Object.freeze({ path, code, message, ...(value === undefined ? {} : { value }) }));
    return false;
  }

  public finite(value: number, path: string): boolean { return this.check(Number.isFinite(value), path, 'NON_FINITE', 'Expected a finite number', value); }
  public integer(value: number, path: string): boolean { return this.check(Number.isInteger(value), path, 'NOT_INTEGER', 'Expected an integer', value); }
  public range(value: number, min: number, max: number, path: string): boolean { return this.check(Number.isFinite(value) && value >= min && value <= max, path, 'OUT_OF_RANGE', `Expected ${min}..${max}`, value); }
  public nonEmpty(value: string, path: string): boolean { return this.check(typeof value === 'string' && value.trim().length > 0, path, 'EMPTY_STRING', 'Expected a non-empty string', value); }
  public boolean(value: unknown, path: string): value is boolean { return this.check(typeof value === 'boolean', path, 'NOT_BOOLEAN', 'Expected a boolean', value); }
  public object(value: unknown, path: string): value is object { return this.check(value !== null && typeof value === 'object', path, 'NOT_OBJECT', 'Expected an object', value); }
  public report(): ValidationReport { this.revision += 1; return Object.freeze({ ok: this.issues.length === 0, issues: Object.freeze([...this.issues]), checked: this.checked, revision: this.revision }); }
}

export const validateVec3 = (value: unknown, path = 'vec3'): ValidationReport => {
  const validator = new Validator();
  if (!validator.object(value, path)) return validator.report();
  const candidate = value as Partial<Vec3>;
  validator.finite(Number(candidate.x), `${path}.x`);
  validator.finite(Number(candidate.y), `${path}.y`);
  validator.finite(Number(candidate.z), `${path}.z`);
  return validator.report();
};

export const validateAabb3 = (value: unknown, path = 'aabb'): ValidationReport => {
  const validator = new Validator();
  if (!validator.object(value, path)) return validator.report();
  const aabb = value as Partial<Aabb3>;
  const min = validateVec3(aabb.min, `${path}.min`);
  const max = validateVec3(aabb.max, `${path}.max`);
  for (const issue of [...min.issues, ...max.issues]) validator.check(false, issue.path, issue.code, issue.message, issue.value);
  if (min.ok && max.ok) {
    const lower = aabb.min!;
    const upper = aabb.max!;
    validator.check(lower.x <= upper.x, `${path}.x`, 'INVALID_EXTENT', 'Minimum must not exceed maximum');
    validator.check(lower.y <= upper.y, `${path}.y`, 'INVALID_EXTENT', 'Minimum must not exceed maximum');
    validator.check(lower.z <= upper.z, `${path}.z`, 'INVALID_EXTENT', 'Minimum must not exceed maximum');
  }
  return validator.report();
};

export const validateTransform = (value: unknown, path = 'transform'): ValidationReport => {
  const validator = new Validator();
  if (!validator.object(value, path)) return validator.report();
  const candidate = value as Partial<Transform>;
  const position = validateVec3(candidate.position, `${path}.position`);
  for (const issue of position.issues) validator.check(false, issue.path, issue.code, issue.message, issue.value);
  const scale = candidate.scale;
  if (position.ok) validator.finite(Number(scale?.x), `${path}.scale.x`);
  if (position.ok) validator.finite(Number(scale?.y), `${path}.scale.y`);
  if (position.ok) validator.finite(Number(scale?.z), `${path}.scale.z`);
  return validator.report();
};

export const validateSpatialEntry = (entry: unknown, path = 'spatial'): ValidationReport => {
  const validator = new Validator();
  if (!validator.object(entry, path)) return validator.report();
  const candidate = entry as Partial<SpatialEntry>;
  validator.nonEmpty(String(candidate.entity ?? ''), `${path}.entity`);
  const bounds = validateAabb3(candidate.bounds, `${path}.bounds`);
  for (const issue of bounds.issues) validator.check(false, issue.path, issue.code, issue.message, issue.value);
  validator.finite(Number(candidate.layer), `${path}.layer`);
  return validator.report();
};

export const validateCapabilitySnapshot = (snapshot: unknown): ValidationReport => {
  const validator = new Validator();
  if (!validator.object(snapshot, 'capabilities')) return validator.report();
  const value = snapshot as Partial<CapabilitySnapshot>;
  for (const key of ['webgl2', 'webgpu', 'offscreenCanvas', 'sharedArrayBuffer', 'crossOriginIsolated', 'gamepad', 'touch', 'worker'] as const) validator.boolean(value[key], `capabilities.${key}`);
  validator.finite(Number(value.deviceMemoryGb), 'capabilities.deviceMemoryGb');
  validator.range(Number(value.deviceMemoryGb), 0, 128, 'capabilities.deviceMemoryGb');
  validator.integer(Number(value.hardwareConcurrency), 'capabilities.hardwareConcurrency');
  validator.range(Number(value.hardwareConcurrency), 1, 256, 'capabilities.hardwareConcurrency');
  return validator.report();
};

export const validateHealth = (health: unknown): ValidationReport => {
  const validator = new Validator();
  if (!validator.object(health, 'health')) return validator.report();
  const value = health as Partial<RuntimeHealth>;
  validator.check(['booting', 'ready', 'degraded', 'recovering', 'failed', 'disposed'].includes(String(value.phase)), 'health.phase', 'PHASE', 'Unknown runtime phase');
  validator.range(Number(value.score), 0, 1, 'health.score');
  validator.integer(Number(value.faults), 'health.faults');
  validator.range(Number(value.faults), 0, 1_000_000, 'health.faults');
  validator.integer(Number(value.recoveries), 'health.recoveries');
  validator.range(Number(value.recoveries), 0, 1_000_000, 'health.recoveries');
  return validator.report();
};

export const validateCommand = (command: unknown): ValidationReport => {
  const validator = new Validator();
  if (!validator.object(command, 'command')) return validator.report();
  const value = command as Partial<FrameCommand>;
  validator.nonEmpty(String(value.kind ?? ''), 'command.kind');
  validator.integer(Number(value.version), 'command.version');
  validator.integer(Number(value.revision), 'command.revision');
  validator.integer(Number(value.id), 'command.id');
  validator.range(Number(value.priority), -1000, 1000, 'command.priority');
  validator.nonEmpty(String(value.entity ?? ''), 'command.entity');
  validator.integer(Number(value.issuedAtTick), 'command.issuedAtTick');
  validator.check(value.type === 'frame', 'command.type', 'COMMAND_TYPE', 'Expected frame command');
  return validator.report();
};

export const validateComponentSchema = <T extends object>(schema: ComponentSchema<T>): ValidationReport => {
  const validator = new Validator();
  validator.nonEmpty(String(schema.type), 'schema.type');
  validator.integer(Number(schema.version), 'schema.version');
  validator.range(Number(schema.version), 1, 1_000_000, 'schema.version');
  validator.check(typeof schema.defaults === 'function', 'schema.defaults', 'DEFAULTS', 'Expected defaults function');
  validator.check(typeof schema.validate === 'function', 'schema.validate', 'VALIDATE', 'Expected validation function');
  let defaults: T;
  try { defaults = schema.defaults(); validator.check(schema.validate(defaults), 'schema.defaults()', 'DEFAULT_INVALID', 'Default value failed schema validation'); }
  catch (error) { validator.check(false, 'schema.defaults()', 'DEFAULT_THROW', error instanceof Error ? error.message : 'Defaults threw'); }
  void defaults;
  return validator.report();
};

export const resultOr = <T>(report: ValidationReport, value: T): EngineResult<T> => report.ok
  ? { ok: true, value, meta: { status: 'ok', code: 'VALIDATED' } }
  : { ok: false, meta: { status: 'invalid', code: report.issues[0]?.code ?? 'INVALID', message: report.issues.map(issue => `${issue.path}: ${issue.message}`).join('; ') } };

export const sanitizeNormalized = (value: number, fallback = 0): number => Number.isFinite(value) ? clamp(value, -1, 1) : fallback;
export const sanitizePositive = (value: number, fallback = 1, max = Number.MAX_SAFE_INTEGER): number => Number.isFinite(value) && value > 0 ? Math.min(value, max) : fallback;
export const sanitizeInteger = (value: number, fallback = 0, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): number => Number.isFinite(value) ? Math.trunc(clamp(value, min, max)) : fallback;

export const deepFreeze = <T>(value: T, maxDepth = 8): T => {
  const visit = (current: unknown, depth: number): void => {
    if (current === null || typeof current !== 'object' || depth > maxDepth || Object.isFrozen(current)) return;
    if (Array.isArray(current)) for (const item of current) visit(item, depth + 1);
    else for (const item of Object.values(current as Record<string, unknown>)) visit(item, depth + 1);
    Object.freeze(current);
  };
  visit(value, 0);
  return value;
};

export const assertNever = (value: never, context = 'unexpected-value'): never => { throw new Error(`${context}:${String(value)}`); };
