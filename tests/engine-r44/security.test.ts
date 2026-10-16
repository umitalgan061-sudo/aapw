import { describe, expect, it } from "vitest";
import { BoundaryValidator, CapabilityAuthority, ReplayGuard, SlidingWindowLimiter } from "../../src/engine-ts/r44/security.ts";

describe("R44 security boundary", () => {
  it("validates and normalizes schema-controlled objects", () => {
    const validator = new BoundaryValidator();
    const schema = {
      type: "object" as const,
      required: ["name", "level"],
      additionalProperties: false,
      fields: {
        name: { type: "string" as const, minLength: 2, maxLength: 24, normalize: "trim" as const },
        level: { type: "number" as const, min: 1, max: 10, integer: true },
        active: { type: "boolean" as const },
      },
    };
    const accepted = validator.validate({ name: "  Knight ", level: 4, active: true }, schema);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.value.value).toMatchObject({ name: "Knight", level: 4, active: true });
    expect(validator.validate({ name: "x", level: 4, active: true }, schema).ok).toBe(false);
    expect(validator.validate({ name: "Knight", level: 44, extra: true }, schema).ok).toBe(false);
  });

  it("rejects cycles, accessors, sparse arrays, and non-finite values", () => {
    const validator = new BoundaryValidator();
    const object: Record<string, unknown> = {};
    object.self = object;
    expect(validator.validate(object, { type: "object", fields: {} }).ok).toBe(false);
    const accessor = Object.defineProperty({}, "value", { get: () => 7, enumerable: true });
    expect(validator.validate(accessor, { type: "object", fields: {} }).ok).toBe(false);
    expect(validator.validate([, 1], { type: "array", items: { type: "number" } }).ok).toBe(false);
    expect(validator.validate(Number.POSITIVE_INFINITY, { type: "number" }).ok).toBe(false);
  });

  it("enforces encoded byte budgets and node limits", () => {
    const tiny = new BoundaryValidator({ maxPayloadBytes: 256, maxNodes: 8 });
    expect(tiny.validate("x".repeat(500), { type: "string" }).ok).toBe(false);
    expect(tiny.validate([1, 2, 3, 4, 5, 6, 7, 8, 9], { type: "array", items: { type: "number" } }).ok).toBe(false);
  });

  it("enforces a bounded sliding rate window by key", () => {
    const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 100, maxKeys: 8, maxEventsPerKey: 8 });
    expect(limiter.consume("player-A", 10).allowed).toBe(true);
    expect(limiter.consume("player-A", 11).allowed).toBe(true);
    expect(limiter.consume("player-A", 12).allowed).toBe(false);
    expect(limiter.consume("player-B", 12).allowed).toBe(true);
    expect(limiter.consume("player-A", 111).allowed).toBe(true);
    expect(limiter.keyCount()).toBeLessThanOrEqual(8);
  });

  it("issues object-identity capabilities with explicit scope, permission, and expiry", () => {
    const authority = new CapabilityAuthority();
    const token = authority.issue({ scope: "player-1", permissions: ["move", "inventory.read"], issuedAtMs: 10, expiresAtMs: 100, label: "input" });
    expect(authority.authorize(token, "player-1", "move", 50)).toBe(true);
    expect(authority.authorize(token, "player-2", "move", 50)).toBe(false);
    expect(authority.authorize(token, "player-1", "delete", 50)).toBe(false);
    expect(authority.authorize(token, "player-1", "move", 101)).toBe(false);
    expect(authority.authorize({ ...token }, "player-1", "move", 50)).toBe(false);
    expect(authority.revoke(token)).toBe(true);
    expect(authority.authorize(token, "player-1", "move", 50)).toBe(false);
  });

  it("rejects nonce replay and prunes expired nonces", () => {
    const guard = new ReplayGuard({ capacity: 32, ttlMs: 10 });
    expect(guard.accept("nonce-123456", 10).ok).toBe(true);
    expect(guard.accept("nonce-123456", 11).ok).toBe(false);
    expect(guard.prune(21)).toBe(1);
    expect(guard.accept("nonce-123456", 22).ok).toBe(true);
  });

  it("does not create unbounded limiter keys", () => {
    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 10, maxKeys: 8, maxEventsPerKey: 8 });
    for (let index = 0; index < 100; index += 1) limiter.consume("key-" + index, index);
    expect(limiter.keyCount()).toBeLessThanOrEqual(8);
  });

  it("revokes all previously issued capabilities in bulk", () => {
    const authority = new CapabilityAuthority();
    const first = authority.issue({ scope: "session-a", permissions: ["read"], issuedAtMs: 1, expiresAtMs: 100, label: "one" });
    const second = authority.issue({ scope: "session-b", permissions: ["write"], issuedAtMs: 1, expiresAtMs: 100, label: "two" });
    authority.revokeAll();
    expect(authority.authorize(first, "session-a", "read", 2)).toBe(false);
    expect(authority.authorize(second, "session-b", "write", 2)).toBe(false);
    expect(authority.hasIssued(first)).toBe(false);
  });
});
