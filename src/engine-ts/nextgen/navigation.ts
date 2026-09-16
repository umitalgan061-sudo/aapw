import { Vec2, Vec3, clamp, stableNumber } from './contracts.ts';

export interface NavCell {
  readonly x: number;
  readonly z: number;
  readonly blocked: boolean;
  readonly cost: number;
  readonly elevation: number;
  readonly slope: number;
  readonly danger: number;
}

export interface NavGrid {
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  readonly origin: Vec2;
  readonly cells: readonly NavCell[];
}

export interface NavOptions {
  readonly maxSlope?: number;
  readonly dangerWeight?: number;
  readonly heuristicWeight?: number;
}

export interface PathResult {
  readonly nodes: readonly Vec3[];
  readonly cost: number;
  readonly visited: number;
  readonly complete: boolean;
}

const indexOf = (grid: NavGrid, x: number, z: number): number => z * grid.width + x;
const inside = (grid: NavGrid, x: number, z: number): boolean => x >= 0 && z >= 0 && x < grid.width && z < grid.height;
const cellAt = (grid: NavGrid, x: number, z: number): NavCell | undefined => inside(grid, x, z) ? grid.cells[indexOf(grid, x, z)] : undefined;
const toCell = (grid: NavGrid, position: Vec3): Vec2 => ({ x: Math.round((position.x - grid.origin.x) / grid.cellSize), y: Math.round((position.z - grid.origin.y) / grid.cellSize) });
const toWorld = (grid: NavGrid, cell: Vec2): Vec3 => ({ x: grid.origin.x + cell.x * grid.cellSize, y: cellAt(grid, cell.x, cell.y)?.elevation ?? 0, z: grid.origin.y + cell.y * grid.cellSize });

interface Node { x: number; z: number; g: number; h: number; f: number; parent: Node | null }

export const findPath = (grid: NavGrid, start: Vec3, goal: Vec3, options: NavOptions = {}): PathResult | null => {
  const s = toCell(grid, start);
  const g = toCell(grid, goal);
  const startCell = cellAt(grid, s.x, s.y);
  const goalCell = cellAt(grid, g.x, g.y);
  if (!startCell || !goalCell || startCell.blocked || goalCell.blocked) return null;
  const slopeLimit = Math.max(0, options.maxSlope ?? 0.9);
  const dangerWeight = Math.max(0, options.dangerWeight ?? 1.5);
  const heuristicWeight = Math.max(0.1, options.heuristicWeight ?? 1.1);
  const open: Node[] = [{ x: s.x, z: s.y, g: 0, h: Math.hypot(g.x - s.x, g.y - s.y), f: 0, parent: null }];
  open[0]!.f = open[0]!.g + open[0]!.h * heuristicWeight;
  const best = new Map<string, Node>([[`${s.x}:${s.y}`, open[0]!]]);
  const closed = new Set<string>();
  let visited = 0;
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const;
  while (open.length > 0 && visited < grid.width * grid.height * 4) {
    open.sort((a, b) => a.f - b.f || a.h - b.h || `${a.x}:${a.z}`.localeCompare(`${b.x}:${b.z}`));
    const current = open.shift()!;
    const currentKey = `${current.x}:${current.z}`;
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    visited += 1;
    if (current.x === g.x && current.z === g.y) {
      const nodes: Vec3[] = [];
      let cursor: Node | null = current;
      while (cursor) { nodes.push(toWorld(grid, { x: cursor.x, y: cursor.z })); cursor = cursor.parent; }
      nodes.reverse();
      return Object.freeze({ nodes: Object.freeze(nodes), cost: stableNumber(current.g), visited, complete: true });
    }
    const currentCell = cellAt(grid, current.x, current.z)!;
    for (const [dx, dz] of directions) {
      const nx = current.x + dx;
      const nz = current.z + dz;
      const neighbor = cellAt(grid, nx, nz);
      if (!neighbor || neighbor.blocked || neighbor.slope > slopeLimit) continue;
      const diagonal = dx !== 0 && dz !== 0;
      const slopeDelta = Math.abs(neighbor.elevation - currentCell.elevation) / Math.max(0.01, grid.cellSize);
      if (diagonal && slopeDelta > slopeLimit) continue;
      const key = `${nx}:${nz}`;
      if (closed.has(key)) continue;
      const moveCost = (diagonal ? 1.4142 : 1) * Math.max(0.1, neighbor.cost) * (1 + neighbor.danger * dangerWeight);
      const tentativeG = current.g + moveCost;
      const known = best.get(key);
      if (known && tentativeG >= known.g) continue;
      const h = Math.hypot(g.x - nx, g.y - nz);
      const node: Node = { x: nx, z: nz, g: tentativeG, h, f: tentativeG + h * heuristicWeight, parent: current };
      best.set(key, node);
      open.push(node);
    }
  }
  return Object.freeze({ nodes: Object.freeze([toWorld(grid, s)]), cost: Number.POSITIVE_INFINITY, visited, complete: false });
};

export interface FlowField {
  readonly width: number;
  readonly height: number;
  readonly directions: readonly (Vec2 | null)[];
  readonly costs: readonly number[];
}

export const buildFlowField = (grid: NavGrid, goals: readonly Vec2[], options: NavOptions = {}): FlowField => {
  const costs = Array<number>(grid.width * grid.height).fill(Number.POSITIVE_INFINITY);
  const directions: Array<Vec2 | null> = Array(grid.width * grid.height).fill(null);
  const queue: Vec2[] = [];
  for (const goal of goals) { if (!inside(grid, goal.x, goal.y)) continue; const cell = cellAt(grid, goal.x, goal.y); if (!cell || cell.blocked) continue; costs[indexOf(grid, goal.x, goal.y)] = 0; queue.push(goal); }
  const directions4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const cellPosition = queue[cursor]!;
    const current = cellAt(grid, cellPosition.x, cellPosition.y)!;
    const currentCost = costs[indexOf(grid, cellPosition.x, cellPosition.y)]!;
    for (const [dx, dz] of directions4) {
      const nx = cellPosition.x + dx;
      const nz = cellPosition.y + dz;
      const neighbor = cellAt(grid, nx, nz);
      if (!neighbor || neighbor.blocked || neighbor.slope > Math.max(0, options.maxSlope ?? 0.9)) continue;
      const nextCost = currentCost + Math.max(0.1, neighbor.cost) * (1 + neighbor.danger * Math.max(0, options.dangerWeight ?? 1.5));
      const nextIndex = indexOf(grid, nx, nz);
      if (nextCost >= costs[nextIndex]!) continue;
      costs[nextIndex] = nextCost;
      directions[nextIndex] = { x: cellPosition.x - nx, y: cellPosition.y - nz };
      queue.push({ x: nx, y: nz });
    }
    void current;
  }
  return Object.freeze({ width: grid.width, height: grid.height, directions: Object.freeze(directions), costs: Object.freeze(costs.map((value) => Number.isFinite(value) ? stableNumber(value) : value)) });
};

export const sampleFlowDirection = (field: FlowField, x: number, z: number): Vec2 => {
  const ix = clamp(Math.floor(x), 0, field.width - 1);
  const iz = clamp(Math.floor(z), 0, field.height - 1);
  return field.directions[iz * field.width + ix] ?? { x: 0, y: 0 };
};

export const gridFromFunction = (width: number, height: number, cellSize: number, origin: Vec2, create: (x: number, z: number) => NavCell): NavGrid => {
  const cells: NavCell[] = [];
  for (let z = 0; z < height; z += 1) for (let x = 0; x < width; x += 1) cells.push(Object.freeze(create(x, z)));
  return Object.freeze({ width, height, cellSize, origin, cells: Object.freeze(cells) });
};
