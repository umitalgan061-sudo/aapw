import type {
  RuntimeCommandR31,
  RuntimeCommandResultR31,
  RuntimePriority,
  R31Id,
} from './applicationTypesR31.ts';
import { asR31Id } from './applicationTypesR31.ts';

type Handler<T> = (command: RuntimeCommandR31<T>) => void | Promise<void>;

interface Route {
  readonly kind: string;
  readonly name: string;
  readonly handler: Handler<unknown>;
  readonly priority: RuntimePriority;
}

export interface CommandRouterDiagnosticsR31 {
  readonly accepted: number;
  readonly rejected: number;
  readonly executed: number;
  readonly dropped: number;
  readonly routes: number;
  readonly averageDurationMs: number;
}

const PRIORITY_WEIGHT: Record<RuntimePriority, number> = {
  critical: 5, high: 4, normal: 3, low: 2, background: 1,
};

export class CommandRouterR31 {
  readonly #routes = new Map<string, Route[]>();
  readonly #queue: RuntimeCommandR31[] = [];
  #accepted = 0;
  #rejected = 0;
  #executed = 0;
  #dropped = 0;
  #totalDuration = 0;
  #maxQueue = 1024;

  setMaxQueue(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Queue limit must be >= 1');
    this.#maxQueue = limit;
  }

  register<T>(
    kind: string,
    name: string,
    priority: RuntimePriority,
    handler: Handler<T>,
  ): () => void {
    const routeKey = this.#key(kind, name);
    const routes = this.#routes.get(routeKey) ?? [];
    const route: Route = { kind, name, handler: handler as Handler<unknown>, priority };
    routes.push(route);
    routes.sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]);
    this.#routes.set(routeKey, routes);
    return () => {
      const bucket = this.#routes.get(routeKey);
      if (!bucket) return;
      const index = bucket.indexOf(route);
      if (index >= 0) bucket.splice(index, 1);
      if (bucket.length === 0) this.#routes.delete(routeKey);
    };
  }

  enqueue(command: RuntimeCommandR31): boolean {
    if (this.#queue.length >= this.#maxQueue) {
      this.#rejected++;
      this.#dropped++;
      return false;
    }
    this.#queue.push(command);
    this.#queue.sort((a, b) =>
      PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]
      || a.context.acceptedAt - b.context.acceptedAt
      || String(a.id).localeCompare(String(b.id)),
    );
    this.#accepted++;
    return true;
  }

  async drain(maxCommands: number): Promise<readonly RuntimeCommandResultR31[]> {
    const limit = Math.max(0, Math.floor(maxCommands));
    const results: RuntimeCommandResultR31[] = [];
    for (let index = 0; index < limit && this.#queue.length > 0; index++) {
      const command = this.#queue.shift()!;
      const routes = this.#routes.get(this.#key(command.kind, command.name));
      const start = performance.now();
      if (!routes || routes.length === 0) {
        this.#dropped++;
        results.push(Object.freeze({
          accepted: true,
          executed: false,
          commandId: command.id,
          reason: 'no-route',
          durationMs: performance.now() - start,
        }));
        continue;
      }
      let executed = false;
      let reason: string | undefined;
      for (const route of routes) {
        try {
          await route.handler(command);
          executed = true;
          this.#executed++;
          break;
        } catch {
          reason = 'handler-error';
        }
      }
      const durationMs = performance.now() - start;
      this.#totalDuration += durationMs;
      results.push(Object.freeze({
        accepted: true,
        executed,
        commandId: command.id,
        ...(reason ? { reason } : {}),
        durationMs,
      }));
    }
    return Object.freeze(results);
  }

  createId(seed: string, counter: number): R31Id {
    return asR31Id(`r31.${seed}.${counter.toString(36)}`);
  }

  pending(): number { return this.#queue.length; }

  diagnostics(): CommandRouterDiagnosticsR31 {
    return Object.freeze({
      accepted: this.#accepted,
      rejected: this.#rejected,
      executed: this.#executed,
      dropped: this.#dropped,
      routes: [...this.#routes.values()].reduce((sum, routes) => sum + routes.length, 0),
      averageDurationMs: this.#executed > 0 ? this.#totalDuration / this.#executed : 0,
    });
  }

  dispose(): void {
    this.#queue.length = 0;
    this.#routes.clear();
  }

  #key(kind: string, name: string): string {
    const k = kind.trim();
    const n = name.trim();
    if (!k || !n) throw new Error('Command route kind/name cannot be empty');
    return `${k}::${n}`;
  }
}
