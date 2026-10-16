import { describe, expect, it, vi } from "vitest";
import { CommandGateway } from "../../src/engine-ts/r45";

const principal = {
  principalId: "player-1",
  sessionId: "session-1",
  scopes: new Set(["player.move", "profile.read"]),
};

describe("CommandGateway", () => {
  it("validates payloads, enforces scopes and returns sequence receipts", () => {
    const gateway = new CommandGateway();
    const execute = vi.fn((payload: { x: number }) => ({ moved: payload.x }));
    gateway.register({
      name: "player.move",
      version: 1,
      requiredScopes: ["player.move"],
      validate: (value): value is { x: number } =>
        typeof value === "object" && value !== null && typeof (value as { x?: unknown }).x === "number",
      execute,
    });
    const receipt = gateway.dispatch("player.move", { x: 3 }, principal, { tick: 1, requestId: "req-1" });
    expect(receipt.status).toBe("accepted");
    expect(receipt.result).toEqual({ moved: 3 });
    expect(receipt.sequence).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects missing scope and invalid payloads without invoking handlers", () => {
    const gateway = new CommandGateway();
    const execute = vi.fn(() => true);
    gateway.register({
      name: "admin.reset",
      version: 1,
      requiredScopes: ["admin"],
      validate: (value): value is { ok: boolean } =>
        typeof value === "object" && value !== null && typeof (value as { ok?: unknown }).ok === "boolean",
      execute,
    });
    const receipt = gateway.dispatch("admin.reset", { ok: true }, principal, { tick: 1, requestId: "req-2" });
    expect(receipt.status).toBe("rejected");
    expect(receipt.fault?.code).toBe("FORBIDDEN");
    expect(execute).not.toHaveBeenCalled();
  });

  it("deduplicates an identical idempotency key and payload", () => {
    const gateway = new CommandGateway();
    const execute = vi.fn((payload: { n: number }) => payload.n * 2);
    gateway.register({
      name: "math.double",
      version: 1,
      validate: (value): value is { n: number } =>
        typeof value === "object" && value !== null && typeof (value as { n?: unknown }).n === "number",
      execute,
    });
    const first = gateway.dispatch("math.double", { n: 8 }, principal, {
      tick: 1, requestId: "first", idempotencyKey: "operation-1",
    });
    const second = gateway.dispatch("math.double", { n: 8 }, principal, {
      tick: 2, requestId: "retry", idempotencyKey: "operation-1",
    });
    expect(first.status).toBe("accepted");
    expect(second.status).toBe("replayed");
    expect(second.replayOf).toBe(first.sequence);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("refuses reusing an idempotency key for a different payload", () => {
    const gateway = new CommandGateway();
    gateway.register({
      name: "inventory.add",
      version: 1,
      validate: (value): value is { count: number } =>
        typeof value === "object" && value !== null && typeof (value as { count?: unknown }).count === "number",
      execute: (payload) => payload.count,
    });
    gateway.dispatch("inventory.add", { count: 1 }, principal, { tick: 1, requestId: "a", idempotencyKey: "same" });
    const conflict = gateway.dispatch("inventory.add", { count: 2 }, principal, {
      tick: 1, requestId: "b", idempotencyKey: "same",
    });
    expect(conflict.status).toBe("rejected");
    expect(conflict.fault?.code).toBe("CONFLICT");
  });

  it("applies a bounded token bucket per principal and command", () => {
    const gateway = new CommandGateway({ rateCapacity: 2, rateRefillPerTick: 1 });
    gateway.register({
      name: "ping",
      version: 1,
      validate: (value): value is null => value === null,
      execute: () => "pong",
    });
    expect(gateway.dispatch("ping", null, principal, { tick: 0, requestId: "1" }).status).toBe("accepted");
    expect(gateway.dispatch("ping", null, principal, { tick: 0, requestId: "2" }).status).toBe("accepted");
    expect(gateway.dispatch("ping", null, principal, { tick: 0, requestId: "3" }).fault?.code).toBe("RATE_LIMITED");
    expect(gateway.dispatch("ping", null, principal, { tick: 1, requestId: "4" }).status).toBe("accepted");
  });

  it("enforces payload bytes and deterministic validation errors", () => {
    const gateway = new CommandGateway({ maxPayloadBytes: 64 });
    gateway.register({
      name: "profile.write",
      version: 1,
      maxPayloadBytes: 64,
      validate: (value): value is { text: string } =>
        typeof value === "object" && value !== null && typeof (value as { text?: unknown }).text === "string",
      execute: () => true,
    });
    const big = gateway.dispatch("profile.write", { text: "x".repeat(200) }, principal, { tick: 1, requestId: "big" });
    expect(big.fault?.code).toBe("CAPACITY_EXCEEDED");
    const invalid = gateway.dispatch("profile.write", { text: 4 }, principal, { tick: 2, requestId: "bad" });
    expect(invalid.fault?.code).toBe("INVALID_INPUT");
  });

  it("contains handler exceptions and still creates an auditable receipt", () => {
    const gateway = new CommandGateway();
    gateway.register({
      name: "fails",
      version: 1,
      validate: (value): value is null => value === null,
      execute: () => { throw new Error("handler fault"); },
    });
    const receipt = gateway.dispatch("fails", null, principal, { tick: 2, requestId: "failure" });
    expect(receipt.status).toBe("failed");
    expect(receipt.fault?.message).toBe("handler fault");
    expect(gateway.receipts()).toContainEqual(receipt);
  });

  it("keeps receipt history bounded and supports cursor pagination", () => {
    const gateway = new CommandGateway({ receiptCapacity: 2 });
    gateway.register({
      name: "ping",
      version: 1,
      validate: (value): value is null => value === null,
      execute: () => "pong",
    });
    gateway.dispatch("ping", null, principal, { tick: 1, requestId: "1" });
    gateway.dispatch("ping", null, principal, { tick: 2, requestId: "2" });
    gateway.dispatch("ping", null, principal, { tick: 3, requestId: "3" });
    expect(gateway.receipts()).toHaveLength(2);
    expect(gateway.receipts(2)[0]?.requestId).toBe("3");
    expect(gateway.stats().accepted).toBe(3);
  });
});
