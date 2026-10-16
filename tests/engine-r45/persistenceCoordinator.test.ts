import { describe, expect, it } from "vitest";
import {
  MemoryPersistenceAdapter,
  PersistenceCoordinator,
  stableFingerprint,
} from "../../src/engine-ts/r45";

type PlayerSave = { level: number; inventory: string[] };

function isPlayerSave(value: unknown): value is PlayerSave {
  return typeof value === "object" && value !== null &&
    typeof (value as { level?: unknown }).level === "number" &&
    Array.isArray((value as { inventory?: unknown }).inventory);
}

describe("PersistenceCoordinator", () => {
  it("writes versioned envelopes and reads values through a type guard", async () => {
    const adapter = new MemoryPersistenceAdapter();
    const persistence = new PersistenceCoordinator(adapter, { schemaVersion: 1 });
    const value: PlayerSave = { level: 4, inventory: ["sword", "map"] };
    const saved = await persistence.save("player.main", value, 20);
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw saved.error;
    expect(saved.value).toMatchObject({ key: "player.main", revision: 1, schemaVersion: 1, attempts: 1 });
    const loaded = await persistence.load("player.main", isPlayerSave);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw loaded.error;
    expect(loaded.value.value).toEqual(value);
    expect(loaded.value.fingerprint).toBe(stableFingerprint(value));
  });

  it("increments revisions with compare-and-swap and retries concurrent writes", async () => {
    const adapter = new MemoryPersistenceAdapter();
    const persistence = new PersistenceCoordinator(adapter, { schemaVersion: 1, maxRetries: 4 });
    const results = await Promise.all([
      persistence.save("shared", { writer: "a" }, 1),
      persistence.save("shared", { writer: "b" }, 2),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    const stored = await adapter.read("shared");
    expect(stored?.revision).toBe(2);
    expect(adapter.stats().keys).toBe(1);
  });

  it("migrates adjacent schema versions in deterministic order", async () => {
    const adapter = new MemoryPersistenceAdapter();
    const old = new PersistenceCoordinator(adapter, { schemaVersion: 1 });
    const saved = await old.save("world", { coins: 4 }, 1);
    expect(saved.ok).toBe(true);
    const current = new PersistenceCoordinator(adapter, { schemaVersion: 3 });
    current.registerMigration({
      fromVersion: 1, toVersion: 2,
      migrate: (value) => ({ ...(value as object), migration: 2 }),
    });
    current.registerMigration({
      fromVersion: 2, toVersion: 3,
      migrate: (value) => ({ ...(value as object), normalized: true }),
    });
    const loaded = await current.load("world", (value): value is { coins: number; migration: number; normalized: boolean } =>
      typeof value === "object" && value !== null &&
      "coins" in value && "migration" in value && "normalized" in value);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw loaded.error;
    expect(loaded.value.migrated).toBe(true);
    expect(loaded.value.value).toEqual({ coins: 4, migration: 2, normalized: true });
  });

  it("fails closed when the migration chain has a missing link", async () => {
    const adapter = new MemoryPersistenceAdapter();
    const old = new PersistenceCoordinator(adapter, { schemaVersion: 1 });
    await old.save("world", { coins: 4 }, 1);
    const current = new PersistenceCoordinator(adapter, { schemaVersion: 2 });
    const loaded = await current.load("world", (value): value is object =>
      typeof value === "object" && value !== null);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.error.message).toMatch(/migration/u);
  });

  it("uses a cached last-good value instead of returning tampered bytes", async () => {
    const adapter = new MemoryPersistenceAdapter();
    const persistence = new PersistenceCoordinator(adapter, { schemaVersion: 1 });
    await persistence.save("safe", { health: 90 }, 1);
    adapter.corruptForTest("safe", (envelope) => ({ ...envelope, payload: '{"health":0}' }));
    const loaded = await persistence.load("safe", (value): value is { health: number } =>
      typeof value === "object" && value !== null && typeof (value as { health?: unknown }).health === "number");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw loaded.error;
    expect(loaded.value.value).toEqual({ health: 90 });
  });

  it("enforces save payload budget and validates key paths", async () => {
    const persistence = new PersistenceCoordinator(new MemoryPersistenceAdapter(), {
      schemaVersion: 1, maxPayloadBytes: 128,
    });
    const huge = await persistence.save("save", { value: "x".repeat(500) }, 1);
    expect(huge.ok).toBe(false);
    if (!huge.ok) expect(huge.error.code).toBe("CAPACITY_EXCEEDED");
    await expect(persistence.save("../private", { health: 1 }, 1)).rejects.toThrow();
  });

  it("supports dry-run imports without mutating target storage", async () => {
    const sourceAdapter = new MemoryPersistenceAdapter();
    const source = new PersistenceCoordinator(sourceAdapter, { schemaVersion: 1 });
    await source.save("profile", { unlocked: true }, 7);
    const exported = await source.exportEnvelope("profile");
    expect(exported.ok).toBe(true);
    if (!exported.ok) throw exported.error;
    const targetAdapter = new MemoryPersistenceAdapter();
    const target = new PersistenceCoordinator(targetAdapter, { schemaVersion: 1 });
    const dryRun = await target.importEnvelope(exported.value, { dryRun: true, savedAtTick: 10 });
    expect(dryRun.ok).toBe(true);
    expect(await targetAdapter.read("profile")).toBeNull();
    const imported = await target.importEnvelope(exported.value, { savedAtTick: 10 });
    expect(imported.ok).toBe(true);
    expect((await targetAdapter.read("profile"))?.savedAtTick).toBe(10);
  });

  it("refuses overwriting an existing target unless explicitly requested", async () => {
    const adapter = new MemoryPersistenceAdapter();
    const persistence = new PersistenceCoordinator(adapter, { schemaVersion: 1 });
    await persistence.save("profile", { unlocked: true }, 1);
    const envelope = await persistence.exportEnvelope("profile");
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) throw envelope.error;
    const result = await persistence.importEnvelope(envelope.value, { savedAtTick: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CONFLICT");
  });
});
