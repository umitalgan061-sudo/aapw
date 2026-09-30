import type { R29LifecycleComponent, R29ServiceState } from './contracts.ts';

export interface R29ServiceDescriptor<T extends R29LifecycleComponent = R29LifecycleComponent> {
  readonly service: T;
  readonly dependencies?: readonly string[];
  readonly eager?: boolean;
}

export class R29ServiceRegistry {
  #services = new Map<string, R29LifecycleComponent>();
  #dependencies = new Map<string, readonly string[]>();
  #started = new Set<string>();
  #disposed = new Set<string>();

  register<T extends R29LifecycleComponent>(descriptor: R29ServiceDescriptor<T>): void {
    const id = descriptor.service.id;
    if (this.#services.has(id)) throw new Error(`R29_SERVICE_DUPLICATE:${id}`);
    this.#services.set(id, descriptor.service);
    this.#dependencies.set(id, Object.freeze([...(descriptor.dependencies ?? [])]));
    if (descriptor.eager) void this.start(id);
  }

  has(id: string): boolean {
    return this.#services.has(id);
  }

  get<T extends R29LifecycleComponent>(id: string): T {
    const service = this.#services.get(id);
    if (!service) throw new Error(`R29_SERVICE_MISSING:${id}`);
    return service as T;
  }

  async start(id?: string): Promise<void> {
    const targets = id ? [id] : [...this.#services.keys()];
    const visiting = new Set<string>();
    for (const target of targets) await this.#startOne(target, visiting);
  }

  async stop(id?: string): Promise<void> {
    const targets = id ? [id] : [...this.#services.keys()].reverse();
    for (const target of targets) {
      if (!this.#started.has(target)) continue;
      await this.#services.get(target)?.stop();
      this.#started.delete(target);
    }
  }

  dispose(): void {
    for (const id of [...this.#services.keys()].reverse()) {
      if (this.#disposed.has(id)) continue;
      this.#services.get(id)?.dispose();
      this.#disposed.add(id);
      this.#started.delete(id);
    }
  }

  state(): readonly R29ServiceState[] {
    return Object.freeze(
      [...this.#services.keys()].sort().map((id) => Object.freeze({
        id,
        started: this.#started.has(id),
        disposed: this.#disposed.has(id),
        dependencies: this.#dependencies.get(id) ?? [],
      })),
    );
  }

  validate(): readonly string[] {
    const failures: string[] = [];
    for (const [id, dependencies] of this.#dependencies) {
      for (const dependency of dependencies) {
        if (!this.#services.has(dependency)) failures.push(`${id}->${dependency}:missing`);
        if (dependency === id) failures.push(`${id}->${dependency}:self-cycle`);
      }
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const walk = (id: string, path: readonly string[]): void => {
      if (visiting.has(id)) {
        failures.push(`cycle:${[...path, id].join('>')}`);
        return;
      }
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dependency of this.#dependencies.get(id) ?? []) walk(dependency, [...path, id]);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of this.#services.keys()) walk(id, []);
    return Object.freeze([...new Set(failures)].sort());
  }

  snapshot(): Readonly<Record<string, R29ServiceState>> {
    return Object.fromEntries(this.state().map((item) => [item.id, item]));
  }

  async #startOne(id: string, visiting: Set<string>): Promise<void> {
    if (this.#started.has(id)) return;
    if (this.#disposed.has(id)) throw new Error(`R29_SERVICE_DISPOSED:${id}`);
    if (visiting.has(id)) throw new Error(`R29_SERVICE_CYCLE:${id}`);
    const service = this.#services.get(id);
    if (!service) throw new Error(`R29_SERVICE_MISSING:${id}`);
    visiting.add(id);
    for (const dependency of this.#dependencies.get(id) ?? []) await this.#startOne(dependency, visiting);
    visiting.delete(id);
    await service.start();
    this.#started.add(id);
  }
}

export function createR29Service<T extends R29LifecycleComponent>(
  id: string,
  start: () => void | Promise<void>,
  stop: () => void | Promise<void>,
  dispose: () => void,
): T {
  return {
    id,
    start,
    stop,
    dispose,
  } as T;
}
