/**
 * Asset lifecycle orchestration without binding to a concrete fetch/GL renderer.
 * The host supplies loading and byte ownership; this module enforces lifecycle,
 * dependency, budget, cancellation, dedupe, and integrity contracts around it.
 */
import {
  R44BoundaryError,
  R44InvariantError,
  type R44Fingerprint,
  type R44JsonValue,
  r44FiniteInteger,
  r44NormalizeId,
  r44NormalizeLabel,
  r44ToFailure,
} from "./contracts.js";
import { r44FingerprintBytes } from "./hash.js";

export type R44AssetState =
  | "registered"
  | "queued"
  | "loading"
  | "validating"
  | "ready"
  | "failed"
  | "cancelled"
  | "evicted";

export interface R44AssetDescriptor {
  readonly id: string;
  readonly uri: string;
  readonly version: string;
  readonly contentType: string;
  readonly estimatedBytes: number;
  readonly priority?: number;
  readonly critical?: boolean;
  readonly dependencies?: readonly string[];
  readonly expectedFingerprint?: string;
  readonly metadata?: Readonly<Record<string, R44JsonValue>>;
}

export interface R44AssetPayload {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly reportedFingerprint?: string;
  readonly metadata?: Readonly<Record<string, R44JsonValue>>;
}

export interface R44AssetLoader {
  load(descriptor: R44AssetDescriptor, signal?: AbortSignal): Promise<R44AssetPayload>;
}

export interface R44AssetPipelineOptions {
  readonly maxAssets?: number;
  readonly maxResidentBytes?: number;
  readonly maxAssetBytes?: number;
  readonly maxConcurrentLoads?: number;
  readonly allowedSchemes?: readonly string[];
  readonly allowedOrigins?: readonly string[];
  readonly allowRelativeUris?: boolean;
}

export interface R44AssetRecord {
  readonly id: string;
  readonly uri: string;
  readonly version: string;
  readonly state: R44AssetState;
  readonly critical: boolean;
  readonly priority: number;
  readonly estimatedBytes: number;
  readonly actualBytes: number;
  readonly fingerprint: R44Fingerprint | null;
  readonly registeredTick: number;
  readonly updatedTick: number;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly dependants: readonly string[];
}

export interface R44AssetLoadResult {
  readonly id: string;
  readonly state: "ready" | "failed" | "cancelled";
  readonly fingerprint: R44Fingerprint | null;
  readonly byteLength: number;
  readonly failureCode: string | null;
}

interface R44AssetInternal extends R44AssetRecord {
  readonly descriptor: R44AssetDescriptor;
  readonly dependencyIds: readonly string[];
  payload: R44AssetPayload | null;
  loadPromise: Promise<R44AssetLoadResult> | null;
  controller: AbortController | null;
}

export class R44AssetPipeline {
  readonly #maxAssets: number;
  readonly #maxResidentBytes: number;
  readonly #maxAssetBytes: number;
  readonly #maxConcurrentLoads: number;
  readonly #allowedSchemes: ReadonlySet<string>;
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #allowRelativeUris: boolean;
  readonly #assets = new Map<string, R44AssetInternal>();
  #residentBytes = 0;
  #activeLoads = 0;
  #tick = 0;

  constructor(options: R44AssetPipelineOptions = {}) {
    this.#maxAssets = r44FiniteInteger(options.maxAssets ?? 50_000, "maxAssets", 1, 1_000_000);
    this.#maxResidentBytes = r44FiniteInteger(options.maxResidentBytes ?? 2048 * 1024 * 1024, "maxResidentBytes", 1);
    const maxAssetBytes = options.maxAssetBytes ?? Math.min(128 * 1024 * 1024, this.#maxResidentBytes);
    this.#maxAssetBytes = r44FiniteInteger(maxAssetBytes, "maxAssetBytes", 1, this.#maxResidentBytes);
    this.#maxConcurrentLoads = r44FiniteInteger(options.maxConcurrentLoads ?? 8, "maxConcurrentLoads", 1, 256);
    this.#allowedSchemes = new Set((options.allowedSchemes ?? ["https:", "http:"]).map((scheme) => scheme.toLowerCase()));
    this.#allowedOrigins = new Set(options.allowedOrigins ?? []);
    this.#allowRelativeUris = options.allowRelativeUris ?? true;
  }

  get size(): number { return this.#assets.size; }
  get activeLoads(): number { return this.#activeLoads; }
  get residentBytes(): number { return this.#residentBytes; }

  advance(tick: number): void {
    this.#tick = r44FiniteInteger(tick, "tick", this.#tick);
    for (const asset of this.#assets.values()) {
      if (asset.state === "ready" || asset.state === "failed" || asset.state === "cancelled") continue;
      if (this.#tick > asset.updatedTick) {
        this.#assets.set(asset.id, { ...asset, updatedTick: this.#tick });
      }
    }
  }

  register(descriptorInput: R44AssetDescriptor, tickInput = this.#tick): R44AssetRecord {
    const tick = r44FiniteInteger(tickInput, "tick", 0);
    const descriptor = this.#normalizeDescriptor(descriptorInput);
    const existing = this.#assets.get(descriptor.id);
    if (existing !== undefined) {
      if (existing.version !== descriptor.version || existing.uri !== descriptor.uri) {
        throw new R44InvariantError("asset-identity-conflict", "Asset id already registered with different identity", {
          id: descriptor.id,
          currentVersion: existing.version,
          incomingVersion: descriptor.version,
        });
      }
      return this.#publicRecord(existing);
    }
    if (this.#assets.size >= this.#maxAssets) throw new R44BoundaryError("asset-capacity", "Asset registry capacity exceeded");
    const dependencyIds = Object.freeze((descriptor.dependencies ?? []).map((id) => r44NormalizeId(id, "dependency id", 160)));
    for (const dependency of dependencyIds) {
      if (dependency === descriptor.id) throw new R44BoundaryError("asset-self-dependency", "Asset cannot depend on itself");
    }
    const record: R44AssetInternal = {
      id: descriptor.id,
      uri: descriptor.uri,
      version: descriptor.version,
      state: "registered",
      critical: descriptor.critical ?? false,
      priority: descriptor.priority ?? 50,
      estimatedBytes: descriptor.estimatedBytes,
      actualBytes: 0,
      fingerprint: null,
      registeredTick: tick,
      updatedTick: tick,
      failureCode: null,
      failureMessage: null,
      dependants: Object.freeze([]),
      descriptor: Object.freeze({ ...descriptor, dependencies: dependencyIds }),
      dependencyIds,
      payload: null,
      loadPromise: null,
      controller: null,
    };
    this.#assets.set(record.id, record);
    try {
      this.#assertNoDependencyCycle(record.id);
    } catch (error) {
      this.#assets.delete(record.id);
      throw error;
    }
    for (const dependency of dependencyIds) {
      const parent = this.#assets.get(dependency);
      if (parent !== undefined) {
        this.#assets.set(dependency, { ...parent, dependants: Object.freeze([...parent.dependants, record.id]) });
      }
    }
    return this.#publicRecord(record);
  }

  get(idInput: string): R44AssetRecord | null {
    const id = r44NormalizeId(idInput, "asset id", 160);
    const asset = this.#assets.get(id);
    return asset === undefined ? null : this.#publicRecord(asset);
  }

  async load(idInput: string, loader: R44AssetLoader, options: { tick?: number; signal?: AbortSignal } = {}): Promise<R44AssetLoadResult> {
    const id = r44NormalizeId(idInput, "asset id", 160);
    const asset = this.#assets.get(id);
    if (asset === undefined) throw new R44BoundaryError("asset-not-registered", "Asset is not registered: " + id);
    if (asset.state === "ready") return this.#result(asset);
    if (asset.loadPromise !== null) return asset.loadPromise;
    if (this.#activeLoads >= this.#maxConcurrentLoads) {
      this.#setState(asset, "queued", options.tick ?? this.#tick);
      throw new R44BoundaryError("asset-load-capacity", "Concurrent asset load capacity exceeded");
    }
    const tick = r44FiniteInteger(options.tick ?? this.#tick, "tick", 0);
    this.#assertDependenciesReady(asset);
    this.#activeLoads += 1;
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) forwardAbort();
    else options.signal?.addEventListener("abort", forwardAbort, { once: true });
    const loading: R44AssetInternal = {
      ...asset,
      state: "loading",
      updatedTick: tick,
      controller,
      loadPromise: Promise.resolve({ id, state: "cancelled", fingerprint: null, byteLength: 0, failureCode: null }),
    };
    const promise = this.#performLoad(loading, loader, controller.signal, tick)
      .finally(() => {
        this.#activeLoads = Math.max(0, this.#activeLoads - 1);
        options.signal?.removeEventListener("abort", forwardAbort);
        const latest = this.#assets.get(id);
        if (latest !== undefined) this.#assets.set(id, { ...latest, loadPromise: null, controller: null });
      });
    this.#assets.set(id, { ...loading, loadPromise: promise });
    return promise;
  }

  async cancel(idInput: string, tickInput = this.#tick): Promise<boolean> {
    const id = r44NormalizeId(idInput, "asset id", 160);
    const asset = this.#assets.get(id);
    if (asset === undefined) return false;
    const tick = r44FiniteInteger(tickInput, "tick", 0);
    if (asset.state === "ready" || asset.state === "evicted" || asset.state === "failed" || asset.state === "cancelled") return false;
    asset.controller?.abort("cancelled");
    this.#releasePayload(asset);
    this.#assets.set(id, { ...asset, state: "cancelled", updatedTick: tick, failureCode: "cancelled", failureMessage: "Asset load cancelled", payload: null, actualBytes: 0 });
    return true;
  }

  evict(idInput: string, options: { force?: boolean; tick?: number } = {}): boolean {
    const id = r44NormalizeId(idInput, "asset id", 160);
    const asset = this.#assets.get(id);
    if (asset === undefined || asset.state === "evicted") return false;
    if (asset.critical && !options.force) return false;
    if (asset.state === "loading") {
      asset.controller?.abort("evicted");
    }
    this.#releasePayload(asset);
    const tick = r44FiniteInteger(options.tick ?? this.#tick, "tick", 0);
    this.#assets.set(id, { ...asset, state: "evicted", updatedTick: tick, payload: null, actualBytes: 0, loadPromise: null, controller: null });
    return true;
  }

  readyPayload(idInput: string): R44AssetPayload | null {
    const id = r44NormalizeId(idInput, "asset id", 160);
    const asset = this.#assets.get(id);
    if (asset === undefined || asset.state !== "ready" || asset.payload === null) return null;
    return Object.freeze({ ...asset.payload, bytes: asset.payload.bytes.slice() });
  }

  records(): readonly R44AssetRecord[] {
    return Object.freeze([...this.#assets.values()].map((asset) => this.#publicRecord(asset)));
  }

  snapshot(): Readonly<Record<string, R44JsonValue>> {
    const stateCounts: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const asset of this.#assets.values()) stateCounts[asset.state] = (stateCounts[asset.state] ?? 0) + 1;
    return Object.freeze({
      tick: this.#tick,
      assetCount: this.#assets.size,
      activeLoads: this.#activeLoads,
      residentBytes: this.#residentBytes,
      maxResidentBytes: this.#maxResidentBytes,
      stateCounts,
      criticalFailures: [...this.#assets.values()].filter((asset) => asset.critical && asset.state === "failed").map((asset) => asset.id),
    });
  }

  #normalizeDescriptor(input: R44AssetDescriptor): R44AssetDescriptor {
    const id = r44NormalizeId(input.id, "asset id", 160);
    const uri = this.#validateUri(input.uri);
    const version = r44NormalizeId(input.version, "asset version", 96);
    const contentType = r44NormalizeLabel(input.contentType.toLowerCase(), 128);
    const estimatedBytes = r44FiniteInteger(input.estimatedBytes, "estimatedBytes", 0, this.#maxAssetBytes);
    const priority = r44FiniteInteger(input.priority ?? 50, "priority", 0, 100);
    const dependencies = Object.freeze([...(input.dependencies ?? [])].map((id) => r44NormalizeId(id, "dependency id", 160)));
    return Object.freeze({
      ...input,
      id,
      uri,
      version,
      contentType,
      estimatedBytes,
      priority,
      dependencies,
      critical: input.critical ?? false,
      metadata: Object.freeze({ ...(input.metadata ?? {}) }),
    });
  }

  #validateUri(input: string): string {
    const uri = r44NormalizeId(input, "asset URI", 2048);
    if (/[\u0000-\u001f\u007f]/u.test(uri) || uri.includes("\\")) {
      throw new R44BoundaryError("asset-uri-invalid", "Asset URI contains forbidden characters");
    }
    if (/%2e%2e/iu.test(uri) || /(^|\/)\.\.(\/|$)/u.test(uri)) {
      throw new R44BoundaryError("asset-uri-traversal", "Asset URI traversal is forbidden");
    }
    if (/^data:/iu.test(uri) || /^javascript:/iu.test(uri) || /^file:/iu.test(uri)) {
      throw new R44BoundaryError("asset-uri-scheme", "Asset URI scheme is not permitted");
    }
    let parsed: URL | null = null;
    try { parsed = new URL(uri); } catch { parsed = null; }
    if (parsed === null) {
      if (!this.#allowRelativeUris || uri.startsWith("//")) {
        throw new R44BoundaryError("asset-uri-relative", "Relative asset URI is not permitted");
      }
      return uri;
    }
    if (!this.#allowedSchemes.has(parsed.protocol.toLowerCase())) {
      throw new R44BoundaryError("asset-uri-scheme", "Asset URI scheme is not allowlisted");
    }
    if (this.#allowedOrigins.size > 0 && !this.#allowedOrigins.has(parsed.origin)) {
      throw new R44BoundaryError("asset-uri-origin", "Asset URI origin is not allowlisted");
    }
    return parsed.toString();
  }

  #assertNoDependencyCycle(startId: string): void {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new R44BoundaryError("asset-dependency-cycle", "Asset dependency cycle detected at " + id);
      if (visited.has(id)) return;
      visiting.add(id);
      const asset = this.#assets.get(id);
      for (const dependency of asset?.dependencyIds ?? []) {
        if (this.#assets.has(dependency)) visit(dependency);
      }
      visiting.delete(id);
      visited.add(id);
    };
    visit(startId);
  }

  #assertDependenciesReady(asset: R44AssetInternal): void {
    for (const dependencyId of asset.dependencyIds) {
      const dependency = this.#assets.get(dependencyId);
      if (dependency === undefined || dependency.state !== "ready") {
        throw new R44BoundaryError("asset-dependency-not-ready", "Dependency is not ready: " + dependencyId);
      }
    }
  }

  async #performLoad(asset: R44AssetInternal, loader: R44AssetLoader, signal: AbortSignal, tick: number): Promise<R44AssetLoadResult> {
    try {
      const payload = await loader.load(asset.descriptor, signal);
      if (signal.aborted) {
        const latest = this.#assets.get(asset.id) ?? asset;
        if (latest.state !== "evicted") this.#setState(latest, "cancelled", tick, "cancelled", "Asset load cancelled");
        return this.#result(this.#assets.get(asset.id) ?? latest);
      }
      const validating = this.#assets.get(asset.id) ?? asset;
      this.#assets.set(asset.id, { ...validating, state: "validating", updatedTick: tick });
      if (!(payload.bytes instanceof Uint8Array)) throw new R44BoundaryError("asset-payload-type", "Loader must return Uint8Array bytes");
      if (payload.bytes.byteLength > this.#maxAssetBytes) throw new R44BoundaryError("asset-too-large", "Loaded asset exceeds size limit");
      if (payload.contentType.toLowerCase() !== asset.descriptor.contentType.toLowerCase()) {
        throw new R44BoundaryError("asset-content-type", "Loaded content type does not match descriptor");
      }
      if (this.#residentBytes + payload.bytes.byteLength > this.#maxResidentBytes) {
        throw new R44BoundaryError("asset-memory-budget", "Resident asset byte budget exceeded");
      }
      const digest = r44FingerprintBytes(payload.bytes);
      if (asset.descriptor.expectedFingerprint !== undefined && asset.descriptor.expectedFingerprint !== digest.fingerprint) {
        throw new R44BoundaryError("asset-integrity", "Loaded asset fingerprint does not match expected value");
      }
      if (payload.reportedFingerprint !== undefined && payload.reportedFingerprint !== digest.fingerprint) {
        throw new R44BoundaryError("asset-reported-integrity", "Loader-reported fingerprint mismatch");
      }
      const current = this.#assets.get(asset.id) ?? asset;
      this.#residentBytes += payload.bytes.byteLength;
      const ready: R44AssetInternal = {
        ...current,
        state: "ready",
        updatedTick: tick,
        actualBytes: payload.bytes.byteLength,
        fingerprint: digest.fingerprint,
        payload: Object.freeze({ ...payload, bytes: payload.bytes.slice() }),
        failureCode: null,
        failureMessage: null,
        loadPromise: current.loadPromise,
      };
      this.#assets.set(asset.id, ready);
      return this.#result(ready);
    } catch (error) {
      const failure = r44ToFailure(error, "asset-load-failed");
      const current = this.#assets.get(asset.id) ?? asset;
      if (signal.aborted) {
        if (current.state === "evicted") return this.#result(current);
        const cancelled: R44AssetInternal = { ...current, state: "cancelled", updatedTick: tick, failureCode: "cancelled", failureMessage: "Asset load cancelled", payload: null, actualBytes: 0 };
        this.#assets.set(asset.id, cancelled);
        return this.#result(cancelled);
      }
      const failed: R44AssetInternal = {
        ...current,
        state: "failed",
        updatedTick: tick,
        failureCode: failure.code,
        failureMessage: failure.message,
        payload: null,
        actualBytes: 0,
      };
      this.#assets.set(asset.id, failed);
      return this.#result(failed);
    }
  }

  #setState(asset: R44AssetInternal, state: R44AssetState, tick: number, code: string | null = null, message: string | null = null): void {
    this.#assets.set(asset.id, { ...asset, state, updatedTick: tick, failureCode: code, failureMessage: message });
  }

  #releasePayload(asset: R44AssetInternal): void {
    if (asset.actualBytes > 0 && asset.payload !== null) {
      this.#residentBytes = Math.max(0, this.#residentBytes - asset.actualBytes);
    }
  }

  #result(asset: R44AssetInternal): R44AssetLoadResult {
    return Object.freeze({
      id: asset.id,
      state: asset.state === "ready" ? "ready" : asset.state === "cancelled" ? "cancelled" : "failed",
      fingerprint: asset.fingerprint,
      byteLength: asset.actualBytes,
      failureCode: asset.failureCode,
    });
  }

  #publicRecord(asset: R44AssetInternal): R44AssetRecord {
    return Object.freeze({
      id: asset.id,
      uri: asset.uri,
      version: asset.version,
      state: asset.state,
      critical: asset.critical,
      priority: asset.priority,
      estimatedBytes: asset.estimatedBytes,
      actualBytes: asset.actualBytes,
      fingerprint: asset.fingerprint,
      registeredTick: asset.registeredTick,
      updatedTick: asset.updatedTick,
      failureCode: asset.failureCode,
      failureMessage: asset.failureMessage,
      dependants: asset.dependants,
    });
  }
}
