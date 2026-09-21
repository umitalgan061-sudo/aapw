/**
 * AAPW v3 simulation kernel.
 *
 * This module is the composition root for deterministic fixed-step simulation. Rendering, input,
 * persistence and transport are explicitly integrated through narrow ports so a browser frame cannot
 * mutate authoritative state outside a simulation tick. The kernel is usable in the browser, a worker,
 * a headless test process, or a server-side replay verifier.
 */

import type { EcsSystem, EcsWorldV3, SystemContext } from './ecsRuntimeV3.ts';
import { createDefaultEcsWorldV3, Transform, Velocity, Health, Stamina } from './ecsRuntimeV3.ts';

export const ENGINE_TICK_HZ_V3 = 60;
export const ENGINE_FIXED_DT_V3 = 1 / ENGINE_TICK_HZ_V3;
export const ENGINE_MAX_ACCUMULATOR_SECONDS_V3 = 0.25;
export const ENGINE_MAX_TICKS_PER_FRAME_V3 = 8;

export type EnginePhase = 'booting' | 'running' | 'paused' | 'stopping' | 'stopped';

export interface EngineClockV3 {
  tick: number;
  accumulator: number;
  simulationSeconds: number;
  renderAlpha: number;
  droppedSeconds: number;
}

export interface EngineFrameInputV3 {
  readonly realDeltaSeconds: number;
  readonly input?: Readonly<Record<string, number | boolean>>;
  readonly present?: boolean;
}

export interface EngineFrameResultV3 {
  readonly phase: EnginePhase;
  readonly tick: number;
  readonly ticksAdvanced: number;
  readonly simulationSeconds: number;
  readonly renderAlpha: number;
  readonly droppedSeconds: number;
}

export interface EngineRuntimeStatsV3 {
  frames: number;
  simulationTicks: number;
  skippedTicks: number;
  droppedSeconds: number;
  lastFrameSeconds: number;
  maxFrameSeconds: number;
  lastTickWorkSeconds: number;
  maxTickWorkSeconds: number;
}

export interface EngineInputPortV3 {
  poll(): Readonly<Record<string, number | boolean>>;
  flush?(): void;
}

export interface EnginePresentationPortV3 {
  present(alpha: number, clock: Readonly<EngineClockV3>): void;
  dispose?(): void;
}

export interface EngineLifecycleListenerV3 {
  onPhaseChanged?(phase: EnginePhase): void;
  onTick?(context: SystemContext): void;
  onFrame?(result: EngineFrameResultV3): void;
  onError?(error: unknown, stage: string): void;
}

export interface EngineKernelOptionsV3 {
  readonly world?: EcsWorldV3;
  readonly tickHz?: number;
  readonly maxTicksPerFrame?: number;
  readonly maxAccumulatorSeconds?: number;
  readonly input?: EngineInputPortV3;
  readonly presentation?: EnginePresentationPortV3;
  readonly listener?: EngineLifecycleListenerV3;
}

export interface EngineSystemRegistrationV3 {
  readonly system: EcsSystem;
  readonly enabled: boolean;
  readonly reason?: string;
}

const finitePositive = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const safeDelta = (delta: number, max: number): number =>
  Number.isFinite(delta) && delta >= 0 ? Math.min(delta, max) : 0;

export class EngineKernelV3 {
  readonly world: EcsWorldV3;
  readonly tickHz: number;
  readonly fixedDt: number;
  readonly maxTicksPerFrame: number;
  readonly maxAccumulatorSeconds: number;

  #phase: EnginePhase = 'booting';
  #clock: EngineClockV3 = {
    tick: 0,
    accumulator: 0,
    simulationSeconds: 0,
    renderAlpha: 0,
    droppedSeconds: 0,
  };
  #stats: EngineRuntimeStatsV3 = {
    frames: 0,
    simulationTicks: 0,
    skippedTicks: 0,
    droppedSeconds: 0,
    lastFrameSeconds: 0,
    maxFrameSeconds: 0,
    lastTickWorkSeconds: 0,
    maxTickWorkSeconds: 0,
  };
  #systems: EcsSystem[] = [];
  #input: EngineInputPortV3 | null;
  #presentation: EnginePresentationPortV3 | null;
  #listener: EngineLifecycleListenerV3 | null;
  #started = false;
  #insideTick = false;

  constructor(options: EngineKernelOptionsV3 = {}) {
    this.world = options.world ?? createDefaultEcsWorldV3();
    this.tickHz = finitePositive(options.tickHz ?? ENGINE_TICK_HZ_V3, ENGINE_TICK_HZ_V3);
    this.fixedDt = 1 / this.tickHz;
    this.maxTicksPerFrame = Math.max(1, Math.floor(options.maxTicksPerFrame ?? ENGINE_MAX_TICKS_PER_FRAME_V3));
    this.maxAccumulatorSeconds = finitePositive(
      options.maxAccumulatorSeconds ?? ENGINE_MAX_ACCUMULATOR_SECONDS_V3,
      ENGINE_MAX_ACCUMULATOR_SECONDS_V3,
    );
    this.#input = options.input ?? null;
    this.#presentation = options.presentation ?? null;
    this.#listener = options.listener ?? null;
  }

  get phase(): EnginePhase {
    return this.#phase;
  }

  get clock(): Readonly<EngineClockV3> {
    return { ...this.#clock };
  }

  get stats(): Readonly<EngineRuntimeStatsV3> {
    return { ...this.#stats };
  }

  registerSystem(system: EcsSystem): EngineSystemRegistrationV3 {
    if (this.#systems.some((existing) => existing.name === system.name)) {
      return { system, enabled: false, reason: `duplicate:${system.name}` };
    }
    this.#systems.push(system);
    this.#systems.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
    return { system, enabled: system.enabled !== false };
  }

  unregisterSystem(name: string): boolean {
    const index = this.#systems.findIndex((system) => system.name === name);
    if (index < 0) return false;
    this.#systems.splice(index, 1);
    return true;
  }

  systems(): readonly { name: string; priority: number; enabled: boolean }[] {
    return this.#systems.map((system) => ({
      name: system.name,
      priority: system.priority,
      enabled: system.enabled !== false,
    }));
  }

  start(): void {
    if (this.#phase === 'running') return;
    if (this.#phase === 'stopping' || this.#phase === 'stopped') {
      throw new Error(`Cannot start kernel from phase ${this.#phase}`);
    }
    this.#phase = 'running';
    this.#started = true;
    this.#notifyPhase();
  }

  pause(): void {
    if (this.#phase !== 'running') return;
    this.#phase = 'paused';
    this.#notifyPhase();
  }

  resume(): void {
    if (this.#phase !== 'paused') return;
    this.#phase = 'running';
    this.#notifyPhase();
  }

  stop(): void {
    if (!this.#started || this.#phase === 'stopped') return;
    this.#phase = 'stopping';
    this.#notifyPhase();
    try {
      this.#presentation?.dispose?.();
    } catch (error) {
      this.#reportError(error, 'presentation.dispose');
    }
    try {
      this.#input?.flush?.();
    } catch (error) {
      this.#reportError(error, 'input.flush');
    }
    this.#phase = 'stopped';
    this.#notifyPhase();
  }

  frame(input: EngineFrameInputV3): EngineFrameResultV3 {
    if (this.#phase === 'booting') this.start();
    const frameDelta = safeDelta(input.realDeltaSeconds, this.maxAccumulatorSeconds * 4);
    this.#stats.frames += 1;
    this.#stats.lastFrameSeconds = frameDelta;
    this.#stats.maxFrameSeconds = Math.max(this.#stats.maxFrameSeconds, frameDelta);

    if (this.#phase !== 'running') {
      const result = this.#result(0);
      if (input.present !== false) this.#present();
      this.#listener?.onFrame?.(result);
      return result;
    }

    const beforeClamp = this.#clock.accumulator + frameDelta;
    this.#clock.accumulator = Math.min(beforeClamp, this.maxAccumulatorSeconds);
    const newlyDropped = Math.max(0, beforeClamp - this.#clock.accumulator);
    if (newlyDropped > 0) {
      this.#clock.droppedSeconds += newlyDropped;
      this.#stats.droppedSeconds += newlyDropped;
    }

    const frameInput = input.input ?? this.#input?.poll() ?? {};
    let ticksAdvanced = 0;

    while (this.#clock.accumulator >= this.fixedDt && ticksAdvanced < this.maxTicksPerFrame) {
      const tickStart = performance.now();
      try {
        this.#runTick(frameInput);
      } catch (error) {
        this.#reportError(error, 'simulation.tick');
        this.pause();
        break;
      } finally {
        const work = Math.max(0, (performance.now() - tickStart) / 1000);
        this.#stats.lastTickWorkSeconds = work;
        this.#stats.maxTickWorkSeconds = Math.max(this.#stats.maxTickWorkSeconds, work);
      }
      this.#clock.accumulator -= this.fixedDt;
      this.#clock.simulationSeconds += this.fixedDt;
      this.#clock.tick += 1;
      this.#stats.simulationTicks += 1;
      ticksAdvanced += 1;
    }

    if (this.#clock.accumulator >= this.fixedDt) {
      const skipped = Math.floor(this.#clock.accumulator / this.fixedDt);
      this.#stats.skippedTicks += skipped;
      this.#clock.accumulator -= skipped * this.fixedDt;
      const dropped = skipped * this.fixedDt;
      this.#clock.droppedSeconds += dropped;
      this.#stats.droppedSeconds += dropped;
    }

    this.#clock.renderAlpha = clamp(this.#clock.accumulator / this.fixedDt, 0, 1);
    const result = this.#result(ticksAdvanced);
    if (input.present !== false) this.#present();
    this.#listener?.onFrame?.(result);
    return result;
  }

  reset(): void {
    if (this.#phase === 'running') this.pause();
    this.world.clear();
    this.#clock = { tick: 0, accumulator: 0, simulationSeconds: 0, renderAlpha: 0, droppedSeconds: 0 };
    this.#stats = {
      frames: 0,
      simulationTicks: 0,
      skippedTicks: 0,
      droppedSeconds: 0,
      lastFrameSeconds: 0,
      maxFrameSeconds: 0,
      lastTickWorkSeconds: 0,
      maxTickWorkSeconds: 0,
    };
  }

  step(ticks = 1, input: Readonly<Record<string, number | boolean>> = {}): EngineFrameResultV3 {
    if (!Number.isInteger(ticks) || ticks < 0) throw new RangeError('ticks must be a non-negative integer');
    if (this.#phase === 'booting') this.start();
    if (this.#phase !== 'running') return this.#result(0);
    const bounded = Math.min(ticks, this.maxTicksPerFrame);
    for (let index = 0; index < bounded; index += 1) {
      this.#runTick(input);
      this.#clock.tick += 1;
      this.#clock.simulationSeconds += this.fixedDt;
      this.#stats.simulationTicks += 1;
    }
    this.#clock.renderAlpha = 0;
    return this.#result(bounded);
  }

  checksum(): string {
    const encoder = new TextEncoder();
    const bytes: number[] = [];
    const text = JSON.stringify({
      tick: this.#clock.tick,
      entities: this.world.snapshot(),
    });
    for (const byte of encoder.encode(text)) bytes.push(byte);
    let hash = 2166136261;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  seedPlayer(id: ReturnType<typeof createDefaultEcsWorldV3> extends EcsWorldV3 ? never : never): never {
    throw new Error('Use createAndAttach with explicit schemas; this placeholder overload is intentionally unreachable.');
  }

  #runTick(input: Readonly<Record<string, number | boolean>>): void {
    if (this.#insideTick) throw new Error('Engine tick re-entry detected');
    this.#insideTick = true;
    try {
      const context: SystemContext = Object.freeze({
        tick: this.#clock.tick,
        dt: this.fixedDt,
        world: this.world,
        ...input,
      } as SystemContext);
      for (const system of this.#systems) {
        if (system.enabled === false) continue;
        system.update(context);
      }
      this.#listener?.onTick?.(context);
    } finally {
      this.#insideTick = false;
    }
  }

  #present(): void {
    if (!this.#presentation) return;
    try {
      this.#presentation.present(this.#clock.renderAlpha, this.#clock);
    } catch (error) {
      this.#reportError(error, 'presentation.present');
    }
  }

  #notifyPhase(): void {
    try {
      this.#listener?.onPhaseChanged?.(this.#phase);
    } catch (error) {
      this.#reportError(error, 'listener.phase');
    }
  }

  #reportError(error: unknown, stage: string): void {
    try {
      this.#listener?.onError?.(error, stage);
    } catch {
      // Listener failures are intentionally isolated from the runtime.
    }
  }

  #result(ticksAdvanced: number): EngineFrameResultV3 {
    return Object.freeze({
      phase: this.#phase,
      tick: this.#clock.tick,
      ticksAdvanced,
      simulationSeconds: this.#clock.simulationSeconds,
      renderAlpha: this.#clock.renderAlpha,
      droppedSeconds: this.#clock.droppedSeconds,
    });
  }
}

export interface TransformIntegrationOptionsV3 {
  readonly speedScale?: number;
  readonly verticalDamping?: number;
}

export const createTransformIntegrationSystemV3 = (
  options: TransformIntegrationOptionsV3 = {},
): EcsSystem => {
  const speedScale = finitePositive(options.speedScale ?? 1, 1);
  const verticalDamping = finitePositive(options.verticalDamping ?? 6, 6);
  return {
    name: 'core.transform-integration.v3',
    priority: 100,
    update({ dt, world }: SystemContext): void {
      world.forEach2(Transform, Velocity, (_entity, transform, velocity) => {
        const max = velocity.maxSpeed * speedScale;
        const length = Math.hypot(velocity.x, velocity.z);
        if (length > max && length > 0) {
          const ratio = max / length;
          velocity.x *= ratio;
          velocity.z *= ratio;
        }
        transform.x += velocity.x * dt;
        transform.y += velocity.y * dt;
        transform.z += velocity.z * dt;
        velocity.y *= Math.exp(-verticalDamping * dt);
      });
    },
  };
};

export const createHealthRecoverySystemV3 = (): EcsSystem => ({
  name: 'core.health-recovery.v3',
  priority: 200,
  update({ dt, tick, world }: SystemContext): void {
    world.forEach(Health, (_entity, health) => {
      if (health.dead) return;
      if (health.current <= 0) {
        health.current = 0;
        health.dead = true;
        return;
      }
      if (health.current > health.maximum) health.current = health.maximum;
      if (health.invulnerableUntilTick < tick) health.invulnerableUntilTick = 0;
      void dt;
    });
  },
});

export const createStaminaRecoverySystemV3 = (): EcsSystem => ({
  name: 'core.stamina-recovery.v3',
  priority: 210,
  update({ dt, world }: SystemContext): void {
    world.forEach(Stamina, (_entity, stamina) => {
      if (stamina.current < stamina.maximum) stamina.current = Math.min(stamina.maximum, stamina.current + stamina.regenerationPerSecond * dt);
      stamina.exhausted = stamina.current <= 0;
    });
  },
});

export const installCoreGameplaySystemsV3 = (kernel: EngineKernelV3): void => {
  kernel.registerSystem(createTransformIntegrationSystemV3());
  kernel.registerSystem(createHealthRecoverySystemV3());
  kernel.registerSystem(createStaminaRecoverySystemV3());
};
