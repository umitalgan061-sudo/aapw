import { describe, expect, it } from "vitest";
import { R44MemorySaveStore, R44SaveCoordinator, R44SaveMigrationRegistry } from "../../../src/engine-ts/r44/saveCoordinator.js";
import { R44RuntimeAssurance } from "../../../src/engine-ts/r44/runtimeAssurance.js";

describe("R44 save coordinator", () => {
  it("commits atomically and enforces optimistic revisions", async () => {
    const store = new R44MemorySaveStore();
    const migrations = new R44SaveMigrationRegistry();
    const saves = new R44SaveCoordinator(store, migrations, { currentSchema: "world-state", currentSchemaRevision: 2 });
    const first = await saves.commit("slot-1", { position: { x: 1, z: 2 }, inventory: [] }, { savedTick: 10 });
    expect(first.committed).toBe(true);
    expect(first.envelope?.revision).toBe(1);
    const conflict = await saves.commit("slot-1", { position: { x: 9, z: 9 }, inventory: [] }, {
      savedTick: 11, expectedRevision: 0,
    });
    expect(conflict.committed).toBe(false);
    expect(conflict.conflict).toBe("revision");
    const update = await saves.commit("slot-1", { position: { x: 3, z: 4 }, inventory: ["sword"] }, {
      savedTick: 12, expectedRevision: 1,
    });
    expect(update.envelope?.revision).toBe(2);
    expect((await saves.load("slot-1"))?.state).toEqual({ position: { x: 3, z: 4 }, inventory: ["sword"] });
  });

  it("migrates old save schema revisions via an explicit ordered path", async () => {
    const store = new R44MemorySaveStore();
    const old = new R44SaveCoordinator(store, new R44SaveMigrationRegistry(), {
      currentSchema: "world-state",
      currentSchemaRevision: 1,
    });
    await old.commit("old-slot", { position: { x: 3, z: 4 } }, { savedTick: 2 });
    const migrations = new R44SaveMigrationRegistry();
    migrations.register({
      schema: "world-state",
      fromRevision: 1,
      toRevision: 2,
      migrate: (state) => ({ ...(state as { [key: string]: import("../../../src/engine-ts/r44/contracts.js").R44JsonValue }), schemaV2: true }),
    });
    const current = new R44SaveCoordinator(store, migrations, {
      currentSchema: "world-state",
      currentSchemaRevision: 2,
    });
    await expect(current.load("old-slot")).resolves.toMatchObject({
      schemaRevision: 2,
      state: { position: { x: 3, z: 4 }, schemaV2: true },
    });
  });

  it("rejects a save whose content fingerprint was modified", async () => {
    const store = new R44MemorySaveStore();
    const saves = new R44SaveCoordinator(store, new R44SaveMigrationRegistry(), {
      currentSchema: "world",
      currentSchemaRevision: 1,
    });
    const committed = await saves.commit("tamper", { health: 100 }, { savedTick: 1 });
    expect(committed.committed).toBe(true);
    const envelope = await store.read(committed.envelope!.id);
    expect(envelope).not.toBeNull();
    const tampered = { ...envelope!, state: { health: 0 } };
    const tamperingStore = {
      read: async () => tampered,
      list: async () => [tampered],
      writeAtomic: async () => false,
      delete: async () => false,
    };
    const reader = new R44SaveCoordinator(tamperingStore, new R44SaveMigrationRegistry(), {
      currentSchema: "world",
      currentSchemaRevision: 1,
    });
    await expect(reader.load("tamper")).rejects.toThrow();
  });
});

describe("R44 runtime assurance composition", () => {
  it("coordinates lifecycle, event integrity, tasks, and readiness", async () => {
    const runtime = new R44RuntimeAssurance({ id: "integration-test", initialTick: 0 });
    runtime.start(1);
    const observed = runtime.observePerformance({
      tick: 2,
      frameMs: 7,
      simulationMs: 2,
      renderMs: 3,
      memoryMb: 100,
      networkRttMs: 30,
      activeEntities: 50,
      queuedTasks: 4,
    });
    expect(observed.sampleCount).toBe(1);
    runtime.submitTask({
      key: "update-hud",
      owner: "ui",
      lane: "interactive",
      createdTick: 2,
      run: () => "drawn",
    });
    expect(runtime.drainTasks({ tick: 3 }).executed).toBe(1);
    expect(runtime.ledger.verify().valid).toBe(true);
    expect(runtime.report().phase).toBe("running");
    expect(runtime.readiness().ready).toBe(true);
    await runtime.shutdown(4);
    expect(runtime.phase).toBe("stopped");
    expect(runtime.ledger.verify().valid).toBe(true);
  });

  it("rejects invalid state transitions and captures hook failures", () => {
    const runtime = new R44RuntimeAssurance({ id: "lifecycle-test" });
    expect(() => runtime.transition("running", 0)).toThrow();
    runtime.start();
    runtime.registerHook({
      id: "bad-hook",
      onPressure: () => { throw new Error("observer fault"); },
    });
    runtime.observePerformance({
      tick: 1,
      frameMs: 100,
      simulationMs: 50,
      renderMs: 50,
      memoryMb: 2_000,
      networkRttMs: 999,
      activeEntities: 90_000,
      queuedTasks: 40_000,
    });
    expect(runtime.incidents.snapshot().active.some((incident) => incident.subsystem === "runtime-hook")).toBe(true);
  });
});
