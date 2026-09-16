import type { NavGrid, NavNode, NavPath } from './navigationPlanner.ts';
import { findPath } from './navigationPlanner.ts';

export interface NavCostCell {
  readonly blocked: boolean;
  readonly cost: number;
  readonly height: number;
  readonly slope: number;
  readonly danger: number;
}

export interface WeightedNavGrid extends Omit<NavGrid, 'blocked'> {
  readonly cells: readonly NavCostCell[];
}

export interface PathOptions {
  readonly maxExpanded?: number;
  readonly avoidDanger?: boolean;
  readonly maxSlope?: number;
  readonly maxHeightDelta?: number;
  readonly allowPartial?: boolean;
}

export interface PathResult extends NavPath {
  readonly partial: boolean;
  readonly danger: number;
  readonly distance: number;
}

const index = (width: number, x: number, z: number): number => z * width + x;
const inside = (grid: WeightedNavGrid, x: number, z: number): boolean => x >= 0 && z >= 0 && x < grid.width && z < grid.height;
const key = (x: number, z: number): string => `${x}:${z}`;

const buildBinaryGrid = (grid: WeightedNavGrid): NavGrid => Object.freeze({ width: grid.width, height: grid.height, origin: grid.origin, cellSize: grid.cellSize, blocked: grid.cells.map((cell) => cell.blocked) });

export const findWeightedPath = (grid: WeightedNavGrid, start: NavNode, goal: NavNode, options: PathOptions = {}): PathResult | null => {
  const sx = Math.floor(start.x); const sz = Math.floor(start.z); const gx = Math.floor(goal.x); const gz = Math.floor(goal.z);
  if (!inside(grid, sx, sz) || !inside(grid, gx, gz)) return null;
  const startCell = grid.cells[index(grid.width, sx, sz)]; const goalCell = grid.cells[index(grid.width, gx, gz)];
  if (!startCell || !goalCell || startCell.blocked || goalCell.blocked) return null;
  const binary = buildBinaryGrid(grid);
  const base = findPath(binary, { x: sx, z: sz }, { x: gx, z: gz }, options.maxExpanded ?? 12_000);
  if (!base) return null;
  const maxSlope = options.maxSlope ?? 0.8;
  const maxHeightDelta = options.maxHeightDelta ?? 2.5;
  const cells = base.nodes;
  const filtered: NavNode[] = [];
  let cost = 0; let danger = 0;
  for (let i = 0; i < cells.length; i += 1) {
    const node = cells[i];
    if (!node) continue;
    const current = grid.cells[index(grid.width, node.x, node.z)];
    const previous = i > 0 ? grid.cells[index(grid.width, cells[i - 1]?.x ?? node.x, cells[i - 1]?.z ?? node.z)] : current;
    if (!current || !previous) break;
    const heightDelta = Math.abs(current.height - previous.height);
    if (current.slope > maxSlope || heightDelta > maxHeightDelta) {
      if (!options.allowPartial || filtered.length < 2) return null;
      break;
    }
    filtered.push(node);
    cost += Math.max(0.1, current.cost) + (options.avoidDanger ? current.danger * 4 : 0);
    danger += current.danger;
  }
  if (filtered.length < 2) return null;
  return Object.freeze({
    nodes: filtered,
    cost: Number(cost.toFixed(4)),
    expanded: base.expanded,
    partial: filtered.length !== cells.length,
    danger: Number((danger / filtered.length).toFixed(4)),
    distance: Number((filtered.length - 1).toFixed(3)),
  });
};

export interface FlowFieldCell { readonly x: number; readonly z: number; readonly distance: number; readonly direction: readonly [number, number]; }
export interface FlowField { readonly width: number; readonly height: number; readonly origin: WeightedNavGrid['origin']; readonly cells: readonly (FlowFieldCell | null)[]; }

export const buildFlowField = (grid: WeightedNavGrid, goals: readonly NavNode[], maxDistance = 250): FlowField => {
  const distances = new Map<string, number>();
  const queue: Array<{ x: number; z: number; distance: number }> = [];
  for (const goal of goals) {
    const x = Math.floor(goal.x); const z = Math.floor(goal.z);
    if (!inside(grid, x, z)) continue;
    const cell = grid.cells[index(grid.width, x, z)];
    if (!cell || cell.blocked) continue;
    const nodeKey = key(x, z);
    if (!distances.has(nodeKey)) { distances.set(nodeKey, 0); queue.push({ x, z, distance: 0 }); }
  }
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor++]; if (!current) continue;
    if (current.distance >= maxDistance) continue;
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
      const nx = current.x + dx; const nz = current.z + dz;
      if (!inside(grid, nx, nz)) continue;
      const cell = grid.cells[index(grid.width, nx, nz)]; if (!cell || cell.blocked) continue;
      const nextDistance = current.distance + Math.max(0.1, cell.cost);
      const nextKey = key(nx, nz);
      if (nextDistance < (distances.get(nextKey) ?? Number.POSITIVE_INFINITY)) {
        distances.set(nextKey, nextDistance);
        queue.push({ x: nx, z: nz, distance: nextDistance });
      }
    }
  }
  const cells: Array<FlowFieldCell | null> = [];
  for (let z = 0; z < grid.height; z += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const distance = distances.get(key(x, z));
      if (distance === undefined) { cells.push(null); continue; }
      let best: FlowFieldCell | null = null;
      let bestDistance = distance;
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
        const neighbor = distances.get(key(x + dx, z + dz));
        if (neighbor !== undefined && neighbor < bestDistance) { bestDistance = neighbor; best = Object.freeze({ x, z, distance, direction: [dx, dz] as const }); }
      }
      cells.push(best ?? Object.freeze({ x, z, distance, direction: [0, 0] as const }));
    }
  }
  return Object.freeze({ width: grid.width, height: grid.height, origin: grid.origin, cells });
};

export const sampleFlowDirection = (field: FlowField, x: number, z: number): readonly [number, number] => {
  const ix = Math.max(0, Math.min(field.width - 1, Math.floor(x)));
  const iz = Math.max(0, Math.min(field.height - 1, Math.floor(z)));
  return field.cells[index(field.width, ix, iz)]?.direction ?? [0, 0];
};
