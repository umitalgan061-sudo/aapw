import { Vec3, clamp, distance, normalizeVec3, vec3 } from './types.ts';

export interface GridCell {
  x: number;
  z: number;
  walkable: boolean;
  cost: number;
}

export interface PathNode extends GridCell {
  g: number;
  h: number;
  f: number;
  parent?: string;
}

export interface GridPathfinderConfig {
  width: number;
  height: number;
  cellSize: number;
  maxNodes: number;
}

const DEFAULT_CONFIG: GridPathfinderConfig = { width: 128, height: 128, cellSize: 4, maxNodes: 8192 };

export class DeterministicGridPathfinder {
  readonly #config: GridPathfinderConfig;
  readonly #cells: GridCell[];

  constructor(config: Partial<GridPathfinderConfig> = {}, walkable?: (x: number, z: number) => boolean, cost?: (x: number, z: number) => number) {
    this.#config = { ...DEFAULT_CONFIG, ...config };
    if (this.#config.width < 2 || this.#config.height < 2) throw new RangeError('Pathfinding grid is too small');
    this.#cells = [];
    for (let z = 0; z < this.#config.height; z += 1) {
      for (let x = 0; x < this.#config.width; x += 1) {
        const world = this.cellToWorld(x, z);
        this.#cells.push({ x, z, walkable: walkable ? walkable(world.x, world.z) : true, cost: Math.max(0.01, cost ? cost(world.x, world.z) : 1) });
      }
    }
  }

  cellToWorld(x: number, z: number): Vec3 {
    return vec3((x - this.#config.width / 2 + 0.5) * this.#config.cellSize, 0, (z - this.#config.height / 2 + 0.5) * this.#config.cellSize);
  }

  worldToCell(position: Vec3): { x: number; z: number } {
    const x = Math.floor(position.x / this.#config.cellSize + this.#config.width / 2);
    const z = Math.floor(position.z / this.#config.cellSize + this.#config.height / 2);
    return { x: clamp(x, 0, this.#config.width - 1), z: clamp(z, 0, this.#config.height - 1) };
  }

  findPath(from: Vec3, to: Vec3): Vec3[] {
    const start = this.worldToCell(from);
    const goal = this.worldToCell(to);
    const startKey = key(start.x, start.z);
    const goalKey = key(goal.x, goal.z);
    const open = new Set<string>([startKey]);
    const nodes = new Map<string, PathNode>();
    const startCell = this.cell(start.x, start.z);
    nodes.set(startKey, { ...startCell, g: 0, h: heuristic(start, goal), f: heuristic(start, goal) });
    let visited = 0;
    while (open.size && visited < this.#config.maxNodes) {
      const currentKey = [...open].sort((a, b) => score(nodes.get(a)!) - score(nodes.get(b)!) || a.localeCompare(b))[0];
      const current = nodes.get(currentKey)!;
      visited += 1;
      if (currentKey === goalKey) return reconstruct(nodes, currentKey).map(({ x, z }) => this.cellToWorld(x, z));
      open.delete(currentKey);
      for (const neighbor of this.neighbors(current)) {
        if (!neighbor.walkable) continue;
        const neighborKey = key(neighbor.x, neighbor.z);
        const g = current.g + stepCost(current, neighbor);
        const existing = nodes.get(neighborKey);
        if (existing && g >= existing.g) continue;
        const h = heuristic({ x: neighbor.x, z: neighbor.z }, goal);
        nodes.set(neighborKey, { ...neighbor, g, h, f: g + h, parent: currentKey });
        open.add(neighborKey);
      }
    }
    return [];
  }

  nearestWalkable(position: Vec3, radiusCells = 4): Vec3 | null {
    const center = this.worldToCell(position);
    let best: GridCell | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let dz = -radiusCells; dz <= radiusCells; dz += 1) {
      for (let dx = -radiusCells; dx <= radiusCells; dx += 1) {
        const cell = this.cell(center.x + dx, center.z + dz);
        if (!cell.walkable) continue;
        const world = this.cellToWorld(cell.x, cell.z);
        const d = distance(position, world);
        if (d < bestDistance) { best = cell; bestDistance = d; }
      }
    }
    return best ? this.cellToWorld(best.x, best.z) : null;
  }

  #cellAtIndex(index: number): GridCell { return this.#cells[index]; }
  cell(x: number, z: number): GridCell {
    const cx = clamp(Math.trunc(x), 0, this.#config.width - 1);
    const cz = clamp(Math.trunc(z), 0, this.#config.height - 1);
    return this.#cellAtIndex(cz * this.#config.width + cx);
  }

  neighbors(cell: GridCell): GridCell[] {
    const result: GridCell[] = [];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = cell.x + dx;
      const z = cell.z + dz;
      if (x >= 0 && x < this.#config.width && z >= 0 && z < this.#config.height) result.push(this.cell(x, z));
    }
    return result.sort((a, b) => key(a.x, a.z).localeCompare(key(b.x, b.z)));
  }
}

function key(x: number, z: number): string { return `${x}:${z}`; }
function heuristic(a: { x: number; z: number }, b: { x: number; z: number }): number { return Math.hypot(a.x - b.x, a.z - b.z); }
function stepCost(a: GridCell, b: GridCell): number { return Math.hypot(a.x - b.x, a.z - b.z) * (a.cost + b.cost) * 0.5; }
function score(node: PathNode): number { return node.f; }

function reconstruct(nodes: Map<string, PathNode>, keyValue: string): GridCell[] {
  const path: GridCell[] = [];
  let cursor: string | undefined = keyValue;
  while (cursor) {
    const node = nodes.get(cursor);
    if (!node) break;
    path.push(node);
    cursor = node.parent;
  }
  return path.reverse();
}

export function followPath(position: Vec3, path: readonly Vec3[], speed: number, deltaSeconds: number): Vec3 {
  if (!path.length) return { ...position };
  const target = path[0];
  const direction = normalizeVec3({ x: target.x - position.x, y: target.y - position.y, z: target.z - position.z });
  const travel = Math.max(0, speed) * Math.max(0, deltaSeconds);
  const next = { x: position.x + direction.x * travel, y: position.y + direction.y * travel, z: position.z + direction.z * travel };
  const remaining = Math.hypot(target.x - next.x, target.y - next.y, target.z - next.z);
  return remaining <= travel ? { ...target } : next;
}
