import { clamp, integer, stableSort, type Disposable, type Vec3 } from './primitives.js';

export interface NavigationGrid { readonly width: number; readonly height: number; readonly cellSize: number; readonly walkable: (x: number, z: number) => boolean; readonly cost?: (x: number, z: number) => number; }
export interface NavNode { readonly x: number; readonly z: number; readonly g: number; readonly h: number; readonly f: number; readonly parent: string | null; }
export interface NavPath { readonly points: readonly Vec3[]; readonly cost: number; readonly nodesExpanded: number; readonly complete: boolean; }
export interface NavigationStats { readonly queries: number; readonly failures: number; readonly nodesExpanded: number; readonly maxNodes: number; }

function key(x: number, z: number): string { return `${x}:${z}`; }
function heuristic(ax: number, az: number, bx: number, bz: number): number { return Math.abs(ax - bx) + Math.abs(az - bz); }

export class BoundedNavigationRuntime implements Disposable {
  readonly grid: NavigationGrid; readonly maxNodes: number; readonly maxPathLength: number; #queries = 0; #failures = 0; #expanded = 0; #disposed = false;
  constructor(grid: NavigationGrid, maxNodes = 4096, maxPathLength = 1024) { this.grid = grid; this.maxNodes = clamp(integer(maxNodes), 32, 100_000); this.maxPathLength = clamp(integer(maxPathLength), 4, 8192); }
  findPath(start: Vec3, goal: Vec3): NavPath {
    if (this.#disposed) return Object.freeze({ points: [], cost: 0, nodesExpanded: 0, complete: false }); this.#queries += 1; const sx = Math.floor(start.x / this.grid.cellSize); const sz = Math.floor(start.z / this.grid.cellSize); const gx = Math.floor(goal.x / this.grid.cellSize); const gz = Math.floor(goal.z / this.grid.cellSize); if (!this.#valid(sx, sz) || !this.#valid(gx, gz)) { this.#failures += 1; return Object.freeze({ points: [], cost: 0, nodesExpanded: 0, complete: false }); }
    const open = new Map<string, NavNode>(); const closed = new Set<string>(); open.set(key(sx, sz), { x: sx, z: sz, g: 0, h: heuristic(sx, sz, gx, gz), f: heuristic(sx, sz, gx, gz), parent: null }); let expanded = 0;
    while (open.size && expanded < this.maxNodes) {
      const current = stableSort([...open.values()], (a, b) => a.f - b.f || a.h - b.h || a.x - b.x || a.z - b.z)[0]!; open.delete(key(current.x, current.z)); const currentKey = key(current.x, current.z); if (closed.has(currentKey)) continue; closed.add(currentKey); expanded += 1; this.#expanded += 1;
      if (current.x === gx && current.z === gz) { const points: Vec3[] = [Object.freeze({ x: goal.x, y: goal.y, z: goal.z })]; let node: NavNode = current; let pathCount = 0; while (node.parent && pathCount < this.maxPathLength) { const parent = [...closed].find((candidate) => candidate === node.parent); if (!parent) break; const [px, pz] = parent.split(':').map(Number); points.push(Object.freeze({ x: (px + .5) * this.grid.cellSize, y: start.y, z: (pz + .5) * this.grid.cellSize })); const encoded = open.get(parent); if (encoded) node = encoded; else { const [cx, cz] = parent.split(':').map(Number); node = { x: cx, z: cz, g: 0, h: 0, f: 0, parent: null }; } pathCount += 1; } points.push(Object.freeze({ x: start.x, y: start.y, z: start.z })); points.reverse(); return Object.freeze({ points: Object.freeze(points), cost: current.g, nodesExpanded: expanded, complete: true }); }
      const neighbors = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]] as const;
      for (const [dx, dz] of neighbors) { const nx = current.x + dx; const nz = current.z + dz; if (!this.#valid(nx, nz)) continue; const neighborKey = key(nx, nz); if (closed.has(neighborKey)) continue; const terrainCost = Math.max(.05, Number(this.grid.cost?.(nx, nz) ?? 1)); const step = (dx !== 0 && dz !== 0 ? 1.41421356237 : 1) * terrainCost; const g = current.g + step; const old = open.get(neighborKey); if (old && g >= old.g) continue; const h = heuristic(nx, nz, gx, gz); open.set(neighborKey, { x: nx, z: nz, g, h, f: g + h, parent: currentKey }); }
    }
    this.#failures += 1; return Object.freeze({ points: [], cost: 0, nodesExpanded: expanded, complete: false });
  }
  stats(): NavigationStats { return Object.freeze({ queries: this.#queries, failures: this.#failures, nodesExpanded: this.#expanded, maxNodes: this.maxNodes }); }
  dispose(): void { this.#disposed = true; }
  #valid(x: number, z: number): boolean { return x >= 0 && z >= 0 && x < this.grid.width && z < this.grid.height && this.grid.walkable(x, z); }
}
