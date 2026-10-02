export type ModuleState =
  | 'declared'
  | 'initializing'
  | 'ready'
  | 'failed'
  | 'stopped';

export interface RuntimeModule {
  readonly id: string;
  readonly dependencies: readonly string[];
  readonly optional?: boolean;
  readonly init?: () => void | Promise<void>;
  readonly stop?: () => void | Promise<void>;
}

export interface ModuleReport {
  readonly ready: readonly string[];
  readonly failed: readonly string[];
  readonly blocked: readonly string[];
  readonly stopped: readonly string[];
}

export class DeterministicModuleGraph {
  #modules = new Map<
    string,
    RuntimeModule
  >();
  #states = new Map<
    string,
    ModuleState
  >();
  #order: string[] = [];

  register(
    module: RuntimeModule,
  ): () => void {
    if (
      !module.id.trim()
      || this.#modules.has(module.id)
    ) {
      throw new Error(
        'MODULE_DUPLICATE',
      );
    }

    this.#modules.set(
      module.id,
      Object.freeze({
        ...module,
        dependencies:
          Object.freeze([
            ...module.dependencies,
          ].sort()),
      }),
    );
    this.#states.set(
      module.id,
      'declared',
    );

    return () => {
      this.#modules.delete(module.id);
      this.#states.delete(module.id);
      this.#order =
        this.#order.filter(
          value => value !== module.id,
        );
    };
  }

  async initialize(): Promise<ModuleReport> {
    const ready: string[] = [];
    const failed: string[] = [];
    const blocked: string[] = [];
    const remaining =
      new Set(this.#modules.keys());

    let progress = true;

    while (
      remaining.size
      && progress
    ) {
      progress = false;

      for (
        const id of [...remaining].sort()
      ) {
        const module =
          this.#modules.get(id)!;
        const states =
          module.dependencies.map(
            dependency =>
              this.#states.get(
                dependency,
              ),
          );

        if (
          states.some(
            state =>
              state === 'failed',
          )
        ) {
          this.#states.set(
            id,
            'failed',
          );
          failed.push(id);
          remaining.delete(id);
          progress = true;
          continue;
        }

        if (
          states.some(
            state =>
              state !== 'ready',
          )
        ) {
          continue;
        }

        this.#states.set(
          id,
          'initializing',
        );

        try {
          await module.init?.();
          this.#states.set(
            id,
            'ready',
          );
          this.#order.push(id);
          ready.push(id);
        } catch {
          this.#states.set(
            id,
            'failed',
          );
          failed.push(id);
        }

        remaining.delete(id);
        progress = true;
      }
    }

    for (
      const id of remaining
    ) {
      const module =
        this.#modules.get(id)!;

      if (!module.optional) {
        this.#states.set(
          id,
          'failed',
        );
        failed.push(id);
      } else {
        blocked.push(id);
      }
    }

    return Object.freeze({
      ready: Object.freeze(
        [...ready],
      ),
      failed: Object.freeze(
        [...new Set(failed)].sort(),
      ),
      blocked: Object.freeze(
        [...blocked].sort(),
      ),
      stopped: Object.freeze([]),
    });
  }

  async stop(): Promise<ModuleReport> {
    const stopped: string[] = [];

    for (
      const id of [...this.#order].reverse()
    ) {
      const module =
        this.#modules.get(id);

      if (!module) {
        continue;
      }

      try {
        await module.stop?.();
        this.#states.set(
          id,
          'stopped',
        );
        stopped.push(id);
      } catch {
        this.#states.set(
          id,
          'failed',
        );
      }
    }

    const failed =
      [...this.#states.entries()]
        .filter(
          ([, state]) =>
            state === 'failed',
        )
        .map(([id]) => id)
        .sort();

    return Object.freeze({
      ready: Object.freeze([]),
      failed: Object.freeze(failed),
      blocked: Object.freeze([]),
      stopped: Object.freeze(stopped),
    });
  }

  state(id: string):
    ModuleState | null {
    return (
      this.#states.get(id)
      ?? null
    );
  }

  order(): readonly string[] {
    return Object.freeze([
      ...this.#order,
    ]);
  }

  clear(): void {
    this.#modules.clear();
    this.#states.clear();
    this.#order = [];
  }
}
