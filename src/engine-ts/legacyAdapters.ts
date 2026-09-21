import type { EntityId, Vec3 } from './coreTypes.ts';
import { ENTITY_ID, clamp } from './coreTypes.ts';
import { EventBus } from '../3d/eventBus.ts';
import { GameState, type GamePhase } from '../3d/state.ts';
import { QUALITY_LEVELS, type QualityLevel, WORLD_DEFAULTS } from '../3d/config.ts';
import type { InputAction, InputFrame } from './input.ts';
import { InputMapper } from './input.ts';
import { EcsWorld, TRANSFORM, VELOCITY, type TransformComponent, type VelocityComponent } from './ecsRuntime.ts';

export interface LegacyStateShape {
  quality: QualityLevel;
  isLoading: boolean;
  loadProgress: number;
  currentPhase: GamePhase;
  error: string | null;
}

export class StateCompatibilityAdapter {
  constructor(readonly state = new GameState()) {}
  get<K extends keyof LegacyStateShape>(key: K): LegacyStateShape[K] { return this.state.get(key) as LegacyStateShape[K]; }
  set<K extends keyof LegacyStateShape>(key: K, value: LegacyStateShape[K]): boolean { return this.state.set(key, value); }
  snapshot(): LegacyStateShape { return { quality: this.state.get('quality'), isLoading: this.state.get('isLoading'), loadProgress: this.state.get('loadProgress'), currentPhase: this.state.get('currentPhase'), error: this.state.get('error') }; }
}

export interface LegacyEventBusAdapter {
  on<T = unknown>(event: string, handler: (payload: T) => void): () => void;
  once<T = unknown>(event: string, handler: (payload: T) => void): void;
  off<T = unknown>(event: string, handler: (payload: T) => void): boolean;
  emit<T = unknown>(event: string, payload?: T): void;
  clear(event?: string): void;
}

export const createLegacyEventBusAdapter = (bus = new EventBus()): LegacyEventBusAdapter => ({
  on: <T>(event, handler) => bus.on<T>(event, handler).unsubscribe,
  once: <T>(event, handler) => { bus.once<T>(event, handler); },
  off: <T>(event, handler) => bus.off(event, handler),
  emit: <T>(event, payload) => bus.emit(event, payload as T),
  clear: event => bus.clear(event),
});

export interface LegacyGameConfig {
  readonly quality: QualityLevel;
  readonly targetFps: number;
  readonly nearPlane: number;
  readonly farPlane: number;
  readonly fieldOfView: number;
  readonly worldSeed: number;
  readonly waterLevel: number;
}

export const createLegacyGameConfig = (quality: QualityLevel = QUALITY_LEVELS.AUTOMATIC): LegacyGameConfig => {
  const normalizedQuality = Object.values(QUALITY_LEVELS).includes(quality) ? quality : WORLD_DEFAULTS.FALLBACK_QUALITY;
  return Object.freeze({
    quality: normalizedQuality,
    targetFps: WORLD_DEFAULTS.TARGET_FPS_DESKTOP,
    nearPlane: WORLD_DEFAULTS.NEAR_PLANE,
    farPlane: WORLD_DEFAULTS.FAR_PLANE,
    fieldOfView: WORLD_DEFAULTS.FOV_DEGREES,
    worldSeed: WORLD_DEFAULTS.WORLD_SEED,
    waterLevel: WORLD_DEFAULTS.WATER_LEVEL_METERS,
  });
};

export interface LegacyPlayerInput {
  readonly moveX: number;
  readonly moveY: number;
  readonly jump: boolean;
  readonly sprint: boolean;
  readonly crouch: boolean;
  readonly interact: boolean;
  readonly attack: boolean;
}

export const translateInputFrame = (frame: InputFrame, mapper: InputMapper): LegacyPlayerInput => {
  const move = mapper.axis2D();
  return Object.freeze({
    moveX: clamp(move.x, -1, 1),
    moveY: clamp(move.y, -1, 1),
    jump: Boolean(frame.actions.get('jump')?.justPressed),
    sprint: Boolean(frame.actions.get('sprint')?.pressed),
    crouch: Boolean(frame.actions.get('crouch')?.pressed),
    interact: Boolean(frame.actions.get('interact')?.justPressed),
    attack: Boolean(frame.actions.get('attack')?.justPressed),
  });
};

export const inputActionDown = (mapper: InputMapper, action: InputAction): boolean => mapper.action(action).pressed;
export const inputActionPressed = (mapper: InputMapper, action: InputAction): boolean => mapper.action(action).justPressed;
export const inputActionReleased = (mapper: InputMapper, action: InputAction): boolean => mapper.action(action).justReleased;

export interface LegacyTransformLike { position?: { x?: number; y?: number; z?: number }; rotation?: { x?: number; y?: number; z?: number; w?: number }; scale?: { x?: number; y?: number; z?: number }; }

export const fromLegacyTransform = (legacy: LegacyTransformLike = {}): TransformComponent => ({
  position: [legacy.position?.x ?? 0, legacy.position?.y ?? 0, legacy.position?.z ?? 0],
  rotation: [legacy.rotation?.x ?? 0, legacy.rotation?.y ?? 0, legacy.rotation?.z ?? 0, legacy.rotation?.w ?? 1],
  scale: [legacy.scale?.x ?? 1, legacy.scale?.y ?? 1, legacy.scale?.z ?? 1],
});

export const toLegacyTransform = (component: TransformComponent): Required<LegacyTransformLike> => ({
  position: { x: component.position[0], y: component.position[1], z: component.position[2] },
  rotation: { x: component.rotation[0], y: component.rotation[1], z: component.rotation[2], w: component.rotation[3] },
  scale: { x: component.scale[0], y: component.scale[1], z: component.scale[2] },
});

export const fromLegacyVelocity = (velocity: LegacyTransformLike['position'] = {}): VelocityComponent => ({ linear: [velocity.x ?? 0, velocity.y ?? 0, velocity.z ?? 0], angular: [0, 0, 0] });
export const toLegacyVelocity = (component: VelocityComponent): { x: number; y: number; z: number } => ({ x: component.linear[0], y: component.linear[1], z: component.linear[2] });

export interface PlayerControllerBinding {
  readonly entity: EntityId;
  readonly input: InputMapper;
  readonly ecs: EcsWorld;
  readonly speed: number;
  readonly sprintMultiplier: number;
  readonly acceleration: number;
  readonly braking: number;
}

export class TypedPlayerController {
  private readonly entity: EntityId;
  private readonly input: InputMapper;
  private readonly ecs: EcsWorld;
  private readonly speed: number;
  private readonly sprintMultiplier: number;
  private readonly acceleration: number;
  private readonly braking: number;

  constructor(binding: PlayerControllerBinding) {
    this.entity = binding.entity;
    this.input = binding.input;
    this.ecs = binding.ecs;
    this.speed = Math.max(0, binding.speed);
    this.sprintMultiplier = Math.max(1, binding.sprintMultiplier);
    this.acceleration = Math.max(0, binding.acceleration);
    this.braking = Math.max(0, binding.braking);
  }

  update(deltaSeconds: number): void {
    const transform = this.ecs.require(this.entity, TRANSFORM);
    const velocity = this.ecs.require(this.entity, VELOCITY);
    const axis = this.input.axis2D();
    const sprinting = this.input.action('sprint').pressed;
    const maxSpeed = this.speed * (sprinting ? this.sprintMultiplier : 1);
    const length = Math.hypot(axis.x, axis.y);
    const targetX = length > 1 ? axis.x / length * maxSpeed : axis.x * maxSpeed;
    const targetZ = length > 1 ? axis.y / length * maxSpeed : axis.y * maxSpeed;
    const response = Math.max(0, deltaSeconds) * (length > 0 ? this.acceleration : this.braking);
    velocity.linear[0] += (targetX - velocity.linear[0]) * clamp(response, 0, 1);
    velocity.linear[2] += (targetZ - velocity.linear[2]) * clamp(response, 0, 1);
    transform.position[0] += velocity.linear[0] * Math.max(0, deltaSeconds);
    transform.position[2] += velocity.linear[2] * Math.max(0, deltaSeconds);
  }
}

export interface CameraFollowTarget { readonly position: Vec3; readonly height?: number; }
export interface CameraFollowConfig { readonly distance: number; readonly height: number; readonly smoothing: number; readonly lookAhead: number; readonly collisionPadding: number; }
export interface CameraPose { readonly position: Vec3; readonly target: Vec3; }

export const solveThirdPersonCamera = (target: CameraFollowTarget, desiredYaw: number, config: CameraFollowConfig, deltaSeconds: number, current: CameraPose): CameraPose => {
  const smoothing = 1 - Math.exp(-Math.max(0, deltaSeconds) / Math.max(0.001, config.smoothing));
  const targetHeight = target.height ?? 1.7;
  const desiredPosition = {
    x: target.position.x - Math.sin(desiredYaw) * config.distance,
    y: target.position.y + config.height,
    z: target.position.z - Math.cos(desiredYaw) * config.distance,
  };
  const position = {
    x: current.position.x + (desiredPosition.x - current.position.x) * smoothing,
    y: current.position.y + (desiredPosition.y - current.position.y) * smoothing,
    z: current.position.z + (desiredPosition.z - current.position.z) * smoothing,
  };
  const lookAhead = config.lookAhead * Math.min(1, Math.hypot(target.position.x - current.position.x, target.position.z - current.position.z));
  return Object.freeze({
    position,
    target: Object.freeze({ x: target.position.x, y: target.position.y + targetHeight, z: target.position.z + lookAhead }),
  });
};

export const ensurePlayerComponents = (ecs: EcsWorld, entity: EntityId): void => {
  if (!ecs.get(entity, TRANSFORM)) ecs.add(entity, TRANSFORM);
  if (!ecs.get(entity, VELOCITY)) ecs.add(entity, VELOCITY);
};

export const createPlayerEntity = (ecs: EcsWorld, id = 'player'): EntityId => {
  const entity = ecs.createEntity(id);
  ensurePlayerComponents(ecs, entity);
  return ENTITY_ID(entity);
};
