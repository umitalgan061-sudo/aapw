import { describe, expect, it } from "vitest";
import { R44Runtime } from "../../src/engine-ts/r44/runtime.ts";

const moveSchema = {
  type: "object" as const,
  required: ["x", "z"],
  additionalProperties: false,
  fields: {
    x: { type: "number" as const, min: -1, max: 1 },
    z: { type: "number" as const, min: -1, max: 1 },
  },
};

function createRuntime() {
  let clock = 10;
  const runtime = new R44Runtime({ now: () => clock, maxFrameBudgetMs: 16 });
  return { runtime, advance: (amount: number) => { clock += amount; } };
}

describe("R44Runtime integration", () => {
  it("validates, authorizes, queues, executes, and journals a command", async () => {
    const { runtime, advance } = createRuntime();
    let applied = 0;
    expect(runtime.registerCommand({
      name: "player.move",
      permission: "player.move",
      scope: "player-1",
      schema: moveSchema,
      lane: "simulation",
      priority: 0,
      costMs: 0.5,
      execute: (payload) => {
        const vector = payload as { x: number; z: number };
        applied += 1;
        return { accepted: true, magnitude: Math.abs(vector.x) + Math.abs(vector.z) };
      },
    }).ok).toBe(true);
    expect((await runtime.start()).success).toBe(true);
    const capability = runtime.issueCapability({
      scope: "player-1",
      permissions: ["player.move"],
      issuedAtMs: 0,
      expiresAtMs: 1000,
      label: "player input",
    });
    const queued = runtime.submitCommand({
      id: "cmd-0001",
      name: "player.move",
      scope: "player-1",
      sequence: 1,
      frame: 0,
      nowMs: 10,
      payload: { x: 0.5, z: -0.25 },
      capability,
    });
    expect(queued.ok).toBe(true);
    advance(1);
    const frame = runtime.runFrame(0, 4);
    expect(frame.ok).toBe(true);
    expect(applied).toBe(1);
    expect(runtime.journal.records().some((record) => record.type === "command.executed")).toBe(true);
    if (frame.ok) {
      expect(frame.value.budget.executed).toBe(1);
      expect(frame.value.digest.length).toBeGreaterThan(0);
    }
    await runtime.dispose();
  });

  it("rejects untrusted scope, permissions, and malformed payloads", async () => {
    const { runtime } = createRuntime();
    runtime.registerCommand({
      name: "player.move",
      permission: "player.move",
      scope: "player-1",
      schema: moveSchema,
      execute: () => undefined,
    });
    await runtime.start();
    const capability = runtime.issueCapability({
      scope: "player-1",
      permissions: ["player.move"],
      issuedAtMs: 0,
      expiresAtMs: 1000,
      label: "player input",
    });
    expect(runtime.submitCommand({
      id: "cmd-0002", name: "player.move", scope: "player-2",
      sequence: 1, frame: 0, nowMs: 10, payload: { x: 0, z: 0 }, capability,
    }).ok).toBe(false);
    expect(runtime.submitCommand({
      id: "cmd-0003", name: "player.move", scope: "player-1",
      sequence: 1, frame: 0, nowMs: 10, payload: { x: 100, z: 0 }, capability,
    }).ok).toBe(false);
    expect(runtime.submitCommand({
      id: "cmd-0004", name: "player.move", scope: "player-1",
      sequence: 1, frame: 0, nowMs: 10, payload: { x: 0, z: 0 }, capability: { ...capability },
    }).ok).toBe(false);
    await runtime.dispose();
  });

  it("rejects replayed command nonces and monotonic frame violations", async () => {
    const { runtime } = createRuntime();
    runtime.registerCommand({ name: "noop", permission: "noop", schema: { type: "null" }, execute: () => null });
    await runtime.start();
    const capability = runtime.issueCapability({
      scope: "system", permissions: ["noop"], issuedAtMs: 0, expiresAtMs: 1000, label: "system test",
    });
    const request = {
      id: "nonce-command-0001",
      name: "noop",
      scope: "system",
      sequence: 7,
      frame: 0,
      nowMs: 10,
      payload: null,
      capability,
    };
    expect(runtime.submitCommand(request).ok).toBe(true);
    expect(runtime.submitCommand(request).ok).toBe(false);
    expect(runtime.runFrame(0, 3).ok).toBe(true);
    expect(runtime.runFrame(0, 3).ok).toBe(false);
    await runtime.dispose();
  });

  it("integrates service startup and reverse shutdown", async () => {
    const { runtime } = createRuntime();
    const events: string[] = [];
    runtime.registerService({ id: "assets-service", start: () => { events.push("start"); return {}; }, stop: () => { events.push("stop"); } });
    expect((await runtime.start()).success).toBe(true);
    expect(runtime.started).toBe(true);
    expect((await runtime.stop()).success).toBe(true);
    expect(events).toEqual(["start", "stop"]);
    expect(runtime.started).toBe(false);
  });

  it("returns bounded observable frame summaries", async () => {
    const { runtime } = createRuntime();
    await runtime.start();
    runtime.enqueueWork({ id: "work-0001", lane: "background", priority: 4, costMs: 0.2, run: () => undefined }, 0);
    const result = runtime.runFrame(0, 2);
    expect(result.ok).toBe(true);
    const snapshot = runtime.snapshot();
    expect(snapshot.frame).toBe(0);
    expect(snapshot.journalSize).toBeGreaterThan(0);
    expect(snapshot.telemetryDigest).toHaveLength(8);
    await runtime.dispose();
  });
});
