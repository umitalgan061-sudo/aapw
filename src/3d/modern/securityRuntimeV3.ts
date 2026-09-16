/**
 * Runtime security and trust boundary primitives for AAPW v3.
 *
 * Client input, save payloads, worker messages, asset URLs and network commands are not trusted by
 * default. The helpers in this file provide shared limits, token-bucket rate limiting and strict
 * command registration. They deliberately return data-only decisions so policy remains testable.
 */

export type TrustDecision = 'allow' | 'deny';
export type InputOrigin = 'local' | 'remote' | 'replay' | 'save' | 'worker';

export interface SecurityLimitsV3 {
  readonly maxCommandName: number;
  readonly maxCommandArgs: number;
  readonly maxStringValue: number;
  readonly maxObjectKeys: number;
  readonly maxBatchSize: number;
  readonly maxInputRate: number;
  readonly burst: number;
}

export const DEFAULT_SECURITY_LIMITS_V3: SecurityLimitsV3 = {
  maxCommandName: 64,
  maxCommandArgs: 24,
  maxStringValue: 512,
  maxObjectKeys: 64,
  maxBatchSize: 128,
  maxInputRate: 30,
  burst: 60,
};

export interface SecurityViolationV3 {
  readonly code: string;
  readonly message: string;
  readonly origin: InputOrigin;
}

export interface CommandSpecV3 {
  readonly name: string;
  readonly minArgs: number;
  readonly maxArgs: number;
  readonly allowedOrigins: readonly InputOrigin[];
}

export interface CommandRequestV3 {
  readonly origin: InputOrigin;
  readonly name: string;
  readonly args: readonly unknown[];
  readonly sequence: number;
}

export interface CommandDecisionV3 {
  readonly decision: TrustDecision;
  readonly violations: readonly SecurityViolationV3[];
}

const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const safeName = (value: string, limit: number): boolean => /^[a-zA-Z0-9._:-]+$/.test(value) && value.length <= limit;

export function inspectValueV3(value: unknown, limits: SecurityLimitsV3, origin: InputOrigin, depth = 0): readonly SecurityViolationV3[] {
  const violations: SecurityViolationV3[] = [];
  if (depth > 6) {
    violations.push({ code: 'DEPTH', message: 'Value nesting exceeds limit', origin });
    return violations;
  }
  if (typeof value === 'string') {
    if (value.length > limits.maxStringValue) violations.push({ code: 'STRING_SIZE', message: 'String exceeds limit', origin });
    return violations;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) violations.push({ code: 'NUMBER', message: 'Non-finite number rejected', origin });
    return violations;
  }
  if (typeof value === 'boolean' || value === null || value === undefined) return violations;
  if (Array.isArray(value)) {
    if (value.length > limits.maxBatchSize) violations.push({ code: 'ARRAY_SIZE', message: 'Array exceeds limit', origin });
    for (const item of value) violations.push(...inspectValueV3(item, limits, origin, depth + 1));
    return violations;
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object);
    if (keys.length > limits.maxObjectKeys) violations.push({ code: 'OBJECT_KEYS', message: 'Object key count exceeds limit', origin });
    for (const key of keys) {
      if (forbiddenKeys.has(key)) violations.push({ code: 'PROTO_KEY', message: `Forbidden key: ${key}`, origin });
      violations.push(...inspectValueV3(object[key], limits, origin, depth + 1));
    }
  }
  return violations;
}

export class TokenBucketV3 {
  readonly capacity: number;
  readonly refillPerSecond: number;
  #tokens: number;
  #lastTime: number;

  constructor(capacity: number, refillPerSecond: number, initialTimeSeconds = 0) {
    if (!Number.isFinite(capacity) || capacity <= 0) throw new RangeError('capacity must be positive');
    if (!Number.isFinite(refillPerSecond) || refillPerSecond <= 0) throw new RangeError('refillPerSecond must be positive');
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.#tokens = capacity;
    this.#lastTime = initialTimeSeconds;
  }

  consume(cost = 1, timeSeconds = this.#lastTime): boolean {
    if (!Number.isFinite(cost) || cost <= 0) return false;
    if (!Number.isFinite(timeSeconds) || timeSeconds < this.#lastTime) return false;
    const elapsed = timeSeconds - this.#lastTime;
    this.#tokens = Math.min(this.capacity, this.#tokens + elapsed * this.refillPerSecond);
    this.#lastTime = timeSeconds;
    if (this.#tokens < cost) return false;
    this.#tokens -= cost;
    return true;
  }

  remaining(timeSeconds = this.#lastTime): number {
    if (timeSeconds < this.#lastTime) return this.#tokens;
    return Math.min(this.capacity, this.#tokens + (timeSeconds - this.#lastTime) * this.refillPerSecond);
  }
}

export class CommandRegistryV3 {
  #limits: SecurityLimitsV3;
  #commands = new Map<string, CommandSpecV3>();
  #buckets = new Map<InputOrigin, TokenBucketV3>();

  constructor(limits: Partial<SecurityLimitsV3> = {}) {
    this.#limits = { ...DEFAULT_SECURITY_LIMITS_V3, ...limits };
    for (const origin of ['local', 'remote', 'replay', 'save', 'worker'] as const) {
      this.#buckets.set(origin, new TokenBucketV3(this.#limits.burst, this.#limits.maxInputRate));
    }
  }

  register(spec: CommandSpecV3): void {
    if (!safeName(spec.name, this.#limits.maxCommandName)) throw new Error(`Unsafe command name: ${spec.name}`);
    if (!Number.isInteger(spec.minArgs) || !Number.isInteger(spec.maxArgs) || spec.minArgs < 0 || spec.maxArgs < spec.minArgs || spec.maxArgs > this.#limits.maxCommandArgs) throw new Error(`Invalid argument limits: ${spec.name}`);
    if (this.#commands.has(spec.name)) throw new Error(`Duplicate command: ${spec.name}`);
    this.#commands.set(spec.name, Object.freeze({ ...spec, allowedOrigins: [...new Set(spec.allowedOrigins)] }));
  }

  inspect(request: CommandRequestV3, timeSeconds = 0): CommandDecisionV3 {
    const violations: SecurityViolationV3[] = [];
    const spec = this.#commands.get(request.name);
    if (!spec) violations.push({ code: 'UNKNOWN_COMMAND', message: `Unknown command: ${request.name}`, origin: request.origin });
    if (!safeName(request.name, this.#limits.maxCommandName)) violations.push({ code: 'COMMAND_NAME', message: 'Invalid command name', origin: request.origin });
    if (!Number.isInteger(request.sequence) || request.sequence < 0) violations.push({ code: 'SEQUENCE', message: 'Invalid command sequence', origin: request.origin });
    if (request.args.length > this.#limits.maxCommandArgs) violations.push({ code: 'ARG_COUNT', message: 'Too many command arguments', origin: request.origin });
    if (spec) {
      if (request.args.length < spec.minArgs || request.args.length > spec.maxArgs) violations.push({ code: 'ARG_RANGE', message: 'Argument count outside command contract', origin: request.origin });
      if (!spec.allowedOrigins.includes(request.origin)) violations.push({ code: 'ORIGIN', message: 'Origin not allowed for command', origin: request.origin });
    }
    violations.push(...inspectValueV3(request.args, this.#limits, request.origin));
    const bucket = this.#buckets.get(request.origin);
    if (!bucket?.consume(1, timeSeconds)) violations.push({ code: 'RATE', message: 'Command rate limit exceeded', origin: request.origin });
    return Object.freeze({ decision: violations.length === 0 ? 'allow' : 'deny', violations: Object.freeze(violations) });
  }

  has(name: string): boolean { return this.#commands.has(name); }
  describe(): readonly CommandSpecV3[] { return Object.freeze([...this.#commands.values()].sort((a, b) => a.name.localeCompare(b.name))); }
}

export const createDefaultCommandRegistryV3 = (): CommandRegistryV3 => {
  const registry = new CommandRegistryV3();
  const allOrigins: readonly InputOrigin[] = ['local', 'remote', 'replay', 'worker'];
  registry.register({ name: 'player.move', minArgs: 2, maxArgs: 3, allowedOrigins: allOrigins });
  registry.register({ name: 'player.look', minArgs: 2, maxArgs: 2, allowedOrigins: allOrigins });
  registry.register({ name: 'player.jump', minArgs: 0, maxArgs: 0, allowedOrigins: allOrigins });
  registry.register({ name: 'player.dodge', minArgs: 0, maxArgs: 0, allowedOrigins: allOrigins });
  registry.register({ name: 'combat.attack', minArgs: 1, maxArgs: 3, allowedOrigins: allOrigins });
  registry.register({ name: 'combat.block', minArgs: 1, maxArgs: 1, allowedOrigins: allOrigins });
  registry.register({ name: 'quest.accept', minArgs: 1, maxArgs: 1, allowedOrigins: ['local', 'replay', 'worker'] });
  registry.register({ name: 'quest.abandon', minArgs: 1, maxArgs: 1, allowedOrigins: ['local', 'replay', 'worker'] });
  registry.register({ name: 'world.teleport', minArgs: 3, maxArgs: 3, allowedOrigins: ['local', 'replay'] });
  registry.register({ name: 'debug.pause', minArgs: 0, maxArgs: 0, allowedOrigins: ['local'] });
  return registry;
};
