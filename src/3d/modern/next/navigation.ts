import { clamp, distance3, normalize3, type Vec3 } from './math.ts';

export interface NavNode { readonly id: number; readonly position: Vec3; readonly walkable: boolean; readonly cost: number; }
export interface NavEdge { readonly from: number; readonly to: number; readonly cost: number; }
export interface NavPath { readonly found: boolean; readonly nodes: readonly number[]; readonly totalCost: number; explored: number; }

export class NavigationGraph {
  readonly maxNodes: number;
  #nodes = new Map<number, NavNode>();
  #edges = new Map<number, NavEdge[]>();
  constructor(maxNodes = 50_000) { this.maxNodes = Math.max(1, Math.floor(maxNodes)); }
  addNode(node: NavNode): void {
    if (this.#nodes.size >= this.maxNodes && !this.#nodes.has(node.id)) throw new Error('navigation node budget exceeded');
    this.#nodes.set(node.id, { ...node, cost: Math.max(0.001, node.cost) });
    if (!this.#edges.has(node.id)) this.#edges.set(node.id, []);
  }
  removeNode(id: number): boolean {
    if (!this.#nodes.delete(id)) return false;
    this.#edges.delete(id);
    for (const [from, edges] of this.#edges) this.#edges.set(from, edges.filter((edge) => edge.to !== id));
    return true;
  }
  connect(from: number, to: number, cost?: number, bidirectional = true): void {
    if (!this.#nodes.has(from) || !this.#nodes.has(to)) throw new Error('navigation endpoint missing');
    const edge = { from, to, cost: Math.max(0.001, cost ?? distance3(this.#nodes.get(from)!.position, this.#nodes.get(to)!.position)) };
    const list = this.#edges.get(from)!;
    if (!list.some((existing) => existing.to === to)) list.push(edge);
    if (bidirectional) this.connect(to, from, edge.cost, false);
  }
  neighbors(id: number): readonly NavEdge[] { return this.#edges.get(id) ?? []; }
  node(id: number): NavNode | undefined { return this.#nodes.get(id); }

  findPath(start: number, goal: number, options: { maxExplored?: number; heuristicWeight?: number } = {}): NavPath {
    if (!this.#nodes.get(start)?.walkable || !this.#nodes.get(goal)?.walkable) return { found: false, nodes: [], totalCost: Infinity, explored: 0 };
    if (start === goal) return { found: true, nodes: [start], totalCost: 0, explored: 0 };
    const maxExplored = Math.max(1, Math.floor(options.maxExplored ?? 10_000));
    const heuristicWeight = clamp(options.heuristicWeight ?? 1, 0, 2);
    const open = new Set<number>([start]);
    const cameFrom = new Map<number, number>();
    const gScore = new Map<number, number>([[start, 0]]);
    const fScore = new Map<number, number>([[start, this.#heuristic(start, goal) * heuristicWeight]]);
    let explored = 0;
    while (open.size && explored < maxExplored) {
      let current: number | undefined;
      for (const candidate of open) if (current === undefined || (fScore.get(candidate) ?? Infinity) < (fScore.get(current) ?? Infinity) || ((fScore.get(candidate) ?? Infinity) === (fScore.get(current) ?? Infinity) && candidate < current)) current = candidate;
      if (current === undefined) break;
      explored += 1;
      if (current === goal) {
        const nodes: number[] = [goal];
        while (nodes[0] !== start) nodes.unshift(cameFrom.get(nodes[0]!)!);
        return { found: true, nodes, totalCost: gScore.get(goal) ?? Infinity, explored };
      }
      open.delete(current);
      for (const edge of this.neighbors(current)) {
        const node = this.#nodes.get(edge.to);
        if (!node?.walkable) continue;
        const candidate = (gScore.get(current) ?? Infinity) + edge.cost + node.cost;
        if (candidate >= (gScore.get(edge.to) ?? Infinity)) continue;
        cameFrom.set(edge.to, current);
        gScore.set(edge.to, candidate);
        fScore.set(edge.to, candidate + this.#heuristic(edge.to, goal) * heuristicWeight);
        open.add(edge.to);
      }
    }
    return { found: false, nodes: [], totalCost: Infinity, explored };
  }

  #heuristic(from: number, to: number): number { return distance3(this.#nodes.get(from)!.position, this.#nodes.get(to)!.position); }
}

export class GridNavBuilder {
  static build(width: number, depth: number, cellSize: number, walkability: (x: number, z: number) => boolean, terrainCost: (x: number, z: number) => number = () => 1): NavigationGraph {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeDepth = Math.max(1, Math.floor(depth));
    const graph = new NavigationGraph(safeWidth * safeDepth);
    for (let z = 0; z < safeDepth; z += 1) for (let x = 0; x < safeWidth; x += 1) {
      const id = z * safeWidth + x;
      graph.addNode({ id, position: { x: x * cellSize, y: 0, z: z * cellSize }, walkable: walkability(x, z), cost: terrainCost(x, z) });
    }
    for (let z = 0; z < safeDepth; z += 1) for (let x = 0; x < safeWidth; x += 1) {
      const id = z * safeWidth + x;
      if (!graph.node(id)?.walkable) continue;
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]] as const) {
        const nx = x + dx; const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= safeWidth || nz >= safeDepth) continue;
        const target = nz * safeWidth + nx;
        if (!graph.node(target)?.walkable) continue;
        const diagonal = dx !== 0 && dz !== 0;
        graph.connect(id, target, diagonal ? cellSize * 1.41421356237 : cellSize);
      }
    }
    return graph;
  }
}

export function steerTowards(current: Vec3, target: Vec3, maxSpeed: number): Vec3 {
  return { ...normalize3({ x: target.x - current.x, y: target.y - current.y, z: target.z - current.z }), x: normalize3({ x: target.x - current.x, y: target.y - current.y, z: target.z - current.z }).x * maxSpeed, y: 0, z: normalize3({ x: target.x - current.x, y: target.y - current.y, z: target.z - current.z }).z * maxSpeed };
}
