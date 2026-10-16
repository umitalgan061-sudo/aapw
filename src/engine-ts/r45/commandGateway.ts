import {
  RuntimeFault,
  commandName,
  isRecord,
  stableFingerprint,
  stableSerialize,
  type CommandName,
} from "./contracts";

export interface CommandPrincipal {
  readonly principalId: string;
  readonly sessionId: string;
  readonly scopes: ReadonlySet<string>;
}

export interface CommandMetadata {
  readonly tick: number;
  readonly requestId: string;
  readonly idempotencyKey?: string;
}

export interface CommandExecutionContext {
  readonly principal: CommandPrincipal;
  readonly tick: number;
  readonly requestId: string;
  readonly command: CommandName;
}

export interface CommandDefinition<P, R> {
  readonly name: string;
  readonly version: number;
  readonly requiredScopes?: readonly string[];
  readonly maxPayloadBytes?: number;
  readonly validate: (payload: unknown) => payload is P;
  readonly execute: (payload: P, context: CommandExecutionContext) => R;
}

export type CommandStatus = "accepted" | "rejected" | "failed" | "replayed";

export interface CommandReceipt<R = unknown> {
  readonly sequence: number;
  readonly command: CommandName;
  readonly requestId: string;
  readonly principalId: string;
  readonly tick: number;
  readonly payloadFingerprint: string;
  readonly status: CommandStatus;
  readonly result?: R;
  readonly fault?: Readonly<{ code: string; message: string }>;
  readonly replayOf?: number;
}

export interface CommandGatewayOptions {
  readonly maxCommands?: number;
  readonly maxPayloadBytes?: number;
  readonly receiptCapacity?: number;
  readonly idempotencyCapacity?: number;
  readonly rateCapacity?: number;
  readonly rateRefillPerTick?: number;
  readonly maxPrincipalBuckets?: number;
}

interface RateBucket {
  tokens: number;
  lastTick: number;
}

interface IdempotencyEntry {
  readonly key: string;
  readonly fingerprint: string;
  readonly receipt: CommandReceipt;
}

export class CommandGateway {
  readonly maxCommands: number;
  readonly maxPayloadBytes: number;
  readonly receiptCapacity: number;
  readonly idempotencyCapacity: number;
  readonly rateCapacity: number;
  readonly rateRefillPerTick: number;
  readonly maxPrincipalBuckets: number;
  #definitions = new Map<CommandName, CommandDefinition<unknown, unknown>>();
  #sequence = 0;
  #receipts: CommandReceipt[] = [];
  #idempotency = new Map<string, IdempotencyEntry>();
  #buckets = new Map<string, RateBucket>();
  #rejected = 0;
  #accepted = 0;
  #replayed = 0;

  constructor(options: CommandGatewayOptions = {}) {
    this.maxCommands = options.maxCommands ?? 256;
    this.maxPayloadBytes = options.maxPayloadBytes ?? 32_768;
    this.receiptCapacity = options.receiptCapacity ?? 2048;
    this.idempotencyCapacity = options.idempotencyCapacity ?? 4096;
    this.rateCapacity = options.rateCapacity ?? 24;
    this.rateRefillPerTick = options.rateRefillPerTick ?? 2;
    this.maxPrincipalBuckets = options.maxPrincipalBuckets ?? 4096;
    for (const [name, value, min, max] of [
      ["maxCommands", this.maxCommands, 1, 100_000],
      ["maxPayloadBytes", this.maxPayloadBytes, 64, 10_000_000],
      ["receiptCapacity", this.receiptCapacity, 1, 1_000_000],
      ["idempotencyCapacity", this.idempotencyCapacity, 1, 1_000_000],
      ["rateCapacity", this.rateCapacity, 1, 1_000_000],
      ["rateRefillPerTick", this.rateRefillPerTick, 0, 1_000_000],
      ["maxPrincipalBuckets", this.maxPrincipalBuckets, 1, 1_000_000],
    ] as const) {
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new RuntimeFault("INVALID_INPUT", "Gateway option is outside the accepted range", "commandGateway.constructor", {
          details: { name, value, min, max },
        });
      }
    }
  }

  register<P, R>(definition: CommandDefinition<P, R>): CommandName {
    const name = commandName(definition.name);
    if (this.#definitions.has(name)) {
      throw new RuntimeFault("CONFLICT", "Command name is already registered", "commandGateway.register", { details: { name } });
    }
    if (this.#definitions.size >= this.maxCommands) {
      throw new RuntimeFault("CAPACITY_EXCEEDED", "Command registry is full", "commandGateway.register");
    }
    if (!Number.isInteger(definition.version) || definition.version < 1) {
      throw new RuntimeFault("INVALID_INPUT", "Command version must be a positive integer", "commandGateway.register");
    }
    const maxPayloadBytes = definition.maxPayloadBytes ?? this.maxPayloadBytes;
    if (!Number.isInteger(maxPayloadBytes) || maxPayloadBytes < 1 || maxPayloadBytes > this.maxPayloadBytes) {
      throw new RuntimeFault("INVALID_INPUT", "Command payload budget is invalid", "commandGateway.register");
    }
    this.#definitions.set(name, Object.freeze({
      ...definition,
      name,
      maxPayloadBytes,
      requiredScopes: Object.freeze([...(definition.requiredScopes ?? [])]),
    }) as CommandDefinition<unknown, unknown>);
    return name;
  }

  dispatch<R = unknown>(
    nameValue: string,
    payload: unknown,
    principal: CommandPrincipal,
    metadata: CommandMetadata,
  ): CommandReceipt<R> {
    const name = commandName(nameValue);
    const definition = this.#definitions.get(name);
    if (!definition) return this.#reject<R>(name, principal, metadata, "NOT_FOUND", "Command is not registered", payload);
    if (!principal.principalId || !principal.sessionId || principal.principalId.length > 128 || principal.sessionId.length > 128) {
      return this.#reject<R>(name, principal, metadata, "INVALID_INPUT", "Principal or session is invalid", payload);
    }
    if (!Number.isSafeInteger(metadata.tick) || metadata.tick < 0 || !metadata.requestId || metadata.requestId.length > 128) {
      return this.#reject<R>(name, principal, metadata, "INVALID_INPUT", "Command metadata is invalid", payload);
    }

    let serialized: string;
    let fingerprint: string;
    try {
      serialized = stableSerialize(payload);
      fingerprint = stableFingerprint(payload);
    } catch (error) {
      return this.#reject<R>(name, principal, metadata, "INVALID_INPUT", error instanceof Error ? error.message : "Payload is invalid", null);
    }
    const payloadBytes = new TextEncoder().encode(serialized).byteLength;
    if (payloadBytes > (definition.maxPayloadBytes ?? this.maxPayloadBytes)) {
      return this.#reject<R>(name, principal, metadata, "CAPACITY_EXCEEDED", "Command payload exceeds its byte budget", null, fingerprint);
    }

    const idempotencyKey = metadata.idempotencyKey?.trim();
    const scopedKey = idempotencyKey ? this.#makeIdempotencyKey(principal, name, idempotencyKey) : undefined;
    if (scopedKey) {
      const existing = this.#idempotency.get(scopedKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          return this.#reject<R>(name, principal, metadata, "CONFLICT", "Idempotency key was reused with a different payload", null, fingerprint);
        }
        this.#replayed += 1;
        return Object.freeze({
          ...existing.receipt,
          status: "replayed",
          replayOf: existing.receipt.sequence,
          requestId: metadata.requestId,
        }) as CommandReceipt<R>;
      }
    }

    for (const scope of definition.requiredScopes ?? []) {
      if (!principal.scopes.has(scope)) {
        return this.#reject<R>(name, principal, metadata, "FORBIDDEN", "Principal lacks a required command scope", null, fingerprint);
      }
    }
    const rate = this.#consumeRate(principal.principalId + ":" + name, metadata.tick);
    if (!rate) {
      return this.#reject<R>(name, principal, metadata, "RATE_LIMITED", "Command rate budget is exhausted", null, fingerprint);
    }
    if (!definition.validate(payload)) {
      return this.#reject<R>(name, principal, metadata, "INVALID_INPUT", "Payload does not match the command contract", null, fingerprint);
    }

    try {
      const result = definition.execute(payload, {
        principal,
        tick: metadata.tick,
        requestId: metadata.requestId,
        command: name,
      });
      const receipt: CommandReceipt<R> = Object.freeze({
        sequence: this.#nextSequence(),
        command: name,
        requestId: metadata.requestId,
        principalId: principal.principalId,
        tick: metadata.tick,
        payloadFingerprint: fingerprint,
        status: "accepted",
        result: result as R,
      });
      this.#accepted += 1;
      this.#appendReceipt(receipt);
      if (scopedKey) this.#rememberIdempotency(scopedKey, fingerprint, receipt);
      return receipt;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Command execution failed";
      const receipt: CommandReceipt<R> = Object.freeze({
        sequence: this.#nextSequence(),
        command: name,
        requestId: metadata.requestId,
        principalId: principal.principalId,
        tick: metadata.tick,
        payloadFingerprint: fingerprint,
        status: "failed",
        fault: Object.freeze({ code: error instanceof RuntimeFault ? error.code : "INTERNAL", message }),
      });
      this.#rejected += 1;
      this.#appendReceipt(receipt);
      return receipt;
    }
  }

  receipts(afterSequence = 0, limit = 100): readonly CommandReceipt[] {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new RuntimeFault("INVALID_INPUT", "Receipt cursor is invalid", "commandGateway.receipts");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new RuntimeFault("INVALID_INPUT", "Receipt page size is invalid", "commandGateway.receipts");
    }
    return Object.freeze(this.#receipts.filter((receipt) => receipt.sequence > afterSequence).slice(0, limit));
  }

  stats(): Readonly<{
    registeredCommands: number;
    accepted: number;
    rejected: number;
    replayed: number;
    receipts: number;
    idempotencyEntries: number;
    principalBuckets: number;
  }> {
    return Object.freeze({
      registeredCommands: this.#definitions.size,
      accepted: this.#accepted,
      rejected: this.#rejected,
      replayed: this.#replayed,
      receipts: this.#receipts.length,
      idempotencyEntries: this.#idempotency.size,
      principalBuckets: this.#buckets.size,
    });
  }

  #reject<R>(
    name: CommandName,
    principal: CommandPrincipal,
    metadata: CommandMetadata,
    code: string,
    message: string,
    payload: unknown,
    fingerprint?: string,
  ): CommandReceipt<R> {
    this.#rejected += 1;
    const payloadFingerprint = fingerprint ?? (() => {
      try { return stableFingerprint(payload); } catch { return "invalid-payload"; }
    })();
    const receipt: CommandReceipt = Object.freeze({
      sequence: this.#nextSequence(),
      command: name,
      requestId: metadata.requestId || "invalid-request",
      principalId: principal.principalId || "anonymous",
      tick: Number.isSafeInteger(metadata.tick) && metadata.tick >= 0 ? metadata.tick : 0,
      payloadFingerprint,
      status: "rejected",
      fault: Object.freeze({ code, message }),
    });
    this.#appendReceipt(receipt);
    return receipt as CommandReceipt<R>;
  }

  #nextSequence(): number {
    if (this.#sequence >= Number.MAX_SAFE_INTEGER) {
      throw new RuntimeFault("CAPACITY_EXCEEDED", "Command receipt sequence is exhausted", "commandGateway.sequence");
    }
    this.#sequence += 1;
    return this.#sequence;
  }

  #appendReceipt(receipt: CommandReceipt): void {
    if (this.#receipts.length >= this.receiptCapacity) this.#receipts.shift();
    this.#receipts.push(receipt);
  }

  #makeIdempotencyKey(principal: CommandPrincipal, name: CommandName, key: string): string {
    if (key.length > 128) {
      throw new RuntimeFault("INVALID_INPUT", "Idempotency key is too long", "commandGateway.idempotency");
    }
    return principal.principalId + "|" + principal.sessionId + "|" + name + "|" + key;
  }

  #rememberIdempotency(key: string, fingerprint: string, receipt: CommandReceipt): void {
    if (this.#idempotency.has(key)) this.#idempotency.delete(key);
    if (this.#idempotency.size >= this.idempotencyCapacity) {
      const oldest = this.#idempotency.keys().next().value;
      if (oldest !== undefined) this.#idempotency.delete(oldest);
    }
    this.#idempotency.set(key, Object.freeze({ key, fingerprint, receipt }));
  }

  #consumeRate(key: string, tick: number): boolean {
    let bucket = this.#buckets.get(key);
    if (!bucket) {
      if (this.#buckets.size >= this.maxPrincipalBuckets) {
        const oldest = this.#buckets.keys().next().value;
        if (oldest !== undefined) this.#buckets.delete(oldest);
      }
      bucket = { tokens: this.rateCapacity, lastTick: tick };
      this.#buckets.set(key, bucket);
    }
    if (tick < bucket.lastTick) return false;
    const elapsed = tick - bucket.lastTick;
    bucket.tokens = Math.min(this.rateCapacity, bucket.tokens + elapsed * this.rateRefillPerTick);
    bucket.lastTick = tick;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}
