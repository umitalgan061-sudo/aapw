import type { Disposable, EntityId, Vec3 } from './coreTypes.js';
import { stableSort } from './coreTypes.js';

export interface SimBody { readonly id: EntityId; readonly position: Vec3; readonly velocity: Vec3; readonly mass: number; readonly dynamic: boolean; }
export interface SimConfig { readonly stepSeconds: number; readonly maxCatchUp: number; readonly maxDeltaSeconds: number; readonly gravity: Vec3; }
export interface SimStats { readonly tick: number; readonly steps: number; readonly accumulator: number; readonly bodies: number; readonly contacts: number; readonly droppedSteps: number; }

const DEFAULT_CONFIG: SimConfig = Object.freeze({ stepSeconds: 1 / 60, maxCatchUp: 5, maxDeltaSeconds: 0.25, gravity: { x: 0, y: -20, z: 0 } });
function integrate(body: SimBody, gravity: Vec3, dt: number): SimBody { if (!body.dynamic) return body; const vx = body.velocity.x + gravity.x * dt; const vy = body.velocity.y + gravity.y * dt; const vz = body.velocity.z + gravity.z * dt; return Object.freeze({ ...body, velocity: Object.freeze({ x: vx, y: vy, z: vz }), position: Object.freeze({ x: body.position.x + vx * dt, y: Math.max(0, body.position.y + vy * dt), z: body.position.z + vz * dt }) }); }

export class SimulationRuntime implements Disposable {
  readonly config: SimConfig;
  #bodies = new Map<EntityId, SimBody>();
  #accumulator = 0;
  #tick = 0;
  #steps = 0;
  #contacts = 0;
  #dropped = 0;
  #disposed = false;

  constructor(config: Partial<SimConfig> = {}) { this.config = Object.freeze({ ...DEFAULT_CONFIG, ...config, gravity: Object.freeze({ ...DEFAULT_CONFIG.gravity, ...(config.gravity ?? {}) }) }); }
  add(body: SimBody): boolean { if (this.#disposed || this.#bodies.has(body.id)) return false; this.#bodies.set(body.id, Object.freeze({ ...body, mass: Math.max(0.001, body.mass), position: Object.freeze({ ...body.position }), velocity: Object.freeze({ ...body.velocity }) })); return true; }
  remove(id: EntityId): boolean { return this.#bodies.delete(id); }
  body(id: EntityId): SimBody | undefined { return this.#bodies.get(id); }
  advance(deltaSeconds: number): number { if (this.#disposed) return 0; this.#accumulator += Math.max(0, Math.min(this.config.maxDeltaSeconds, deltaSeconds)); let steps = 0; while (this.#accumulator >= this.config.stepSeconds && steps < this.config.maxCatchUp) { this.#step(); this.#accumulator -= this.config.stepSeconds; steps += 1; } if (this.#accumulator >= this.config.stepSeconds) { this.#dropped += Math.floor(this.#accumulator / this.config.stepSeconds); this.#accumulator %= this.config.stepSeconds; } return steps; }
  interpolationAlpha(): number { return this.config.stepSeconds > 0 ? this.#accumulator / this.config.stepSeconds : 0; }
  bodies(): readonly SimBody[] { return Object.freeze(stableSort([...this.#bodies.values()], (a, b) => String(a.id).localeCompare(String(b.id)))); }
  stats(): SimStats { return Object.freeze({ tick: this.#tick, steps: this.#steps, accumulator: this.#accumulator, bodies: this.#bodies.size, contacts: this.#contacts, droppedSteps: this.#dropped }); }
  dispose(): void { this.#disposed = true; this.#bodies.clear(); }
  #step(): void { this.#tick += 1; this.#steps += 1; for (const [id, body] of this.#bodies) this.#bodies.set(id, integrate(body, this.config.gravity, this.config.stepSeconds)); this.#contacts = 0; const bodies = [...this.#bodies.values()]; for (let i = 0; i < bodies.length; i += 1) for (let j = i + 1; j < bodies.length; j += 1) { const a = bodies[i]!; const b = bodies[j]!; const d = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z); if (d < 1) this.#contacts += 1; } }
}
