import type { Disposable, EntityId, Vec3 } from './coreTypes.js';
import { clamp, stableSort } from './coreTypes.js';

export type AiState = 'idle' | 'patrol' | 'investigate' | 'chase' | 'flee' | 'combat' | 'search' | 'disabled';
export type GoalType = 'survive' | 'reach' | 'guard' | 'patrol' | 'follow' | 'investigate' | 'attack';

export interface AiActor {
  readonly id: EntityId;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly health: number;
  readonly awareness: number;
  readonly state: AiState;
  readonly target: EntityId | null;
  readonly home: Vec3;
}

export interface AiTarget {
  readonly id: EntityId;
  readonly position: Vec3;
  readonly threat: number;
  readonly visible: boolean;
  readonly distance: number;
}

export interface AiGoal {
  readonly type: GoalType;
  readonly target?: EntityId;
  readonly position?: Vec3;
  readonly weight: number;
  readonly expiresAtTick: number | null;
}

export interface NavigationGrid {
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  readonly walkable(x: number, y: number): boolean;
  readonly cost(x: number, y: number): number;
}

export interface PathPoint { readonly x: number; readonly z: number; readonly cost: number; }
export interface AiDecision { readonly actor: EntityId; readonly state: AiState; readonly target: EntityId | null; readonly destination: Vec3 | null; readonly score: number; readonly reason: string; }
export interface AiStats { readonly actors: number; readonly decisions: number; readonly paths: number; readonly pathFailures: number; readonly transitions: number; }

const states: readonly AiState[] = ['idle', 'patrol', 'investigate', 'chase', 'flee', 'combat', 'search', 'disabled'];
function distance(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function scoreHealth(health: number): number { return clamp(1 - health / 100, 0, 1); }
function scoreDistance(value: number, max: number): number { return clamp(1 - value / Math.max(1, max), 0, 1); }
function cellKey(x: number, y: number): string { return `${x},${y}`; }
function heuristic(ax: number, ay: number, bx: number, by: number): number { return Math.abs(ax - bx) + Math.abs(ay - by); }

export class NavigationRuntime implements Disposable {
  readonly grid: NavigationGrid;
  #disposed = false;
  #pathQueries = 0;
  #pathFailures = 0;

  constructor(grid: NavigationGrid) { this.grid = grid; }

  findPath(start: Vec3, goal: Vec3, maxNodes = 4096): readonly PathPoint[] {
    if (this.#disposed) return [];
    this.#pathQueries += 1;
    const sx = Math.floor(start.x / this.grid.cellSize);
    const sy = Math.floor(start.z / this.grid.cellSize);
    const gx = Math.floor(goal.x / this.grid.cellSize);
    const gy = Math.floor(goal.z / this.grid.cellSize);
    if (!this.grid.walkable(sx, sy) || !this.grid.walkable(gx, gy)) { this.#pathFailures += 1; return []; }
    const open: Array<{ x: number; y: number; f: number }> = [{ x: sx, y: sy, f: heuristic(sx, sy, gx, gy) }];
    const came = new Map<string, string>();
    const gScore = new Map<string, number>([[cellKey(sx, sy), 0]]);
    const closed = new Set<string>();
    let nodes = 0;
    while (open.length && nodes < maxNodes) {
      open.sort((a, b) => a.f - b.f || a.x - b.x || a.y - b.y);
      const current = open.shift()!;
      const key = cellKey(current.x, current.y);
      if (closed.has(key)) continue;
      closed.add(key); nodes += 1;
      if (current.x === gx && current.y === gy) return Object.freeze(this.#reconstruct(came, current.x, current.y, start, goal));
      const neighbors = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
      for (const [dx, dy] of neighbors) {
        const nx = current.x + dx; const ny = current.y + dy;
        if (!this.grid.walkable(nx, ny)) continue;
        const nkey = cellKey(nx, ny); if (closed.has(nkey)) continue;
        const stepCost = (dx !== 0 && dy !== 0 ? 1.414 : 1) * Math.max(0.1, this.grid.cost(nx, ny));
        const candidate = (gScore.get(key) ?? Number.POSITIVE_INFINITY) + stepCost;
        if (candidate >= (gScore.get(nkey) ?? Number.POSITIVE_INFINITY)) continue;
        came.set(nkey, key); gScore.set(nkey, candidate);
        open.push({ x: nx, y: ny, f: candidate + heuristic(nx, ny, gx, gy) });
      }
    }
    this.#pathFailures += 1;
    return [];
  }

  stats(): Readonly<{ queries: number; failures: number }> { return Object.freeze({ queries: this.#pathQueries, failures: this.#pathFailures }); }
  dispose(): void { this.#disposed = true; }

  #reconstruct(came: Map<string, string>, x: number, y: number, start: Vec3, goal: Vec3): PathPoint[] {
    const path: PathPoint[] = [{ x: goal.x, z: goal.z, cost: 0 }];
    let key = cellKey(x, y);
    while (came.has(key)) {
      const [cx, cy] = key.split(',').map(Number);
      const previous = came.get(key)!;
      const [px, py] = previous.split(',').map(Number);
      path.push({ x: (cx + 0.5) * this.grid.cellSize, z: (cy + 0.5) * this.grid.cellSize, cost: Math.hypot(cx - px, cy - py) });
      key = previous;
      if (path.length > 2048) break;
    }
    path.push({ x: start.x, z: start.z, cost: 0 });
    path.reverse();
    return path;
  }
}

export class AiRuntime implements Disposable {
  #actors = new Map<EntityId, AiActor>();
  #goals = new Map<EntityId, AiGoal[]>();
  #nav: NavigationRuntime;
  #tick = 0;
  #decisions = 0;
  #transitions = 0;
  #disposed = false;

  constructor(nav: NavigationRuntime) { this.#nav = nav; }

  register(actor: AiActor): boolean {
    if (this.#disposed || this.#actors.has(actor.id)) return false;
    this.#actors.set(actor.id, Object.freeze({ ...actor, target: actor.target ?? null }));
    return true;
  }

  setGoals(actor: EntityId, goals: readonly AiGoal[]): boolean {
    if (!this.#actors.has(actor)) return false;
    const normalized = stableSort(goals.filter(goal => Number.isFinite(goal.weight) && goal.weight >= 0), (a, b) => b.weight - a.weight || a.type.localeCompare(b.type));
    this.#goals.set(actor, normalized.slice(0, 32));
    return true;
  }

  decide(actorId: EntityId, targets: readonly AiTarget[]): AiDecision | null {
    const actor = this.#actors.get(actorId);
    if (!actor || actor.state === 'disabled') return null;
    const candidates = targets.filter(target => target.id !== actorId && target.distance >= 0).map(target => ({ target, score: target.threat * 0.5 + (target.visible ? 0.35 : 0) + scoreDistance(target.distance, 60) * 0.35 }));
    candidates.sort((a, b) => b.score - a.score || String(a.target.id).localeCompare(String(b.target.id)));
    const bestTarget = candidates[0];
    const lowHealth = scoreHealth(actor.health);
    let state: AiState = 'idle';
    let reason = 'no-interest';
    let destination: Vec3 | null = null;
    if (lowHealth > 0.8) {
      state = 'flee'; reason = 'critical-health'; destination = actor.home;
    } else if (bestTarget && bestTarget.score > 0.7 && bestTarget.target.visible) {
      state = bestTarget.target.distance < 5 ? 'combat' : 'chase'; reason = 'highest-threat'; destination = bestTarget.target.position;
    } else {
      const goal = this.#goals.get(actorId)?.find(item => item.expiresAtTick === null || item.expiresAtTick >= this.#tick);
      if (goal) {
        state = goal.type === 'patrol' ? 'patrol' : goal.type === 'investigate' ? 'investigate' : 'search';
        reason = `goal:${goal.type}`; destination = goal.position ?? null;
      }
    }
    const nextTarget = bestTarget && (state === 'chase' || state === 'combat') ? bestTarget.target.id : null;
    this.#transitions += state !== actor.state ? 1 : 0;
    this.#decisions += 1;
    this.#actors.set(actorId, Object.freeze({ ...actor, state, target: nextTarget }));
    return Object.freeze({ actor: actorId, state, target: nextTarget, destination: destination ? Object.freeze({ ...destination }) : null, score: bestTarget?.score ?? 0, reason });
  }

  update(tick: number, targetsByActor: ReadonlyMap<EntityId, readonly AiTarget[]>): readonly AiDecision[] {
    if (this.#disposed) return [];
    this.#tick = Math.max(this.#tick, Math.trunc(tick));
    const decisions: AiDecision[] = [];
    for (const actor of stableSort([...this.#actors.values()], (a, b) => String(a.id).localeCompare(String(b.id)))) {
      const decision = this.decide(actor.id, targetsByActor.get(actor.id) ?? []);
      if (decision) decisions.push(decision);
    }
    return Object.freeze(decisions);
  }

  actors(): readonly AiActor[] { return Object.freeze(stableSort([...this.#actors.values()], (a, b) => String(a.id).localeCompare(String(b.id)))); }
  stats(): AiStats { const nav = this.#nav.stats(); return Object.freeze({ actors: this.#actors.size, decisions: this.#decisions, paths: nav.queries, pathFailures: nav.failures, transitions: this.#transitions }); }
  path(actorId: EntityId, destination: Vec3): readonly PathPoint[] { const actor = this.#actors.get(actorId); return actor ? this.#nav.findPath(actor.position, destination) : []; }
  dispose(): void { this.#disposed = true; this.#actors.clear(); this.#goals.clear(); this.#nav.dispose(); }
}

export const aiStateOrder = Object.freeze(states.reduce<Record<string, number>>((acc, state, index) => { acc[state] = index; return acc; }, {}));
