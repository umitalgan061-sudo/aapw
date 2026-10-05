/**
 * Deterministic gameplay simulation authority for R42.
 * Production TypeScript owner.
 */
import type { ActionCommand, InputFrame, Vec3, WorldEntity } from './types.ts';
import { clamp, finite, normalize2, vec3, cloneEntity, deepFreeze } from './types.ts';
import { EntityWorldR42 } from './world.ts';

export interface SimulationRules {
  readonly gravity: number;
  readonly moveAcceleration: number;
  readonly maxSpeed: number;
  readonly sprintMultiplier: number;
  readonly jumpVelocity: number;
  readonly airControl: number;
  readonly staminaDrainPerSecond: number;
  readonly staminaRecoveryPerSecond: number;
  readonly dodgeSpeed: number;
  readonly dodgeCost: number;
  readonly attackCost: number;
  readonly attackCooldownTicks: number;
}

export const DEFAULT_SIMULATION_RULES: SimulationRules = Object.freeze({
  gravity: 24,
  moveAcceleration: 42,
  maxSpeed: 7,
  sprintMultiplier: 1.65,
  jumpVelocity: 9,
  airControl: 0.35,
  staminaDrainPerSecond: 18,
  staminaRecoveryPerSecond: 12,
  dodgeSpeed: 11,
  dodgeCost: 22,
  attackCost: 10,
  attackCooldownTicks: 18,
});

export interface SimulationResult {
  readonly tick: number;
  readonly updated: number;
  readonly acceptedCommands: number;
  readonly rejectedCommands: number;
  readonly checksum: number;
}

export interface GroundSampler {
  readonly heightAt: (x: number, z: number) => number;
}

export class SimulationAuthorityR42 {
  readonly world: EntityWorldR42;
  readonly rules: SimulationRules;
  readonly ground: GroundSampler;

  #grounded = new Map<string, boolean>();
  #jumpBuffer = new Map<string, number>();

  constructor(
    world: EntityWorldR42,
    rules: Partial<SimulationRules> = {},
    ground: GroundSampler = { heightAt: () => 0 },
  ) {
    this.world = world;
    this.rules = Object.freeze({ ...DEFAULT_SIMULATION_RULES, ...rules });
    this.ground = ground;
  }

  step(
    tick: number,
    inputs: readonly (InputFrame & { readonly entityId?: string })[],
    commands: readonly ActionCommand[],
  ): SimulationResult {
    const inputByEntity = indexInputs(inputs);
    let acceptedCommands = 0;
    let rejectedCommands = 0;

    for (const command of commands) {
      if (command.tick > tick + 1) {
        rejectedCommands += 1;
        continue;
      }
      if (!this.applyCommand(command, tick)) {
        rejectedCommands += 1;
      } else {
        acceptedCommands += 1;
      }
    }

    let updated = 0;
    for (const entity of this.world.values()) {
      const input = inputByEntity.get(entity.id) ?? null;
      const next = this.integrateEntity(entity, input, tick);
      if (!sameEntity(entity, next)) {
        this.world.patch({
          entityId: entity.id,
          revision: entity.revision,
          changes: {
            position: next.transform.position,
            linearVelocity: next.velocity.linear,
            health: next.combat.health,
            stamina: next.combat.stamina,
            guarding: next.combat.guarding,
          },
        });
        updated += 1;
      }
    }

    return deepFreeze({
      tick,
      updated,
      acceptedCommands,
      rejectedCommands,
      checksum: this.world.digest(),
    });
  }

  private applyCommand(command: ActionCommand, tick: number): boolean {
    const entity = this.world.get(command.entityId);
    if (!entity || entity.revision < 0) return false;

    if (command.kind === 'jump') {
      const grounded = this.#grounded.get(command.entityId) ?? this.isGrounded(entity);
      if (!grounded) {
        this.#jumpBuffer.set(command.entityId, tick + 5);
        return false;
      }
      const velocity = { ...entity.velocity.linear, y: this.rules.jumpVelocity };
      this.world.patch({
        entityId: entity.id,
        revision: entity.revision,
        changes: { linearVelocity: velocity },
      });
      this.#grounded.set(command.entityId, false);
      return true;
    }

    if (command.kind === 'attack') {
      if (tick < entity.combat.cooldownUntilTick || entity.combat.stamina < this.rules.attackCost) return false;
      this.world.patch({
        entityId: entity.id,
        revision: entity.revision,
        changes: {
          stamina: entity.combat.stamina - this.rules.attackCost,
        },
      });
      return true;
    }

    if (command.kind === 'dodge') {
      if (entity.combat.stamina < this.rules.dodgeCost) return false;
      const payload = command.payload;
      const direction = normalize2({
        x: typeof payload.x === 'number' ? payload.x : entity.velocity.linear.x,
        y: typeof payload.y === 'number' ? payload.y : entity.velocity.linear.z,
      });
      this.world.patch({
        entityId: entity.id,
        revision: entity.revision,
        changes: {
          linearVelocity: {
            x: direction.x * this.rules.dodgeSpeed,
            y: entity.velocity.linear.y,
            z: direction.y * this.rules.dodgeSpeed,
          },
          stamina: entity.combat.stamina - this.rules.dodgeCost,
        },
      });
      return true;
    }

    if (command.kind === 'guard') {
      this.world.patch({
        entityId: entity.id,
        revision: entity.revision,
        changes: { guarding: !entity.combat.guarding },
      });
      return true;
    }

    return true;
  }

  private integrateEntity(
    entity: WorldEntity,
    input: InputFrame | null,
    tick: number,
  ): WorldEntity {
    const source = input?.move ?? { x: 0, y: 0 };
    const direction = normalize2(source);
    const sprinting = Boolean(input?.sprint) && entity.combat.stamina > 0;
    const control = entity.transform.position.y <= this.ground.heightAt(entity.transform.position.x, entity.transform.position.z) + 0.08
      ? 1
      : this.rules.airControl;
    const targetSpeed = this.rules.maxSpeed * (sprinting ? this.rules.sprintMultiplier : 1);
    const targetX = direction.x * targetSpeed * control;
    const targetZ = direction.y * targetSpeed * control;
    const current = entity.velocity.linear;
    const blend = clamp(this.rules.moveAcceleration / 60, 0, 1);
    const velocity = {
      x: current.x + (targetX - current.x) * blend,
      y: current.y - this.rules.gravity / 60,
      z: current.z + (targetZ - current.z) * blend,
    };

    let position = {
      x: entity.transform.position.x + velocity.x / 60,
      y: entity.transform.position.y + velocity.y / 60,
      z: entity.transform.position.z + velocity.z / 60,
    };

    const ground = finite(this.ground.heightAt(position.x, position.z));
    const wasGrounded = this.#grounded.get(entity.id) ?? entity.transform.position.y <= ground + 0.08;
    if (position.y <= ground) {
      position = { ...position, y: ground };
      velocity.y = wasGrounded ? 0 : Math.max(0, velocity.y);
      this.#grounded.set(entity.id, true);
      const bufferedUntil = this.#jumpBuffer.get(entity.id) ?? -1;
      if (bufferedUntil >= tick && input?.jump) {
        velocity.y = this.rules.jumpVelocity;
        position.y += 0.01;
        this.#grounded.set(entity.id, false);
        this.#jumpBuffer.delete(entity.id);
      }
    } else {
      this.#grounded.set(entity.id, false);
    }

    const stamina = sprinting
      ? clamp(entity.combat.stamina - this.rules.staminaDrainPerSecond / 60, 0, entity.combat.maxStamina)
      : clamp(entity.combat.stamina + this.rules.staminaRecoveryPerSecond / 60, 0, entity.combat.maxStamina);

    return cloneEntity({
      ...entity,
      transform: { ...entity.transform, position: vec3(position.x, position.y, position.z) },
      velocity: { ...entity.velocity, linear: vec3(velocity.x, velocity.y, velocity.z) },
      combat: {
        ...entity.combat,
        stamina,
        guarding: Boolean(input?.guard) ? entity.combat.guarding : entity.combat.guarding,
      },
    });
  }

  private isGrounded(entity: WorldEntity): boolean {
    return entity.transform.position.y <= this.ground.heightAt(entity.transform.position.x, entity.transform.position.z) + 0.08;
  }
}

function indexInputs(inputs: readonly (InputFrame & { readonly entityId?: string })[]): ReadonlyMap<string, InputFrame> {
  const map = new Map<string, InputFrame>();
  for (const input of inputs) {
    const entityId = input.entityId?.slice(0, 128) ?? '';
    if (entityId) map.set(entityId, input);
  }
  return map;
}

function sameEntity(a: WorldEntity, b: WorldEntity): boolean {
  return (
    a.transform.position.x === b.transform.position.x &&
    a.transform.position.y === b.transform.position.y &&
    a.transform.position.z === b.transform.position.z &&
    a.velocity.linear.x === b.velocity.linear.x &&
    a.velocity.linear.y === b.velocity.linear.y &&
    a.velocity.linear.z === b.velocity.linear.z &&
    a.combat.stamina === b.combat.stamina &&
    a.combat.health === b.combat.health &&
    a.combat.guarding === b.combat.guarding
  );
}
