/**
 * AAPW Runtime Topology V18.
 *
 * Dependency-aware service topology for the modern runtime.
 * The topology owns registration, dependency validation, deterministic startup ordering,
 * shutdown ordering, health snapshots and scoped capability lookup.
 *
 * Production TypeScript owner: V18 runtime application spine.
 */

export type RuntimeServiceStateV18 =
  | 'declared'
  | 'starting'
  | 'ready'
  | 'degraded'
  | 'stopping'
  | 'stopped'
  | 'failed';

export type RuntimeServiceScopeV18 =
  | 'singleton'
  | 'session'
  | 'frame';

export type RuntimeCapabilityV18 =
  | 'clock'
  | 'input'
  | 'render'
  | 'world'
  | 'assets'
  | 'persistence'
  | 'telemetry'
  | 'diagnostics'
  | 'network';

export interface RuntimeServiceContextV18 {
  readonly topology: RuntimeTopologyV18;
  readonly serviceId: string;
  readonly signal: AbortSignal;
  readonly now: () => number;
  readonly frame: number;
}

export interface RuntimeServiceDefinitionV18<T = unknown> {
  readonly id: string;
  readonly version: number;
  readonly scope: RuntimeServiceScopeV18;
  readonly capabilities: readonly RuntimeCapabilityV18[];
  readonly dependencies?: readonly string[];
  readonly critical?: boolean;
  readonly value?: T;
  readonly start?: (context: RuntimeServiceContextV18) => void | Promise<void>;
  readonly stop?: (context: RuntimeServiceContextV18) => void | Promise<void>;
  readonly health?: () => RuntimeServiceHealthV18;
}

export interface RuntimeServiceHealthV18 {
  readonly state: RuntimeServiceStateV18;
  readonly score: number;
  readonly message?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface RuntimeServiceSnapshotV18 {
  readonly id: string;
  readonly version: number;
  readonly scope: RuntimeServiceScopeV18;
  readonly state: RuntimeServiceStateV18;
  readonly capabilities: readonly RuntimeCapabilityV18[];
  readonly dependencies: readonly string[];
  readonly critical: boolean;
  readonly startedAtMs: number | null;
  readonly stoppedAtMs: number | null;
  readonly health: RuntimeServiceHealthV18;
}

export interface RuntimeTopologySnapshotV18 {
  readonly state: 'created' | 'starting' | 'ready' | 'degraded' | 'stopping' | 'stopped' | 'failed';
  readonly frame: number;
  readonly revision: number;
  readonly orderedServices: readonly string[];
  readonly services: readonly RuntimeServiceSnapshotV18[];
  readonly capabilityOwners: Readonly<Record<RuntimeCapabilityV18, readonly string[]>>;
  readonly dependencyErrors: readonly string[];
}

interface ServiceRecordV18<T = unknown> {
  readonly definition: RuntimeServiceDefinitionV18<T>;
  state: RuntimeServiceStateV18;
  startedAtMs: number | null;
  stoppedAtMs: number | null;
  health: RuntimeServiceHealthV18;
}

const CAPABILITIES: readonly RuntimeCapabilityV18[] = [
  'clock',
  'input',
  'render',
  'world',
  'assets',
  'persistence',
  'telemetry',
  'diagnostics',
  'network',
];

function normalizeId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function defaultHealth(): RuntimeServiceHealthV18 {
  return Object.freeze({
    state: 'stopped',
    score: 0,
  });
}

function freezeArray<T>(value: readonly T[]): readonly T[] {
  return Object.freeze([...value]);
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return freezeArray(
    [...new Set(values.map(normalizeId).filter(Boolean))].sort(),
  );
}

export class RuntimeTopologyV18 {
  readonly #services = new Map<string, ServiceRecordV18>();
  readonly #controller = new AbortController();
  readonly #clock: () => number;
  readonly #strictCritical = true;
  readonly #capabilityOwners = new Map<RuntimeCapabilityV18, Set<string>>();

  #state: RuntimeTopologySnapshotV18['state'] = 'created';
  #frame = 0;
  #revision = 0;
  #orderedServices: readonly string[] = [];
  #dependencyErrors: readonly string[] = [];

  public constructor(options: { readonly clock?: () => number } = {}) {
    this.#clock = options.clock ?? (() => performance.now());
    for (const capability of CAPABILITIES) {
      this.#capabilityOwners.set(capability, new Set());
    }
  }

  public get signal(): AbortSignal {
    return this.#controller.signal;
  }

  public get state(): RuntimeTopologySnapshotV18['state'] {
    return this.#state;
  }

  public get frame(): number {
    return this.#frame;
  }

  public setFrame(frame: number): void {
    this.#frame = Math.max(0, Math.floor(frame));
  }

  public register<T>(definition: RuntimeServiceDefinitionV18<T>): () => void {
    const id = normalizeId(definition.id);
    if (!id) {
      throw new TypeError('Runtime service id is required.');
    }
    if (this.#services.has(id)) {
      throw new Error(`Runtime service already registered: ${id}`);
    }

    const capabilities = freezeArray(
      definition.capabilities.filter(
        (capability): capability is RuntimeCapabilityV18 =>
          CAPABILITIES.includes(capability),
      ),
    );

    const normalized: RuntimeServiceDefinitionV18<T> = Object.freeze({
      ...definition,
      id,
      version: Math.max(1, Math.floor(definition.version)),
      capabilities,
      dependencies: sortedUnique(definition.dependencies ?? []),
      critical: definition.critical ?? false,
    });

    const record: ServiceRecordV18<T> = {
      definition: normalized,
      state: 'declared',
      startedAtMs: null,
      stoppedAtMs: null,
      health: Object.freeze({
        state: 'declared',
        score: 0,
      }),
    };

    this.#services.set(id, record);

    for (const capability of capabilities) {
      this.#capabilityOwners.get(capability)?.add(id);
    }

    this.#revision += 1;
    this.#rebuildOrder();

    return () => {
      if (this.#services.get(id) !== record) return;
      for (const capability of capabilities) {
        this.#capabilityOwners.get(capability)?.delete(id);
      }
      this.#services.delete(id);
      this.#revision += 1;
      this.#rebuildOrder();
    };
  }

  public resolve<T>(id: string): T {
    const record = this.#services.get(normalizeId(id));
    if (!record) {
      throw new Error(`Runtime service not found: ${id}`);
    }
    return record.definition.value as T;
  }

  public maybeResolve<T>(id: string): T | undefined {
    return this.#services.get(normalizeId(id))?.definition.value as T | undefined;
  }

  public has(id: string): boolean {
    return this.#services.has(normalizeId(id));
  }

  public servicesForCapability(
    capability: RuntimeCapabilityV18,
  ): readonly string[] {
    return freezeArray(
      [...(this.#capabilityOwners.get(capability) ?? new Set())].sort(),
    );
  }

  public validate(): RuntimeTopologySnapshotV18 {
    this.#rebuildOrder();
    const dependencyErrors: string[] = [...this.#dependencyErrors];

    for (const record of this.#services.values()) {
      for (const dependency of record.definition.dependencies ?? []) {
        if (!this.#services.has(dependency)) {
          dependencyErrors.push(
            `${record.definition.id}: missing dependency ${dependency}`,
          );
        }
      }
    }

    const failedCritical = [...this.#services.values()]
      .filter((record) => record.definition.critical && record.state === 'failed')
      .map((record) => record.definition.id);

    if (failedCritical.length > 0) {
      dependencyErrors.push(
        ...failedCritical.map((id) => `${id}: critical service failed`),
      );
    }

    this.#dependencyErrors = freezeArray([...new Set(dependencyErrors)].sort());

    return this.snapshot();
  }

  public async start(): Promise<void> {
    if (this.#state === 'ready' || this.#state === 'degraded') return;
    if (this.#state === 'stopping') {
      throw new Error('Runtime topology is stopping.');
    }
    if (this.#controller.signal.aborted) {
      throw new Error('Runtime topology signal has been aborted.');
    }

    this.#rebuildOrder();
    if (this.#dependencyErrors.length > 0) {
      this.#state = 'failed';
      throw new Error(this.#dependencyErrors.join('; '));
    }

    this.#state = 'starting';
    const now = this.#clock();

    try {
      for (const id of this.#orderedServices) {
        const record = this.#services.get(id);
        if (!record || record.state === 'ready') continue;

        record.state = 'starting';
        record.health = Object.freeze({
          state: 'starting',
          score: 0.5,
        });

        try {
          await record.definition.start?.({
            topology: this,
            serviceId: id,
            signal: this.signal,
            now: this.#clock,
            frame: this.#frame,
          });

          record.state = 'ready';
          record.startedAtMs = now;
          record.health = Object.freeze({
            state: 'ready',
            score: 1,
          });
        } catch (error) {
          record.state = 'failed';
          record.health = Object.freeze({
            state: 'failed',
            score: 0,
            message: error instanceof Error ? error.message : String(error),
          });

          if (record.definition.critical || this.#strictCritical) {
            throw error;
          }

          this.#state = 'degraded';
        }
      }

      this.#refreshHealth();

      if (this.#services.size === 0) {
        this.#state = 'ready';
      } else if (this.#state !== 'degraded') {
        this.#state = 'ready';
      }
    } catch (error) {
      this.#state = 'failed';
      for (const record of this.#services.values()) {
        if (record.state === 'starting') {
          record.state = 'failed';
          record.health = Object.freeze({
            state: 'failed',
            score: 0,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (this.#state === 'stopped' || this.#state === 'created') {
      this.#state = 'stopped';
      return;
    }

    this.#state = 'stopping';
    this.#controller.abort();

    const now = this.#clock();
    for (const id of [...this.#orderedServices].reverse()) {
      const record = this.#services.get(id);
      if (!record || record.state === 'stopped') continue;

      try {
        await record.definition.stop?.({
          topology: this,
          serviceId: id,
          signal: this.signal,
          now: this.#clock,
          frame: this.#frame,
        });
        record.state = 'stopped';
        record.stoppedAtMs = now;
        record.health = Object.freeze({
          state: 'stopped',
          score: 0,
        });
      } catch (error) {
        record.state = 'failed';
        record.health = Object.freeze({
          state: 'failed',
          score: 0,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.#state = [...this.#services.values()].some(
      (record) => record.state === 'failed' && record.definition.critical,
    )
      ? 'failed'
      : 'stopped';
  }

  public refresh(frame?: number): void {
    if (frame !== undefined) this.setFrame(frame);
    this.#refreshHealth();
  }

  public snapshot(): RuntimeTopologySnapshotV18 {
    this.#refreshHealth();

    const owners = {} as Record<RuntimeCapabilityV18, readonly string[]>;
    for (const capability of CAPABILITIES) {
      owners[capability] = this.servicesForCapability(capability);
    }

    const services = [...this.#services.values()]
      .sort((a, b) => a.definition.id.localeCompare(b.definition.id))
      .map((record) =>
        Object.freeze({
          id: record.definition.id,
          version: record.definition.version,
          scope: record.definition.scope,
          state: record.state,
          capabilities: record.definition.capabilities,
          dependencies: record.definition.dependencies ?? [],
          critical: Boolean(record.definition.critical),
          startedAtMs: record.startedAtMs,
          stoppedAtMs: record.stoppedAtMs,
          health: record.health,
        }),
      );

    return Object.freeze({
      state: this.#state,
      frame: this.#frame,
      revision: this.#revision,
      orderedServices: freezeArray(this.#orderedServices),
      services: freezeArray(services),
      capabilityOwners: Object.freeze(owners),
      dependencyErrors: freezeArray(this.#dependencyErrors),
    });
  }

  #refreshHealth(): void {
    let ready = 0;
    let degraded = 0;
    let failedCritical = false;

    for (const record of this.#services.values()) {
      if (record.state === 'ready') ready += 1;
      if (record.state === 'degraded') degraded += 1;
      if (record.state === 'failed' && record.definition.critical) {
        failedCritical = true;
      }

      if (!record.definition.health) continue;

      try {
        const health = record.definition.health();
        const score = clampScore(health.score);
        record.health = Object.freeze({
          ...health,
          score,
          state: record.state,
        });
        if (score < 0.5 && record.state === 'ready') {
          record.state = 'degraded';
        }
      } catch (error) {
        record.state = 'degraded';
        record.health = Object.freeze({
          state: 'degraded',
          score: 0.25,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (failedCritical) {
      this.#state = 'failed';
    } else if (degraded > 0) {
      this.#state = 'degraded';
    } else if (ready === this.#services.size || this.#services.size === 0) {
      if (this.#state !== 'starting' && this.#state !== 'stopping') {
        this.#state = 'ready';
      }
    }
  }

  #rebuildOrder(): void {
    const ids = [...this.#services.keys()].sort();
    const indegree = new Map<string, number>();
    const edges = new Map<string, Set<string>>();
    const errors: string[] = [];

    for (const id of ids) {
      indegree.set(id, 0);
      edges.set(id, new Set());
    }

    for (const id of ids) {
      const record = this.#services.get(id);
      for (const dependency of record?.definition.dependencies ?? []) {
        if (!this.#services.has(dependency)) {
          errors.push(`${id}: missing dependency ${dependency}`);
          continue;
        }

        edges.get(dependency)?.add(id);
        indegree.set(id, (indegree.get(id) ?? 0) + 1);
      }
    }

    const queue = ids.filter((id) => indegree.get(id) === 0).sort();
    const order: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      order.push(current);

      const dependents = [...(edges.get(current) ?? new Set())].sort();
      for (const dependent of dependents) {
        const next = (indegree.get(dependent) ?? 0) - 1;
        indegree.set(dependent, next);
        if (next === 0) {
          queue.push(dependent);
          queue.sort();
        }
      }
    }

    if (order.length !== ids.length) {
      const cycle = ids.filter((id) => !order.includes(id));
      errors.push(`dependency cycle detected: ${cycle.join(', ')}`);
    }

    this.#orderedServices = freezeArray(order);
    this.#dependencyErrors = freezeArray([...new Set(errors)].sort());
  }
}