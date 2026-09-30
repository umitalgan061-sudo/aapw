import { EntityId, Vec3, addVec3, clamp, distanceSquared, normalizeVec3, scaleVec3, subtractVec3 } from './types.ts';
import { DeterministicRandomStream } from './deterministicRngV2.ts';

export type ActorKind = 'player' | 'npc' | 'creature' | 'vehicle' | 'prop';
export type ActorMode = 'idle' | 'patrol' | 'alert' | 'combat' | 'flee' | 'dead' | 'disabled';

export interface ActorStats {
  maxHealth: number;
  health: number;
  maxStamina: number;
  stamina: number;
  moveSpeed: number;
  acceleration: number;
  turnRate: number;
  perceptionRadius: number;
  attackRange: number;
  attackCooldown: number;
  attackDamage: number;
}

export interface ActorIntent {
  desiredVelocity: Vec3;
  target?: EntityId;
  mode: ActorMode;
  attack: boolean;
  sprint: boolean;
}

export interface ActorState {
  id: EntityId;
  kind: ActorKind;
  position: Vec3;
  velocity: Vec3;
  forward: Vec3;
  stats: ActorStats;
  intent: ActorIntent;
  mode: ActorMode;
  cooldown: number;
  invulnerability: number;
  lastDamagedTick: number;
  home: Vec3;
  tags: readonly string[];
}

export interface ActorTarget {
  id: EntityId;
  position: Vec3;
  hostile: boolean;
  visible: boolean;
  priority: number;
}

export interface ActorEvent {
  type: 'damaged' | 'attacked' | 'mode-changed' | 'died' | 'stamina-depleted';
  actor: EntityId;
  target?: EntityId;
  amount?: number;
  tick: number;
}

export interface ActorSimulationConfig {
  fixedDeltaSeconds: number;
  staminaRegenPerSecond: number;
  sprintMultiplier: number;
  gravity: number;
  maxVerticalSpeed: number;
  separationRadius: number;
  separationStrength: number;
  targetMemoryTicks: number;
}

const DEFAULT_CONFIG: ActorSimulationConfig = {
  fixedDeltaSeconds: 1 / 60,
  staminaRegenPerSecond: 12,
  sprintMultiplier: 1.45,
  gravity: 24,
  maxVerticalSpeed: 35,
  separationRadius: 1.5,
  separationStrength: 6,
  targetMemoryTicks: 90,
};

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function cloneStats(stats: ActorStats): ActorStats {
  return { ...stats };
}

function cloneIntent(intent: ActorIntent): ActorIntent {
  return {
    desiredVelocity: { ...intent.desiredVelocity },
    target: intent.target,
    mode: intent.mode,
    attack: intent.attack,
    sprint: intent.sprint,
  };
}

function cloneActor(actor: ActorState): ActorState {
  return {
    ...actor,
    position: { ...actor.position },
    velocity: { ...actor.velocity },
    forward: { ...actor.forward },
    stats: cloneStats(actor.stats),
    intent: cloneIntent(actor.intent),
    home: { ...actor.home },
    tags: [...actor.tags],
  };
}

export class ActorSimulationV2 {
  readonly #config: ActorSimulationConfig;
  readonly #actors = new Map<EntityId, ActorState>();
  readonly #events: ActorEvent[] = [];
  readonly #rng: DeterministicRandomStream;
  #tick = 0;

  constructor(seed: number, config: Partial<ActorSimulationConfig> = {}) {
    this.#config = { ...DEFAULT_CONFIG, ...config };
    if (this.#config.fixedDeltaSeconds <= 0) throw new RangeError('fixedDeltaSeconds must be positive');
    this.#rng = new DeterministicRandomStream(seed);
  }

  get tick(): number { return this.#tick; }
  get actorCount(): number { return this.#actors.size; }

  spawn(actor: ActorState): void {
    if (this.#actors.has(actor.id)) throw new Error(`Actor ${Number(actor.id)} already exists`);
    const safe = cloneActor(actor);
    safe.stats.health = clamp(finite(safe.stats.health), 0, Math.max(0, finite(safe.stats.maxHealth)));
    safe.stats.stamina = clamp(finite(safe.stats.stamina), 0, Math.max(0, finite(safe.stats.maxStamina)));
    safe.stats.moveSpeed = Math.max(0, finite(safe.stats.moveSpeed));
    this.#actors.set(actor.id, safe);
  }

  despawn(id: EntityId): boolean {
    return this.#actors.delete(id);
  }

  get(id: EntityId): ActorState | undefined {
    const actor = this.#actors.get(id);
    return actor ? cloneActor(actor) : undefined;
  }

  list(): ActorState[] {
    return [...this.#actors.values()].sort((a, b) => Number(a.id) - Number(b.id)).map(cloneActor);
  }

  setIntent(id: EntityId, intent: Partial<ActorIntent>): boolean {
    const actor = this.#actors.get(id);
    if (!actor || actor.mode === 'dead' || actor.mode === 'disabled') return false;
    if (intent.desiredVelocity) actor.intent.desiredVelocity = { ...intent.desiredVelocity };
    if (intent.target !== undefined) actor.intent.target = intent.target;
    if (intent.mode) actor.intent.mode = intent.mode;
    if (intent.attack !== undefined) actor.intent.attack = intent.attack;
    if (intent.sprint !== undefined) actor.intent.sprint = intent.sprint;
    return true;
  }

  applyDamage(id: EntityId, amount: number, source?: EntityId): number {
    const actor = this.#actors.get(id);
    if (!actor || actor.invulnerability > 0 || actor.mode === 'dead') return 0;
    const damage = clamp(finite(amount), 0, 100000);
    actor.stats.health = clamp(actor.stats.health - damage, 0, actor.stats.maxHealth);
    actor.invulnerability = Math.max(actor.invulnerability, 0.08);
    actor.lastDamagedTick = this.#tick;
    this.#events.push({ type: 'damaged', actor: id, target: source, amount: damage, tick: this.#tick });
    if (actor.stats.health <= 0) {
      actor.mode = 'dead';
      actor.intent.attack = false;
      actor.velocity = { x: 0, y: 0, z: 0 };
      this.#events.push({ type: 'died', actor: id, tick: this.#tick });
    } else if (actor.mode === 'idle' || actor.mode === 'patrol') {
      actor.mode = 'alert';
      this.#events.push({ type: 'mode-changed', actor: id, tick: this.#tick });
    }
    return damage;
  }

  step(targets: readonly ActorTarget[] = []): readonly ActorEvent[] {
    this.#tick += 1;
    this.#events.length = 0;
    const dt = this.#config.fixedDeltaSeconds;
    const ordered = [...this.#actors.values()].sort((a, b) => Number(a.id) - Number(b.id));
    for (const actor of ordered) this.#updateCooldowns(actor, dt);
    for (const actor of ordered) this.#selectTarget(actor, targets);
    for (const actor of ordered) this.#integrate(actor, dt, ordered);
    for (const actor of ordered) this.#resolveAttack(actor, targets);
    return this.events();
  }

  events(): ActorEvent[] {
    return this.#events.map((event) => ({ ...event }));
  }

  snapshot(): ActorState[] { return this.list(); }

  restore(snapshot: readonly ActorState[]): void {
    this.#actors.clear();
    for (const actor of snapshot) this.spawn(actor);
    this.#events.length = 0;
  }

  digest(): number {
    let value = this.#rng.digest() ^ this.#tick;
    for (const actor of this.list()) {
      value = Math.imul(value ^ Number(actor.id), 16777619) >>> 0;
      value = Math.imul(value ^ Math.round(actor.position.x * 1000), 16777619) >>> 0;
      value = Math.imul(value ^ Math.round(actor.position.y * 1000), 16777619) >>> 0;
      value = Math.imul(value ^ Math.round(actor.position.z * 1000), 16777619) >>> 0;
      value = Math.imul(value ^ Math.round(actor.stats.health * 100), 16777619) >>> 0;
      value = Math.imul(value ^ Math.round(actor.stats.stamina * 100), 16777619) >>> 0;
    }
    return value >>> 0;
  }

  #updateCooldowns(actor: ActorState, dt: number): void {
    actor.cooldown = Math.max(0, actor.cooldown - dt);
    actor.invulnerability = Math.max(0, actor.invulnerability - dt);
    if (actor.mode !== 'dead' && actor.mode !== 'disabled') {
      const canRegen = !actor.intent.sprint && !actor.intent.attack;
      if (canRegen) actor.stats.stamina = Math.min(actor.stats.maxStamina, actor.stats.stamina + this.#config.staminaRegenPerSecond * dt);
    }
  }

  #selectTarget(actor: ActorState, targets: readonly ActorTarget[]): void {
    if (actor.mode === 'dead' || actor.mode === 'disabled') return;
    const radiusSquared = actor.stats.perceptionRadius * actor.stats.perceptionRadius;
    const candidates = targets
      .filter((target) => target.id !== actor.id && target.hostile && target.visible)
      .map((target) => ({ target, distance: distanceSquared(actor.position, target.position) }))
      .filter((candidate) => candidate.distance <= radiusSquared)
      .sort((a, b) => (b.target.priority - a.target.priority) || (a.distance - b.distance) || (Number(a.target.id) - Number(b.target.id)));
    const selected = candidates[0]?.target;
    if (selected) {
      actor.intent.target = selected.id;
      if (actor.mode === 'idle' || actor.mode === 'patrol') {
        actor.mode = 'alert';
        this.#events.push({ type: 'mode-changed', actor: actor.id, tick: this.#tick });
      }
    } else if (actor.mode === 'alert' && actor.lastDamagedTick + this.#config.targetMemoryTicks < this.#tick) {
      actor.intent.target = undefined;
      actor.mode = 'patrol';
    }
  }

  #integrate(actor: ActorState, dt: number, ordered: readonly ActorState[]): void {
    if (actor.mode === 'dead' || actor.mode === 'disabled') return;
    let desired = { ...actor.intent.desiredVelocity };
    if (actor.intent.target !== undefined) {
      const target = ordered.find((other) => other.id === actor.intent.target);
      if (target) {
        const delta = subtractVec3(target.position, actor.position);
        const direction = normalizeVec3(delta);
        const horizontal = { x: direction.x, y: 0, z: direction.z };
        desired = scaleVec3(normalizeVec3(horizontal), actor.stats.moveSpeed);
        const distanceToTarget = Math.sqrt(distanceSquared(actor.position, target.position));
        if (distanceToTarget <= actor.stats.attackRange) desired = { x: 0, y: 0, z: 0 };
      }
    }
    desired.y = clamp(desired.y, -this.#config.maxVerticalSpeed, this.#config.maxVerticalSpeed);
    const speedMultiplier = actor.intent.sprint && actor.stats.stamina > 0 ? this.#config.sprintMultiplier : 1;
    if (actor.intent.sprint && speedMultiplier > 1) {
      actor.stats.stamina = Math.max(0, actor.stats.stamina - 18 * dt);
      if (actor.stats.stamina <= 0) this.#events.push({ type: 'stamina-depleted', actor: actor.id, tick: this.#tick });
    }
    desired = scaleVec3(desired, speedMultiplier);
    const separation = this.#separation(actor, ordered);
    desired = addVec3(desired, separation);
    const maxSpeed = actor.stats.moveSpeed * speedMultiplier;
    if (Math.hypot(desired.x, desired.z) > maxSpeed) {
      const normalized = normalizeVec3({ x: desired.x, y: 0, z: desired.z });
      desired.x = normalized.x * maxSpeed;
      desired.z = normalized.z * maxSpeed;
    }
    const acceleration = Math.max(0, actor.stats.acceleration);
    const blend = 1 - Math.exp(-acceleration * dt);
    actor.velocity.x += (desired.x - actor.velocity.x) * blend;
    actor.velocity.z += (desired.z - actor.velocity.z) * blend;
    actor.velocity.y += -this.#config.gravity * dt;
    actor.velocity.y = clamp(actor.velocity.y, -this.#config.maxVerticalSpeed, this.#config.maxVerticalSpeed);
    actor.position.x += actor.velocity.x * dt;
    actor.position.y += actor.velocity.y * dt;
    actor.position.z += actor.velocity.z * dt;
    const horizontal = { x: actor.velocity.x, y: 0, z: actor.velocity.z };
    if (Math.hypot(horizontal.x, horizontal.z) > 0.001) actor.forward = normalizeVec3(horizontal);
    if (actor.mode === 'alert' && !actor.intent.target) actor.mode = 'patrol';
    if (actor.mode === 'patrol' && distanceSquared(actor.position, actor.home) < 1) actor.mode = 'idle';
  }

  #separation(actor: ActorState, ordered: readonly ActorState[]): Vec3 {
    let force = { x: 0, y: 0, z: 0 };
    const radiusSquared = this.#config.separationRadius * this.#config.separationRadius;
    for (const other of ordered) {
      if (other.id === actor.id) continue;
      const dx = actor.position.x - other.position.x;
      const dz = actor.position.z - other.position.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq <= 0 || distanceSq > radiusSquared) continue;
      const strength = this.#config.separationStrength * (1 - Math.sqrt(distanceSq) / this.#config.separationRadius);
      const inverse = 1 / Math.sqrt(distanceSq);
      force.x += dx * inverse * strength;
      force.z += dz * inverse * strength;
    }
    return force;
  }

  #resolveAttack(actor: ActorState, targets: readonly ActorTarget[]): void {
    if (actor.mode === 'dead' || actor.mode === 'disabled' || !actor.intent.attack || actor.cooldown > 0 || actor.intent.target === undefined) return;
    const target = targets.find((candidate) => candidate.id === actor.intent.target && candidate.visible);
    if (!target) return;
    const distance = Math.sqrt(distanceSquared(actor.position, target.position));
    if (distance > actor.stats.attackRange) return;
    actor.cooldown = Math.max(0.01, actor.stats.attackCooldown);
    this.#events.push({ type: 'attacked', actor: actor.id, target: target.id, amount: actor.stats.attackDamage, tick: this.#tick });
  }
}

export function createDefaultActor(
  id: EntityId,
  kind: ActorKind,
  position: Vec3,
  overrides: Partial<ActorStats> = {},
): ActorState {
  const stats: ActorStats = {
    maxHealth: 100,
    health: 100,
    maxStamina: 100,
    stamina: 100,
    moveSpeed: kind === 'vehicle' ? 16 : 4,
    acceleration: kind === 'vehicle' ? 5 : 14,
    turnRate: 8,
    perceptionRadius: kind === 'creature' ? 28 : 20,
    attackRange: kind === 'vehicle' ? 5 : 2.2,
    attackCooldown: kind === 'vehicle' ? 1 : 0.8,
    attackDamage: kind === 'creature' ? 18 : 12,
    ...overrides,
  };
  return {
    id,
    kind,
    position: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: 1 },
    stats,
    intent: { desiredVelocity: { x: 0, y: 0, z: 0 }, mode: 'idle', attack: false, sprint: false },
    mode: 'idle',
    cooldown: 0,
    invulnerability: 0,
    lastDamagedTick: 0,
    home: { ...position },
    tags: [kind],
  };
}
