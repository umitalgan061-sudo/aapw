import {
  assetIdV15,
  clampV15,
  tickV15,
  type AssetDescriptorV15,
  type AssetRecordV15,
  type AssetStateV15,
  type TickV15,
} from "./types.ts";

export interface AssetPipelineBudgetV15 {
  readonly maxBytes: number;
  readonly maxRecords: number;
  readonly maxConcurrent: number;
  readonly maxRetries: number;
  readonly requestTimeoutMs: number;
  readonly staleAfterTicks: number;
}

export interface AssetLoadResultV15 {
  readonly record: AssetRecordV15;
  readonly data: ArrayBuffer;
  readonly responseUrl: string;
  readonly contentType: string;
  readonly digestSha256: string | null;
}

export interface AssetPipelineOptionsV15 extends Partial<AssetPipelineBudgetV15> {
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

const DEFAULT_BUDGET_V15: AssetPipelineBudgetV15 = Object.freeze({
  maxBytes: 768 * 1024 * 1024,
  maxRecords: 10_000,
  maxConcurrent: 6,
  maxRetries: 3,
  requestTimeoutMs: 20_000,
  staleAfterTicks: 3_600,
});

function normalizeUrlV15(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new RangeError("asset url is empty");
  const parsed = new URL(trimmed, "https://aapw.invalid");
  if (!["http:", "https:", "blob:"].includes(parsed.protocol)) throw new RangeError("unsupported asset protocol");
  return parsed.href;
}

async function digestSha256V15(data: ArrayBuffer): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) return "";
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

function stateRank(state: AssetStateV15): number {
  return { failed: 0, stale: 1, ready: 2, queued: 3, declared: 4, loading: 5, evicted: 6 }[state];
}

function chooseVictim(records: Iterable<AssetRecordV15>, tick: TickV15): AssetRecordV15 | undefined {
  return [...records]
    .filter(record => record.references === 0 && record.state !== "loading" && !record.critical)
    .sort((a, b) =>
      stateRank(a.state) - stateRank(b.state)
      || (Number(tick) - Number(a.lastUsedTick)) - (Number(tick) - Number(b.lastUsedTick))
      || a.priority - b.priority
      || a.id.localeCompare(b.id)
    )[0];
}

export class AssetPipelineV15 {
  readonly #budget: AssetPipelineBudgetV15;
  readonly #fetch: typeof fetch | undefined;
  readonly #now: () => number;
  readonly #records = new Map<string, AssetRecordV15>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #queue = new Set<string>();
  #tick = tickV15(0);
  #active = 0;

  constructor(options: AssetPipelineOptionsV15 = {}) {
    const {
      maxBytes,
      maxRecords,
      maxConcurrent,
      maxRetries,
      requestTimeoutMs,
      staleAfterTicks,
    } = options;
    this.#budget = Object.freeze({
      ...DEFAULT_BUDGET_V15,
      ...(maxBytes === undefined ? {} : { maxBytes }),
      ...(maxRecords === undefined ? {} : { maxRecords }),
      ...(maxConcurrent === undefined ? {} : { maxConcurrent }),
      ...(maxRetries === undefined ? {} : { maxRetries }),
      ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
      ...(staleAfterTicks === undefined ? {} : { staleAfterTicks }),
      maxBytes: Math.max(1, maxBytes ?? DEFAULT_BUDGET_V15.maxBytes),
      maxRecords: Math.max(1, Math.floor(maxRecords ?? DEFAULT_BUDGET_V15.maxRecords)),
      maxConcurrent: Math.max(1, Math.floor(maxConcurrent ?? DEFAULT_BUDGET_V15.maxConcurrent)),
      maxRetries: Math.max(0, Math.floor(maxRetries ?? DEFAULT_BUDGET_V15.maxRetries)),
      requestTimeoutMs: Math.max(250, requestTimeoutMs ?? DEFAULT_BUDGET_V15.requestTimeoutMs),
      staleAfterTicks: Math.max(1, Math.floor(staleAfterTicks ?? DEFAULT_BUDGET_V15.staleAfterTicks)),
    });
    this.#fetch = options.fetchImpl;
    this.#now = options.now ?? (() => typeof performance !== "undefined" ? performance.now() : Date.now());
  }

  declare(descriptor: AssetDescriptorV15): AssetRecordV15 {
    const id = assetIdV15(String(descriptor.id));
    const existing = this.#records.get(id);
    if (existing) return this.#clone(existing);
    const record: AssetRecordV15 = Object.freeze({
      ...descriptor,
      id,
      url: normalizeUrlV15(descriptor.url),
      tags: Object.freeze([...descriptor.tags]),
      state: "declared",
      loadedBytes: 0,
      references: 0,
      attempts: 0,
      version: 1,
      lastUsedTick: this.#tick,
    });
    this.#records.set(id, record);
    this.#trimRecords();
    return this.#clone(record);
  }

  request(id: string, priority?: number): boolean {
    const key = assetIdV15(id);
    const record = this.#records.get(key);
    if (!record || record.state === "evicted") return false;
    const next = priority === undefined
      ? record
      : Object.freeze({ ...record, priority: clampV15(priority, 0, 10_000) });
    if (next.state === "ready" || next.state === "loading") {
      this.#records.set(key, next);
      return true;
    }
    this.#records.set(key, Object.freeze({ ...next, state: "queued" }));
    this.#queue.add(key);
    return true;
  }

  async pump(tick = Number(this.#tick)): Promise<readonly AssetLoadResultV15[]> {
    this.#tick = tickV15(Math.max(0, Math.floor(tick)));
    const results: AssetLoadResultV15[] = [];
    while (this.#active < this.#budget.maxConcurrent && this.#queue.size > 0) {
      const key = this.#pickQueued();
      if (!key) break;
      const result = await this.#loadOne(key);
      if (result) results.push(result);
    }
    return Object.freeze(results);
  }

  retain(id: string, tick = Number(this.#tick)): boolean {
    const key = assetIdV15(id);
    const record = this.#records.get(key);
    if (!record || record.state === "evicted") return false;
    this.#records.set(key, Object.freeze({
      ...record,
      references: record.references + 1,
      lastUsedTick: tickV15(Math.max(0, Math.floor(tick))),
    }));
    return true;
  }

  release(id: string, tick = Number(this.#tick)): boolean {
    const key = assetIdV15(id);
    const record = this.#records.get(key);
    if (!record || record.state === "evicted") return false;
    this.#records.set(key, Object.freeze({
      ...record,
      references: Math.max(0, record.references - 1),
      lastUsedTick: tickV15(Math.max(0, Math.floor(tick))),
    }));
    return true;
  }

  markStale(tick = Number(this.#tick)): number {
    this.#tick = tickV15(Math.max(0, Math.floor(tick)));
    let count = 0;
    for (const [id, record] of this.#records) {
      if (
        record.state === "ready"
        && record.references === 0
        && Number(this.#tick) - Number(record.lastUsedTick) >= this.#budget.staleAfterTicks
      ) {
        this.#records.set(id, Object.freeze({ ...record, state: "stale" }));
        count += 1;
      }
    }
    return count;
  }

  evictBytes(bytesToFree: number): number {
    let remaining = Math.max(0, Math.floor(bytesToFree));
    let freed = 0;
    while (remaining > 0) {
      const victim = chooseVictim(this.#records.values(), this.#tick);
      if (!victim) break;
      freed += victim.loadedBytes;
      remaining -= victim.loadedBytes;
      this.#records.delete(victim.id);
      this.#queue.delete(victim.id);
    }
    return freed;
  }

  get(id: string): AssetRecordV15 | undefined {
    const record = this.#records.get(assetIdV15(id));
    return record ? this.#clone(record) : undefined;
  }

  records(): readonly AssetRecordV15[] {
    return Object.freeze(
      [...this.#records.values()]
        .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
        .map(record => this.#clone(record)),
    );
  }

  stats(): Readonly<{ records: number; queued: number; loading: number; ready: number; stale: number; failed: number; bytes: number; active: number; referenced: number }> {
    let queued = 0;
    let loading = 0;
    let ready = 0;
    let stale = 0;
    let failed = 0;
    let bytes = 0;
    let referenced = 0;
    for (const record of this.#records.values()) {
      if (record.state === "queued") queued += 1;
      if (record.state === "loading") loading += 1;
      if (record.state === "ready") ready += 1;
      if (record.state === "stale") stale += 1;
      if (record.state === "failed") failed += 1;
      bytes += record.loadedBytes;
      referenced += record.references;
    }
    return Object.freeze({ records: this.#records.size, queued, loading, ready, stale, failed, bytes, active: this.#active, referenced });
  }

  update(tick: number): void {
    this.#tick = tickV15(Math.max(0, Math.floor(tick)));
    this.markStale(this.#tick);
    while (this.stats().bytes > this.#budget.maxBytes) {
      const freed = this.evictBytes(this.stats().bytes - this.#budget.maxBytes);
      if (freed <= 0) break;
    }
    this.#trimRecords();
  }

  abort(id: string): boolean {
    const key = assetIdV15(id);
    const controller = this.#controllers.get(key);
    if (!controller) return false;
    controller.abort();
    this.#controllers.delete(key);
    const record = this.#records.get(key);
    if (record) {
      this.#records.set(key, Object.freeze({ ...record, state: "queued" }));
      this.#queue.add(key);
    }
    return true;
  }

  clearUnreferenced(): number {
    let removed = 0;
    for (const [id, record] of this.#records) {
      if (record.references === 0 && record.state !== "loading" && !record.critical) {
        this.#records.delete(id);
        this.#queue.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  async verifyDigest(id: string, expectedDigest: string): Promise<boolean> {
    const record = this.#records.get(assetIdV15(id));
    return Boolean(record && record.digestSha256?.toLowerCase() === expectedDigest.trim().toLowerCase());
  }

  #pickQueued(): string | undefined {
    return [...this.#queue]
      .map(key => this.#records.get(key))
      .filter((record): record is AssetRecordV15 => Boolean(record))
      .sort((a, b) => b.priority - a.priority || Number(a.lastUsedTick) - Number(b.lastUsedTick) || a.id.localeCompare(b.id))[0]?.id;
  }

  async #loadOne(id: string): Promise<AssetLoadResultV15 | undefined> {
    const record = this.#records.get(id);
    if (!record || !this.#fetch || this.#active >= this.#budget.maxConcurrent) return undefined;
    this.#queue.delete(id);
    this.#active += 1;
    const controller = new AbortController();
    this.#controllers.set(id, controller);
    const attempts = record.attempts + 1;
    const loading = Object.freeze({ ...record, state: "loading" as const, attempts, error: undefined });
    this.#records.set(id, loading);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      timeout = setTimeout(() => controller.abort(), this.#budget.requestTimeoutMs);
      const response = await this.#fetch(loading.url, { signal: controller.signal });
      if (!response.ok) throw new Error("HTTP_" + response.status);
      const contentType = response.headers.get("content-type") ?? "";
      if (loading.expectedMime && !contentType.toLowerCase().includes(loading.expectedMime.toLowerCase())) throw new Error("MIME_MISMATCH");
      const data = await response.arrayBuffer();
      const actualDigest = await digestSha256V15(data);
      if (loading.digestSha256 && actualDigest && loading.digestSha256.toLowerCase() !== actualDigest.toLowerCase()) throw new Error("DIGEST_MISMATCH");
      const ready = Object.freeze({
        ...loading,
        state: "ready" as const,
        loadedBytes: data.byteLength,
        version: loading.version + 1,
        lastUsedTick: this.#tick,
        ...(actualDigest ? { digestSha256: actualDigest } : {}),
      });
      this.#records.set(id, ready);
      this.update(Number(this.#tick));
      return {
        record: this.#clone(ready),
        data,
        responseUrl: response.url || loading.url,
        contentType,
        digestSha256: actualDigest || null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 256) : String(error).slice(0, 256);
      const retry = attempts <= this.#budget.maxRetries;
      const failed = Object.freeze({ ...loading, state: retry ? "queued" as const : "failed" as const, error: message });
      this.#records.set(id, failed);
      if (retry) this.#queue.add(id);
      return undefined;
    } finally {
      if (timeout) clearTimeout(timeout);
      this.#controllers.delete(id);
      this.#active = Math.max(0, this.#active - 1);
      void this.#now;
    }
  }

  #trimRecords(): void {
    while (this.#records.size > this.#budget.maxRecords) {
      const victim = chooseVictim(this.#records.values(), this.#tick);
      if (!victim) break;
      this.#records.delete(victim.id);
      this.#queue.delete(victim.id);
    }
  }

  #clone(record: AssetRecordV15): AssetRecordV15 {
    return Object.freeze({ ...record, tags: Object.freeze([...record.tags]) });
  }
}

