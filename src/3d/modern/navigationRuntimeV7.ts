import { checksumV7, distanceSqV7, type EntityIdV7, entityIdV7, type Vec3V7 } from './runtimeContractsV7';

export interface NavNodeV7 {
  readonly id: string;
  readonly position: Vec3V7;
  readonly neighbors: readonly string[];
  readonly walkable: boolean;
  readonly cost: number;
}

export interface NavPathV7 {
  readonly nodes: readonly string[];
  readonly points: readonly Vec3V7[];
  readonly cost: number;
  readonly complete: boolean;
  readonly expanded: number;
  readonly checksum: string;
}

export interface NavigationOptionsV7 {
  readonly maxNodes?: number;
  readonly maxExpanded?: number;
  readonly maxPathLength?: number;
}

interface OpenNodeV7 {
  readonly id: string;
  readonly g: number;
  readonly f: number;
}

function heuristic(a: Vec3V7, b: Vec3V7): number { return Math.sqrt(distanceSqV7(a, b)); }
function samePoint(a: Vec3V7, b: Vec3V7): boolean { return distanceSqV7(a, b) < 0.0001; }

export class NavigationRuntimeV7 {
  readonly maxNodes: number;
  readonly maxExpanded: number;
  readonly maxPathLength: number;
  #nodes = new Map<string, NavNodeV7>();
  #last: NavPathV7 | null = null;

  constructor(options: NavigationOptionsV7 = {}) {
    this.maxNodes = Math.max(8, Math.trunc(options.maxNodes ?? 8192));
    this.maxExpanded = Math.max(16, Math.trunc(options.maxExpanded ?? 4096));
    this.maxPathLength = Math.max(2, Math.trunc(options.maxPathLength ?? 512));
  }

  register(node: NavNodeV7): void {
    if (!node.id.trim() || !Number.isFinite(node.cost) || node.cost < 0 || !node.walkable) {
      if (!node.walkable) { this.#nodes.set(node.id, Object.freeze({ ...node, neighbors: Object.freeze([...node.neighbors]) })); return; }
      throw new Error('Invalid navigation node');
    }
    if (this.#nodes.size >= this.maxNodes && !this.#nodes.has(node.id)) throw new Error('Navigation node capacity exceeded');
    this.#nodes.set(node.id, Object.freeze({ ...node, neighbors: Object.freeze([...new Set(node.neighbors)].sort()) }));
  }

  registerGrid(width: number, depth: number, spacing = 4): void {
    const w = Math.max(1, Math.trunc(width));
    const d = Math.max(1, Math.trunc(depth));
    for (let z = 0; z < d; z += 1) {
      for (let x = 0; x < w; x += 1) {
        const id = `${x}:${z}`;
        const neighbors = [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]
          .filter(([nx, nz]) => nx >= 0 && nz >= 0 && nx < w && nz < d).map(([nx, nz]) => `${nx}:${nz}`);
        this.register({ id, position: { x: x * spacing, y: 0, z: z * spacing }, neighbors, walkable: true, cost: 1 });
      }
    }
  }

  block(id: string): boolean {
    const node = this.#nodes.get(id);
    if (!node) return false;
    this.#nodes.set(id, Object.freeze({ ...node, walkable: false }));
    return true;
  }

  unblock(id: string): boolean {
    const node = this.#nodes.get(id);
    if (!node) return false;
    this.#nodes.set(id, Object.freeze({ ...node, walkable: true }));
    return true;
  }

  findNearest(position: Vec3V7): NavNodeV7 | null {
    let best: NavNodeV7 | null = null;
    let bestDistance = Infinity;
    for (const node of this.#nodes.values()) {
      if (!node.walkable) continue;
      const distance = distanceSqV7(node.position, position);
      if (distance < bestDistance || (distance === bestDistance && (best === null || node.id < best.id))) { best = node; bestDistance = distance; }
    }
    return best;
  }

  findPath(start: string | Vec3V7, goal: string | Vec3V7): NavPathV7 {
    const startNode = typeof start === 'string' ? this.#nodes.get(start) : this.findNearest(start);
    const goalNode = typeof goal === 'string' ? this.#nodes.get(goal) : this.findNearest(goal);
    if (!startNode || !goalNode || !startNode.walkable || !goalNode.walkable) return this.#empty(false);
    if (startNode.id === goalNode.id) return Object.freeze({ nodes: [startNode.id], points: [startNode.position], cost: 0, complete: true, expanded: 0, checksum: checksumV7({ nodes: [startNode.id], cost: 0 }) });

    const open: OpenNodeV7[] = [{ id: startNode.id, g: 0, f: heuristic(startNode.position, goalNode.position) }];
    const cameFrom = new Map<string, string>();
    const gScore = new Map<string, number>([[startNode.id, 0]]);
    const closed = new Set<string>();
    let expanded = 0;
    while (open.length > 0 && expanded < this.maxExpanded) {
      open.sort((a, b) => a.f - b.f || a.id.localeCompare(b.id));
      const current = open.shift()!;
      if (closed.has(current.id)) continue;
      closed.add(current.id); expanded += 1;
      if (current.id === goalNode.id) {
        const nodes: string[] = [current.id];
        while (cameFrom.has(nodes[0]!)) nodes.unshift(cameFrom.get(nodes[0]!)!);
        const limited = nodes.slice(0, this.maxPathLength);
        const points = limited.map((id) => this.#nodes.get(id)!.position);
        const path = Object.freeze({ nodes: Object.freeze(limited), points: Object.freeze(points), cost: current.g, complete: limited.length === nodes.length, expanded, checksum: checksumV7({ nodes: limited, cost: current.g }) });
        this.#last = path;
        return path;
      }
      const node = this.#nodes.get(current.id)!;
      for (const neighborId of node.neighbors) {
        const neighbor = this.#nodes.get(neighborId);
        if (!neighbor || !neighbor.walkable || closed.has(neighbor.id)) continue;
        const tentative = current.g + Math.max(0.001, neighbor.cost) + heuristic(node.position, neighbor.position) * 0.05;
        if (tentative >= (gScore.get(neighbor.id) ?? Infinity)) continue;
        cameFrom.set(neighbor.id, node.id);
        gScore.set(neighbor.id, tentative);
        open.push({ id: neighbor.id, g: tentative, f: tentative + heuristic(neighbor.position, goalNode.position) });
      }
    }
    return this.#empty(false, expanded);
  }

  smooth(path: NavPathV7, tolerance = 0.25): NavPathV7 {
    if (path.points.length < 3) return path;
    const nodes: string[] = [path.nodes[0]!];
    const points: Vec3V7[] = [path.points[0]!];
    let anchor = 0;
    for (let index = 2; index < path.points.length; index += 1) {
      const previous = path.points[index - 1]!;
      const candidate = path.points[index]!;
      if (Math.abs(candidate.y - previous.y) > tolerance || samePoint(candidate, path.points[anchor]!)) {
        nodes.push(path.nodes[index - 1]!); points.push(previous); anchor = index - 1;
      }
    }
    nodes.push(path.nodes.at(-1)!); points.push(path.points.at(-1)!);
    return Object.freeze({ ...path, nodes: Object.freeze(nodes), points: Object.freeze(points), checksum: checksumV7({ nodes, cost: path.cost }) });
  }

  node(id: string): NavNodeV7 | null { return this.#nodes.get(id) ?? null; }
  nodes(): readonly NavNodeV7[] { return Object.freeze([...this.#nodes.values()].sort((a, b) => a.id.localeCompare(b.id))); }
  lastPath(): NavPathV7 | null { return this.#last; }
  snapshot(): Readonly<{ nodes: readonly NavNodeV7[]; checksum: string }> { const nodes = this.nodes(); return Object.freeze({ nodes, checksum: checksumV7(nodes) }); }
  #empty(complete: boolean, expanded = 0): NavPathV7 { const path = Object.freeze({ nodes: [], points: [], cost: Infinity, complete, expanded, checksum: checksumV7({ nodes: [], complete, expanded }) }); this.#last = path; return path; }
}

export function navigationAgentIdV7(value: number): EntityIdV7 { return entityIdV7(value); }
