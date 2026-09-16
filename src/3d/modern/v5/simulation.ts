import { EntityId, Tick, Vec3, clamp, lerp, nextTick } from './domain.ts';
import { EcsWorldV5 } from './ecs.ts';
import { AiContext, AiDecision, UtilityAiV5 } from './ai.ts';
import { WorldQueryV5 } from './worldQuery.ts';

export interface SimulationConfig {
  readonly fixedDeltaSeconds: number;
  readonly gravity: number;
  readonly maxSpeed: number;
  readonly acceleration: number;
  readonly friction: number;
  readonly maxSubSteps: number;
}

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = Object.freeze({ fixedDeltaSeconds: 1 / 60, gravity: 24, maxSpeed: 12, acceleration: 40, friction: 10, maxSubSteps: 4 });

export interface MovementIntent {
  readonly entity: EntityId;
  readonly desiredDirection: Vec3;
  readonly sprint: boolean;
  readonly jump: boolean;
}

export interface SimulationEvent {
  readonly type: 'landed' | 'jumped' | 'died' | 'moved' | 'ai-decision';
  readonly entity: EntityId;
  readonly tick: Tick;
  readonly payload: Readonly<Record<string, number | string | boolean>>;
}

export interface SimulationStepResult {
  readonly tick: Tick;
  readonly events: readonly SimulationEvent[];
  readonly updatedEntities: number;
  readonly subSteps: number;
}

const horizontalLength = (value: Vec3): number => Math.hypot(value.x, value.z);

export class DeterministicSimulationV5 {
  readonly #config: SimulationConfig;
  readonly #events: SimulationEvent[] = [];
  #tick: Tick = 0 as Tick;

  constructor(private readonly world: EcsWorldV5, private readonly queries: WorldQueryV5, config: Partial<SimulationConfig> = {}) {
    this.#config = { ...DEFAULT_SIMULATION_CONFIG, ...config };
    if (this.#config.fixedDeltaSeconds <= 0) throw new RangeError('fixedDeltaSeconds must be positive');
  }

  get tick(): Tick { return this.#tick; }

  step(intents: readonly MovementIntent[] = []): SimulationStepResult {
    const events: SimulationEvent[] = [];
    const intentMap = new Map(intents.map((intent) => [intent.entity, intent]));
    let updated = 0;
    for (const entity of this.world.query({ all: ['transform', 'velocity'] })) {
      const transform = entity.components.get('transform');
      const velocity = entity.components.get('velocity');
      if (transform?.kind !== 'transform' || velocity?.kind !== 'velocity') continue;
      const intent = intentMap.get(entity.id);
      const target = intent ? { x: intent.desiredDirection.x * (intent.sprint ? this.#config.maxSpeed : this.#config.maxSpeed * 0.65), y: 0, z: intent.desiredDirection.z * (intent.sprint ? this.#config.maxSpeed : this.#config.maxSpeed * 0.65) } : { x: 0, y: 0, z: 0 };
      const horizontal = { x: lerp(velocity.linear.x, target.x, this.#config.acceleration * this.#config.fixedDeltaSeconds), y: velocity.linear.y, z: lerp(velocity.linear.z, target.z, this.#config.acceleration * this.#config.fixedDeltaSeconds) };
      const speed = horizontalLength(horizontal);
      const capped = speed > this.#config.maxSpeed ? { ...horizontal, x: horizontal.x / speed * this.#config.maxSpeed, z: horizontal.z / speed * this.#config.maxSpeed } : horizontal;
      let nextVelocity = capped;
      let grounded = velocity.grounded;
      const sample = this.queries.terrainAt(transform.position.x, transform.position.z);
      const floor = sample.height;
      const shouldJump = !!intent?.jump && grounded;
      if (shouldJump) {
        nextVelocity = { ...nextVelocity, y: 8 };
        grounded = false;
        events.push({ type: 'jumped', entity: entity.id, tick: nextTick(this.#tick), payload: { impulse: 8 } });
      } else if (!grounded) {
        nextVelocity = { ...nextVelocity, y: nextVelocity.y - this.#config.gravity * this.#config.fixedDeltaSeconds };
      }
      let position = { x: transform.position.x + nextVelocity.x * this.#config.fixedDeltaSeconds, y: transform.position.y + nextVelocity.y * this.#config.fixedDeltaSeconds, z: transform.position.z + nextVelocity.z * this.#config.fixedDeltaSeconds };
      if (position.y <= floor) {
        if (!grounded) events.push({ type: 'landed', entity: entity.id, tick: nextTick(this.#tick), payload: { height: floor } });
        position = { ...position, y: floor };
        nextVelocity = { ...nextVelocity, y: 0 };
        grounded = true;
      }
      if (!intent && speed > 0) {
        const decay = clamp(1 - this.#config.friction * this.#config.fixedDeltaSeconds, 0, 1);
        nextVelocity = { ...nextVelocity, x: nextVelocity.x * decay, z: nextVelocity.z * decay };
      }
      const wasMoving = horizontalLength(velocity.linear) > 0.01;
      const isMoving = horizontalLength(nextVelocity) > 0.01;
      this.world.setComponent(entity.id, { ...transform, position });
      this.world.setComponent(entity.id, { ...velocity, linear: nextVelocity, grounded });
      if (wasMoving !== isMoving) events.push({ type: 'moved', entity: entity.id, tick: nextTick(this.#tick), payload: { moving: isMoving } });
      updated += 1;
    }
    this.#tick = nextTick(this.#tick);
    this.#events.push(...events);
    if (this.#events.length > 4096) this.#events.splice(0, this.#events.length - 4096);
    return { tick: this.#tick, events, updatedEntities: updated, subSteps: 1 };
  }

  recentEvents(limit = 256): readonly SimulationEvent[] { return this.#events.slice(-limit); }
  clearEvents(): void { this.#events.length = 0; }
}

export class AiSimulationSystemV5 {
  constructor(private readonly world: EcsWorldV5, private readonly query: WorldQueryV5, private readonly ai: UtilityAiV5) {}

  think(entity: EntityId, tick: Tick): AiDecision | null {
    const record = this.world.get(entity);
    const transform = record?.components.get('transform');
    const health = record?.components.get('health');
    const stamina = record?.components.get('stamina');
    const ai = record?.components.get('ai');
    if (!record || transform?.kind !== 'transform' || health?.kind !== 'health' || stamina?.kind !== 'stamina' || ai?.kind !== 'ai') return null;
    const target = ai.target;
    let targetDistance = Number.POSITIVE_INFINITY;
    let targetVisible = false;
    if (target !== null) {
      const targetTransform = this.world.getComponent(target, 'transform');
      if (targetTransform?.kind === 'transform') {
        targetDistance = Math.sqrt((targetTransform.position.x - transform.position.x) ** 2 + (targetTransform.position.z - transform.position.z) ** 2);
        targetVisible = this.query.lineOfSight(transform.position, targetTransform.position, () => false);
      }
    }
    const context: AiContext = {
      self: entity,
      position: transform.position,
      health: health.maximum > 0 ? health.current / health.maximum : 0,
      stamina: stamina.maximum > 0 ? stamina.current / stamina.maximum : 0,
      target,
      targetDistance,
      targetVisible,
      alertness: ai.alertness,
      memory: this.ai.memory(),
    };
    const decision = this.ai.decide(context);
    this.world.setComponent(entity, { ...ai, thinkDebt: Math.max(0, ai.thinkDebt - 1) });
    return decision;
  }
}
