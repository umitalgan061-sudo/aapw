
import { clamp, fail, ok, stableHash, type R35Id, type R35Result, type R35Vec3 } from './contracts';

export interface NavigationNode {
  readonly id: R35Id;
  readonly position: R35Vec3;
  readonly neighbors: readonly R35Id[];
  readonly cost: number;
  readonly tags: readonly string[];
}

export interface NavigationPath {
  readonly nodes: readonly R35Id[];
  readonly positions: readonly R35Vec3[];
  readonly cost: number;
  readonly digest: string;
}

interface OpenRecord {
  readonly node: R35Id;
  readonly score: number;
}

function heuristic(a: NavigationNode, b: NavigationNode): number {
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  const dz = a.position.z - b.position.z;
  return Math.hypot(dx, dy, dz);
}

export class NavigationRuntimeR35 {
  #nodes = new Map<R35Id, NavigationNode>();
  #blocked = new Set<R35Id>();
  #hazards = new Map<R35Id, number>();
  #maxNodes = 20000;
  #revision = 0;

  register(node: NavigationNode): R35Result<NavigationNode> {
    if (this.#nodes.has(node.id)) {
      return fail('NAV_DUPLICATE', 'Navigation node exists');
    }
    if (!node.id || node.cost <= 0) {
      return fail('NAV_INVALID', 'Navigation node values are invalid');
    }
    if (this.#nodes.size >= this.#maxNodes) {
      return fail('NAV_LIMIT', 'Navigation node limit reached');
    }
    this.#nodes.set(
      node.id,
      Object.freeze({
        ...node,
        cost: clamp(node.cost, 0.01, 1000),
        neighbors: Object.freeze([...node.neighbors]),
        tags: Object.freeze([...node.tags]),
      }),
    );
    return ok(node);
  }

  block(nodeId: R35Id, blocked = true): void {
    if (blocked) this.#blocked.add(nodeId);
    else this.#blocked.delete(nodeId);
    this.#revision += 1;
  }

  setHazard(nodeId: R35Id, value: number): void {
    this.#hazards.set(nodeId, clamp(value, 0, 100));
    this.#revision += 1;
  }

  clearHazards(): void {
    this.#hazards.clear();
    this.#revision += 1;
  }

  findPath(
    startId: R35Id,
    goalId: R35Id,
    options: {
      readonly maxExpanded?: number;
      readonly tagPenalty?: Readonly<Record<string, number>>;
    } = {},
  ): R35Result<NavigationPath> {
    const start = this.#nodes.get(startId);
    const goal = this.#nodes.get(goalId);
    if (!start || !goal) {
      return fail('NAV_ENDPOINT', 'Path endpoint does not exist');
    }
    if (this.#blocked.has(startId) || this.#blocked.has(goalId)) {
      return fail('NAV_BLOCKED', 'Path endpoint is blocked');
    }

    const maxExpanded = clamp(
      Math.trunc(options.maxExpanded ?? 4096),
      1,
      20000,
    );
    const tagPenalty = options.tagPenalty ?? {};

    const open: OpenRecord[] = [
      {
        node: startId,
        score: heuristic(start, goal),
      },
    ];
    const cameFrom = new Map<R35Id, R35Id>();
    const gScore = new Map<R35Id, number>([[startId, 0]]);
    const closed = new Set<R35Id>();
    let expanded = 0;

    while (open.length > 0 && expanded < maxExpanded) {
      open.sort(
        (a, b) =>
          a.score - b.score
          || a.node.localeCompare(b.node),
      );
      const currentRecord = open.shift()!;
      const current = this.#nodes.get(currentRecord.node)!;
      if (current.id === goalId) {
        return ok(this.#reconstruct(cameFrom, current.id, gScore.get(current.id) ?? 0));
      }
      if (closed.has(current.id)) continue;
      closed.add(current.id);
      expanded += 1;

      const neighbors = [...current.neighbors].sort();
      for (const neighborId of neighbors) {
        if (this.#blocked.has(neighborId) || closed.has(neighborId)) {
          continue;
        }
        const neighbor = this.#nodes.get(neighborId);
        if (!neighbor) continue;
        const hazard = this.#hazards.get(neighborId) ?? 0;
        const tagCost = neighbor.tags.reduce(
          (sum, tag) => sum + (tagPenalty[tag] ?? 0),
          0,
        );
        const tentative =
          (gScore.get(current.id) ?? Number.POSITIVE_INFINITY)
          + neighbor.cost
          + hazard
          + tagCost;
        if (tentative >= (gScore.get(neighbor.id) ?? Number.POSITIVE_INFINITY)) {
          continue;
        }
        cameFrom.set(neighbor.id, current.id);
        gScore.set(neighbor.id, tentative);
        open.push({
          node: neighbor.id,
          score: tentative + heuristic(neighbor, goal),
        });
      }
    }
    return fail(
      expanded >= maxExpanded ? 'NAV_BUDGET' : 'NAV_NO_PATH',
      expanded >= maxExpanded
        ? 'Navigation expansion budget exhausted'
        : 'No path exists between endpoints',
      true,
    );
  }

  nearest(
    position: R35Vec3,
    radius: number,
    requiredTags: readonly string[] = [],
  ): readonly NavigationNode[] {
    const safeRadius = clamp(radius, 0, 100000);
    return Object.freeze(
      [...this.#nodes.values()]
        .filter((node) => !this.#blocked.has(node.id))
        .filter((node) =>
          requiredTags.every((tag) => node.tags.includes(tag)),
        )
        .map((node) => ({
          node,
          distance: Math.hypot(
            node.position.x - position.x,
            node.position.y - position.y,
            node.position.z - position.z,
          ),
        }))
        .filter((entry) => entry.distance <= safeRadius)
        .sort(
          (a, b) =>
            a.distance - b.distance
            || a.node.id.localeCompare(b.node.id),
        )
        .map((entry) => entry.node),
    );
  }

  routeDigest(path: NavigationPath): string {
    return stableHash({
      revision: this.#revision,
      nodes: path.nodes,
      cost: path.cost,
    });
  }

  snapshot(): readonly NavigationNode[] {
    return Object.freeze(
      [...this.#nodes.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((node) =>
          Object.freeze({
            ...node,
            blocked: this.#blocked.has(node.id),
            hazard: this.#hazards.get(node.id) ?? 0,
          }),
        ),
    );
  }

  reset(): void {
    this.#nodes.clear();
    this.#blocked.clear();
    this.#hazards.clear();
    this.#revision = 0;
  }

  #reconstruct(
    cameFrom: Map<R35Id, R35Id>,
    goal: R35Id,
    cost: number,
  ): NavigationPath {
    const nodes = [goal];
    let current = goal;
    const guard = new Set<R35Id>();
    while (cameFrom.has(current) && !guard.has(current)) {
      guard.add(current);
      current = cameFrom.get(current)!;
      nodes.push(current);
    }
    nodes.reverse();
    const positions = nodes.map(
      (id) => Object.freeze({ ...this.#nodes.get(id)!.position }),
    );
    return Object.freeze({
      nodes: Object.freeze(nodes),
      positions: Object.freeze(positions),
      cost,
      digest: stableHash({ nodes, positions, cost }),
    });
  }
}
