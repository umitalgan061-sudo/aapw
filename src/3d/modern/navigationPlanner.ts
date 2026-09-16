import type { Vec2 } from './types';

export interface NavNode { readonly x: number; readonly z: number; }
export interface NavGrid {
  readonly width: number;
  readonly height: number;
  readonly origin: Vec2;
  readonly cellSize: number;
  readonly blocked: readonly boolean[];
}
export interface NavPath {
  readonly nodes: readonly NavNode[];
  readonly cost: number;
  readonly expanded: number;
}

function index(width: number, x: number, z: number): number { return z * width + x; }
function heuristic(ax: number, az: number, bx: number, bz: number): number { return Math.abs(ax - bx) + Math.abs(az - bz); }

/** Bounded A* for gameplay/navigation boundaries. The grid is immutable and iteration is deterministic. */
export function findPath(grid: NavGrid, start: NavNode, goal: NavNode, maxExpanded = 20_000): NavPath | null {
  const sx = Math.floor(start.x), sz = Math.floor(start.z), gx = Math.floor(goal.x), gz = Math.floor(goal.z);
  if (!inside(grid, sx, sz) || !inside(grid, gx, gz)) return null;
  if (grid.blocked[index(grid.width, sx, sz)] || grid.blocked[index(grid.width, gx, gz)]) return null;

  const open: Array<{ x: number; z: number; g: number; f: number }> = [{ x: sx, z: sz, g: 0, f: heuristic(sx, sz, gx, gz) }];
  const cameFrom = new Map<string, string>();
  const cost = new Map<string, number>([[nodeKey(sx, sz), 0]]);
  let expanded = 0;

  while (open.length && expanded < maxExpanded) {
    open.sort((a, b) => a.f - b.f || a.g - b.g || a.x - b.x || a.z - b.z);
    const current = open.shift()!;
    expanded += 1;
    if (current.x === gx && current.z === gz) {
      return { nodes: reconstruct(cameFrom, current, sx, sz), cost: current.g, expanded };
    }
    for (const [dx, dz] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
      const nx = current.x + dx, nz = current.z + dz;
      if (!inside(grid, nx, nz) || grid.blocked[index(grid.width, nx, nz)]) continue;
      const nextKey = nodeKey(nx, nz);
      const tentative = current.g + 1;
      if (tentative >= (cost.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      cameFrom.set(nextKey, nodeKey(current.x, current.z));
      cost.set(nextKey, tentative);
      open.push({ x: nx, z: nz, g: tentative, f: tentative + heuristic(nx, nz, gx, gz) });
    }
  }
  return null;
}

function reconstruct(cameFrom: ReadonlyMap<string, string>, current: { x: number; z: number }, sx: number, sz: number): NavNode[] {
  const nodes: NavNode[] = [{ x: current.x, z: current.z }];
  let key = nodeKey(current.x, current.z);
  while (key !== nodeKey(sx, sz)) {
    const parent = cameFrom.get(key);
    if (!parent) break;
    const [x, z] = parent.split(':').map(Number);
    nodes.push({ x, z });
    key = parent;
  }
  return nodes.reverse();
}

function nodeKey(x: number, z: number): string { return `${x}:${z}`; }
function inside(grid: NavGrid, x: number, z: number): boolean { return x >= 0 && z >= 0 && x < grid.width && z < grid.height; }
