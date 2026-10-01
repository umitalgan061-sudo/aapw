import type { InputFrame, RuntimeCommand, RuntimeEvent, Vec3 } from './types.ts';
import { clamp, finite, vec3 } from './math.ts';

export interface SimulationActor {
  readonly id: string;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly health: number;
  readonly maxHealth: number;
  readonly stamina: number;
  readonly maxStamina: number;
  readonly alive: boolean;
}

export interface SimulationMutableActor extends SimulationActor {
  readonly setPosition: (position: Vec3) => void;
  readonly setVelocity: (velocity: Vec3) => void;
  readonly setHealth: (value: number) => void;
  readonly setStamina: (value: number) => void;
}

export interface SimulationSystemContext {
  readonly tick: number;
  readonly deltaSeconds: number;
  readonly input: InputFrame;
  readonly commands: readonly RuntimeCommand[];
  readonly actors: readonly SimulationMutableActor[];
  readonly emit: (type: string, payload: Readonly<Record<string, unknown>>) => RuntimeEvent;
}

export interface SimulationSystem {
  readonly id: string;
  readonly order: number;
  readonly update: (context: SimulationSystemContext) => void;
}

export class SimulationPipelineR37 {
  #systems: SimulationSystem[] = [];
  #lastDurationMs = 0;
  #executed = 0;

  register(system: SimulationSystem): boolean {
    if (!system.id || this.#systems.some((candidate) => candidate.id === system.id)) return false;
    this.#systems.push(Object.freeze({
      ...system,
      id: system.id.slice(0, 96),
      order: Math.trunc(system.order),
    }));
    this.#systems.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    return true;
  }

  remove(id: string): boolean {
    const before = this.#systems.length;
    this.#systems = this.#systems.filter((system) => system.id !== id);
    return before !== this.#systems.length;
  }

  run(context: SimulationSystemContext): void {
    const started = nowMs();
    this.#executed = 0;
    for (const system of this.#systems) {
      system.update(context);
      this.#executed += 1;
    }
    this.#lastDurationMs = Math.max(0, nowMs() - started);
  }

  systems(): readonly SimulationSystem[] { return Object.freeze([...this.#systems]); }
  executedCount(): number { return this.#executed; }
  lastDurationMs(): number { return this.#lastDurationMs; }
}

export const createMovementSystemR37 = (): SimulationSystem => Object.freeze({
  id: 'movement',
  order: 100,
  update(context) {
    const sprintMultiplier = context.input.sprint ? 1.75 : 1;
    const speed = 4 * sprintMultiplier;
    for (const actor of context.actors) {
      if (!actor.alive) continue;
      const direction = vec3(context.input.move.x, 0, context.input.move.y);
      const targetVelocity = vec3(direction.x * speed, actor.velocity.y, direction.z * speed);
      actor.setVelocity(targetVelocity);
      actor.setPosition(vec3(
        actor.position.x + targetVelocity.x * context.deltaSeconds,
        actor.position.y,
        actor.position.z + targetVelocity.z * context.deltaSeconds,
      ));
    }
  },
});

export const createStaminaSystemR37 = (): SimulationSystem => Object.freeze({
  id: 'stamina',
  order: 200,
  update(context) {
    const drain = context.input.sprint ? 12 : 0;
    const recovery = context.input.sprint ? 0 : 8;
    for (const actor of context.actors) {
      const delta = (recovery - drain) * context.deltaSeconds;
      actor.setStamina(clamp(actor.stamina + delta, 0, actor.maxStamina));
    }
  },
});

export const createCombatSystemR37 = (): SimulationSystem => Object.freeze({
  id: 'combat',
  order: 300,
  update(context) {
    for (const command of context.commands) {
      if (command.kind !== 'attack') continue;
      const targetId = typeof command.payload.targetId === 'string' ? command.payload.targetId : null;
      if (!targetId) continue;
      const target = context.actors.find((actor) => actor.id === targetId);
      if (!target || !target.alive) continue;
      const amount = clamp(finite(command.payload.damage, 10), 1, 1000);
      target.setHealth(clamp(target.health - amount, 0, target.maxHealth));
      context.emit('combat:damage', { targetId, amount, remaining: target.health });
      if (target.health <= 0) context.emit('combat:defeat', { targetId });
    }
  },
});

export const createGravitySystemR37 = (gravity = 9.81): SimulationSystem => Object.freeze({
  id: 'gravity',
  order: 400,
  update(context) {
    const acceleration = Math.max(0, finite(gravity));
    for (const actor of context.actors) {
      if (!actor.alive) continue;
      const nextVelocityY = actor.velocity.y - acceleration * context.deltaSeconds;
      actor.setVelocity(vec3(actor.velocity.x, nextVelocityY, actor.velocity.z));
      actor.setPosition(vec3(actor.position.x, Math.max(0, actor.position.y + nextVelocityY * context.deltaSeconds), actor.position.z));
    }
  },
});
