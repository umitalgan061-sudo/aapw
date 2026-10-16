import { describe, expect, it } from "vitest";
import { BoundedTelemetrySpool } from "../../src/engine-ts/r45";

describe("BoundedTelemetrySpool", () => {
  it("accepts allowlisted fields and produces verifiable immutable events", () => {
    const spool = new BoundedTelemetrySpool({ capacity: 4 });
    const result = spool.emit({
      tick: 1, category: "runtime", severity: "info", event: "frame",
      fields: { component: "renderer", frameMs: 16.2, count: 4 },
    });
    expect(result.accepted).toBe(true);
    const event = spool.page().events[0]!;
    expect(spool.verify(event)).toBe(true);
    expect(Object.isFrozen(event.fields)).toBe(true);
  });

  it("filters unknown keys and values that look like personal or network identifiers", () => {
    const spool = new BoundedTelemetrySpool();
    spool.emit({
      tick: 1, category: "runtime", severity: "warn", event: "boundary",
      fields: { component: "gateway", details: "contact person@example.com", ip: "192.0.2.1", customPrivate: "secret" } as never,
    });
    const event = spool.page().events[0]!;
    expect(event.fields.component).toBe("gateway");
    expect(event.fields.details).toBeUndefined();
    expect(event.fields.customPrivate).toBeUndefined();
    expect(spool.snapshot().filtered).toBeGreaterThan(0);
  });

  it("deterministically samples low-severity events but always retains errors", () => {
    const spool = new BoundedTelemetrySpool({ sampleRate: 0, deterministicSeed: "seed" });
    expect(spool.emit({ tick: 1, category: "test", severity: "debug", event: "noise" }).reason).toBe("sampled");
    const error = spool.emit({ tick: 2, category: "test", severity: "error", event: "error" });
    expect(error.accepted).toBe(true);
    expect(spool.page().events[0]?.severity).toBe("error");
  });

  it("evicts lower-severity events to retain a critical incident", () => {
    const spool = new BoundedTelemetrySpool({ capacity: 2 });
    spool.emit({ tick: 1, category: "x", severity: "info", event: "one" });
    spool.emit({ tick: 2, category: "x", severity: "warn", event: "two" });
    const critical = spool.emit({ tick: 3, category: "x", severity: "critical", event: "three" });
    expect(critical.accepted).toBe(true);
    expect(spool.page().events.map((event) => event.event)).toEqual(["two", "three"]);
    expect(spool.snapshot().dropped).toBe(1);
  });

  it("rejects invalid ticks and bounds fields and strings", () => {
    const spool = new BoundedTelemetrySpool({ maxFields: 1, maxStringLength: 8 });
    expect(spool.emit({ tick: -1, category: "x", severity: "info", event: "bad" }).reason).toBe("invalid");
    spool.emit({
      tick: 1, category: "x", severity: "info", event: "bounded",
      fields: { component: "long-component-name", operation: "too-many" },
    });
    expect(spool.page().events[0]?.fields.component).toBe("long-com");
    expect(spool.page().events[0]?.fields.operation).toBeUndefined();
  });

  it("supports cursor pages and monotonic acknowledgements", () => {
    const spool = new BoundedTelemetrySpool({ capacity: 8, exportPageLimit: 2 });
    for (let tick = 1; tick <= 5; tick += 1) {
      spool.emit({ tick, category: "system", severity: "info", event: "e-" + tick });
    }
    const first = spool.page(0, 2);
    expect(first.events.map((event) => event.tick)).toEqual([1, 2]);
    expect(first.hasMore).toBe(true);
    expect(spool.acknowledgeThrough(first.nextCursor)).toBe(2);
    expect(spool.page().events[0]?.tick).toBe(3);
    expect(() => spool.acknowledgeThrough(1)).toThrow();
  });

  it("does not include values for fields outside the explicit privacy allowlist", () => {
    const spool = new BoundedTelemetrySpool({ allowedFields: ["status"] });
    spool.emit({
      tick: 1, category: "app", severity: "info", event: "state",
      fields: { component: "hidden", status: "ready" },
    });
    expect(spool.page().events[0]?.fields).toEqual({ status: "ready" });
  });
});
