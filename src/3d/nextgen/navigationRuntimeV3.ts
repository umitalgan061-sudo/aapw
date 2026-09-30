/** Hierarchical grid navigation with cached flow fields and bounded search. */

import { clamp, distance3, normalize3, type Vec3 } from './deterministicMath';

export interface NavNode { id: number; x: number; z: number; walkable: boolean; cost: number }
export interface NavGridConfig { width: number; height: number; cellSize: number; maxSearchNodes: number; diagonal: boolean }
export interface NavPath { nodes: number[]; points: Vec3[]; totalCost: number; complete: boolean; expanded: number }
export interface FlowField { targetNode: number; costs: Float32Array; directions: Int8Array; width: number; height: number }

const DIRS_CARDINAL: readonly [number, number][] = [[1,0],[-1,0],[0,1],[0,-1]];
const DIRS_DIAGONAL: readonly [number, number][] = [...DIRS_CARDINAL, [1,1],[1,-1],[-1,1],[-1,-1]];

class MinHeap<T> {
  #items: Array<{ priority: number; value: T }> = [];
  push(value: T, priority: number): void { this.#items.push({ value, priority }); this.bubbleUp(this.#items.length - 1); }
  pop(): T | undefined {
    if (this.#items.length === 0) return undefined;
    const root = this.#items[0]?.value;
    const last = this.#items.pop();
    if (this.#items.length > 0 && last) { this.#items[0] = last; this.bubbleDown(0); }
    return root;
  }
  get size(): number { return this.#items.length; }
  private bubbleUp(index: number): void { while (index > 0) { const parent = Math.floor((index - 1) / 2); if (this.#items[parent]!.priority <= this.#items[index]!.priority) break; [this.#items[parent], this.#items[index]] = [this.#items[index]!, this.#items[parent]!]; index = parent; } }
  private bubbleDown(index: number): void { const length = this.#items.length; while (true) { const left = index * 2 + 1; const right = left + 1; let smallest = index; if (left < length && this.#items[left]!.priority < this.#items[smallest]!.priority) smallest = left; if (right < length && this.#items[right]!.priority < this.#items[smallest]!.priority) smallest = right; if (smallest === index) return; [this.#items[index], this.#items[smallest]] = [this.#items[smallest]!, this.#items[index]!]; index = smallest; } }
}

export class NavigationRuntimeV3 {
  readonly config: NavGridConfig;
  #nodes: NavNode[];
  #flowFields = new Map<number, FlowField>();
  #version = 0;

  constructor(config: NavGridConfig) {
    if (!Number.isInteger(config.width) || !Number.isInteger(config.height) || config.width <= 0 || config.height <= 0) throw new RangeError('grid dimensions must be positive integers');
    if (config.cellSize <= 0) throw new RangeError('cellSize must be > 0');
    this.config = { ...config };
    this.#nodes = Array.from({ length: config.width * config.height }, (_, id) => ({ id, x: id % config.width, z: Math.floor(id / config.width), walkable: true, cost: 1 }));
  }

  get version(): number { return this.#version; }
  get nodeCount(): number { return this.#nodes.length; }

  configureNode(id: number, patch: Partial<Omit<NavNode, 'id'>>): void {
    const node = this.#nodes[id];
    if (!node) throw new Error(`unknown nav node ${id}`);
    node.walkable = patch.walkable ?? node.walkable;
    node.cost = Math.max(0.001, patch.cost ?? node.cost);
    this.#version += 1;
    this.#flowFields.clear();
  }

  worldToNode(position: Vec3): number | null {
    const x = Math.floor(position.x / this.config.cellSize + this.config.width / 2);
    const z = Math.floor(position.z / this.config.cellSize + this.config.height / 2);
    return this.nodeAt(x, z);
  }

  nodeToWorld(id: number, y = 0): Vec3 {
    const node = this.#nodes[id];
    if (!node) throw new Error(`unknown nav node ${id}`);
    return { x: (node.x - this.config.width / 2 + 0.5) * this.config.cellSize, y, z: (node.z - this.config.height / 2 + 0.5) * this.config.cellSize };
  }

  findPath(start: number, goal: number): NavPath {
    if (!this.#nodes[start]?.walkable || !this.#nodes[goal]?.walkable) return { nodes: [], points: [], totalCost: Infinity, complete: false, expanded: 0 };
    const open = new MinHeap<number>();
    const g = new Float64Array(this.#nodes.length); g.fill(Infinity);
    const parent = new Int32Array(this.#nodes.length); parent.fill(-1);
    const closed = new Uint8Array(this.#nodes.length);
    g[start] = 0;
    open.push(start, this.heuristic(start, goal));
    let expanded = 0;
    while (open.size > 0 && expanded < this.config.maxSearchNodes) {
      const current = open.pop();
      if (current === undefined || closed[current]) continue;
      closed[current] = 1; expanded += 1;
      if (current === goal) return this.buildPath(parent, start, goal, g[goal]!, expanded, true);
      for (const neighbor of this.neighbors(current)) {
        if (closed[neighbor]) continue;
        const node = this.#nodes[neighbor]!;
        if (!node.walkable) continue;
        const stepCost = node.cost * (this.isDiagonal(current, neighbor) ? Math.SQRT2 : 1);
        const tentative = g[current]! + stepCost;
        if (tentative >= g[neighbor]!) continue;
        g[neighbor] = tentative; parent[neighbor] = current;
        open.push(neighbor, tentative + this.heuristic(neighbor, goal));
      }
    }
    return this.buildPath(parent, start, goal, g[goal]!, expanded, false);
  }

  buildFlowField(targetNode: number): FlowField {
    const cached = this.#flowFields.get(targetNode);
    if (cached) return this.cloneFlow(cached);
    const costs = new Float32Array(this.#nodes.length); costs.fill(Infinity);
    const directions = new Int8Array(this.#nodes.length); directions.fill(-1);
    const open = new MinHeap<number>();
    costs[targetNode] = 0;
    open.push(targetNode, 0);
    while (open.size > 0) {
      const current = open.pop();
      if (current === undefined) continue;
      for (const neighbor of this.neighbors(current)) {
        const node = this.#nodes[neighbor]!;
        if (!node.walkable) continue;
        const nextCost = costs[current]! + node.cost;
        if (nextCost >= costs[neighbor]!) continue;
        costs[neighbor] = nextCost;
        directions[neighbor] = this.directionIndex(neighbor, current);
        open.push(neighbor, nextCost);
      }
    }
    const field: FlowField = { targetNode, costs, directions, width: this.config.width, height: this.config.height };
    this.#flowFields.set(targetNode, field);
    return this.cloneFlow(field);
  }

  invalidateFlowFields(): void { this.#flowFields.clear(); }
  clearObstacles(): void { for (const node of this.#nodes) { node.walkable = true; node.cost = 1; } this.invalidateFlowFields(); this.#version += 1; }

  private buildPath(parent: Int32Array, start: number, goal: number, totalCost: number, expanded: number, complete: boolean): NavPath {
    if (!complete) return { nodes: [], points: [], totalCost, complete: false, expanded };
    const nodes: number[] = []; let current = goal;
    while (current !== -1) { nodes.push(current); if (current === start) break; current = parent[current]!; }
    nodes.reverse();
    return { nodes, points: nodes.map((id) => this.nodeToWorld(id)), totalCost, complete: nodes[0] === start, expanded };
  }

  private neighbors(id: number): number[] {
    const node = this.#nodes[id]!;
    const dirs = this.config.diagonal ? DIRS_DIAGONAL : DIRS_CARDINAL;
    const result: number[] = [];
    for (const [dx, dz] of dirs) { const candidate = this.nodeAt(node.x + dx, node.z + dz); if (candidate !== null) result.push(candidate); }
    return result;
  }

  private nodeAt(x: number, z: number): number | null { if (x < 0 || z < 0 || x >= this.config.width || z >= this.config.height) return null; return z * this.config.width + x; }
  private heuristic(a: number, b: number): number { const na = this.#nodes[a]!, nb = this.#nodes[b]!; return Math.hypot(na.x - nb.x, na.z - nb.z); }
  private isDiagonal(a: number, b: number): boolean { const na = this.#nodes[a]!, nb = this.#nodes[b]!; return na.x !== nb.x && na.z !== nb.z; }
  private directionIndex(from: number, to: number): number { const a = this.#nodes[from]!, b = this.#nodes[to]!; const dx = clamp(b.x - a.x, -1, 1); const dz = clamp(b.z - a.z, -1, 1); return (dz + 1) * 3 + (dx + 1); }
  private cloneFlow(field: FlowField): FlowField { return { targetNode: field.targetNode, costs: new Float32Array(field.costs), directions: new Int8Array(field.directions), width: field.width, height: field.height }; }
}

export interface NavAgent { position: Vec3; radius: number; maxStepHeight: number }
export function canTraverseSlope(normal: Vec3, maxSlopeDegrees: number): boolean { return normalize3(normal).y >= Math.cos(maxSlopeDegrees * Math.PI / 180); }
export function distanceToPath(position: Vec3, points: readonly Vec3[]): number {
  if (points.length < 2) return points.length === 1 ? distance3(position, points[0]!) : Infinity;
  let minimum = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!; const b = points[i]!;
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const ap = { x: position.x - a.x, y: position.y - a.y, z: position.z - a.z };
    const denom = ab.x ** 2 + ab.y ** 2 + ab.z ** 2;
    const t = denom <= 1e-8 ? 0 : clamp((ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / denom, 0, 1);
    const point = { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
    minimum = Math.min(minimum, distance3(position, point));
  }
  return minimum;
}
