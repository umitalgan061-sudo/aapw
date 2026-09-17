import { DeterministicFixedClock, MemoryLogger, TypedEventBus, type EventEnvelope } from './portsR3.ts';
import type { FixedClockPort, InputPort, LoggerPort, RuntimeDiagnosticsPort, RuntimePolicyPort, WorldQueryPort, PhysicsPort, AssetPort, PersistencePort, NetworkTransportPort, RenderPort, WorkerPort } from './portsR3.ts';
import type { RenderPacketR3 } from './renderRuntimeR3.ts';

export type ApplicationPhase = 'created' | 'booting' | 'running' | 'paused' | 'recovering' | 'stopping' | 'stopped' | 'failed';

export interface ApplicationEvents {
  readonly boot: { readonly phase: ApplicationPhase };
  readonly tick: { readonly frame: number; readonly deltaMs: number; readonly steps: number };
  readonly phase: { readonly previous: ApplicationPhase; readonly next: ApplicationPhase; readonly reason: string };
  readonly fault: { readonly domain: string; readonly message: string; readonly recoverable: boolean };
  readonly shutdown: { readonly frame: number };
}

export interface ApplicationRuntimeDependencies {
  readonly clock?: FixedClockPort;
  readonly input: InputPort;
  readonly world: WorldQueryPort;
  readonly physics: PhysicsPort;
  readonly assets: AssetPort;
  readonly persistence: PersistencePort<unknown>;
  readonly transport: NetworkTransportPort;
  readonly renderer: RenderPort<RenderPacketR3>;
  readonly worker: WorkerPort<unknown, unknown>;
  readonly diagnostics?: RuntimeDiagnosticsPort;
  readonly policy?: RuntimePolicyPort;
  readonly logger?: LoggerPort;
}

export interface ApplicationRuntimeConfig {
  readonly fixedStepMs?: number;
  readonly maxCatchUpSteps?: number;
  readonly maxFrameDeltaMs?: number;
  readonly pauseOnHidden?: boolean;
}

export interface RuntimePlayerFrame {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

export interface ApplicationSnapshot {
  readonly phase: ApplicationPhase;
  readonly frame: number;
  readonly nowMs: number;
  readonly accumulatedMs: number;
  readonly simulationSteps: number;
  readonly droppedSimulationMs: number;
  readonly playerCount: number;
  readonly lastError: string | null;
}

const DEFAULTS = {
  fixedStepMs: 1000 / 60,
  maxCatchUpSteps: 5,
  maxFrameDeltaMs: 250,
  pauseOnHidden: true,
} as const;

export class ApplicationRuntimeR3 {
  readonly clock: FixedClockPort;
  readonly input: InputPort;
  readonly world: WorldQueryPort;
  readonly physics: PhysicsPort;
  readonly assets: AssetPort;
  readonly persistence: PersistencePort<unknown>;
  readonly transport: NetworkTransportPort;
  readonly renderer: RenderPort<RenderPacketR3>;
  readonly worker: WorkerPort<unknown, unknown>;
  readonly logger: LoggerPort;
  readonly events = new TypedEventBus<ApplicationEvents>();

  readonly #fixedStepMs: number;
  readonly #maxCatchUpSteps: number;
  readonly #maxFrameDeltaMs: number;
  readonly #pauseOnHidden: boolean;
  readonly #diagnostics?: RuntimeDiagnosticsPort;
  readonly #policy?: RuntimePolicyPort;
  readonly #players = new Map<string, RuntimePlayerFrame>();
  #phase: ApplicationPhase = 'created';
  #accumulatorMs = 0;
  #simulationSteps = 0;
  #droppedSimulationMs = 0;
  #lastError: string | null = null;
  #started = false;

  constructor(dependencies: ApplicationRuntimeDependencies, config: ApplicationRuntimeConfig = {}) {
    this.clock = dependencies.clock ?? new DeterministicFixedClock();
    this.input = dependencies.input;
    this.world = dependencies.world;
    this.physics = dependencies.physics;
    this.assets = dependencies.assets;
    this.persistence = dependencies.persistence;
    this.transport = dependencies.transport;
    this.renderer = dependencies.renderer;
    this.worker = dependencies.worker;
    this.logger = dependencies.logger ?? new MemoryLogger();
    this.#fixedStepMs = clamp(config.fixedStepMs ?? DEFAULTS.fixedStepMs, 1, 100);
    this.#maxCatchUpSteps = Math.max(1, Math.floor(config.maxCatchUpSteps ?? DEFAULTS.maxCatchUpSteps));
    this.#maxFrameDeltaMs = Math.max(this.#fixedStepMs, Math.min(1000, config.maxFrameDeltaMs ?? DEFAULTS.maxFrameDeltaMs));
    this.#pauseOnHidden = config.pauseOnHidden ?? DEFAULTS.pauseOnHidden;
    this.#diagnostics = dependencies.diagnostics;
    this.#policy = dependencies.policy;
  }

  get phase(): ApplicationPhase {
    return this.#phase;
  }

  boot(): void {
    if (this.#phase !== 'created' && this.#phase !== 'stopped') return;
    this.#transition('booting', 'boot requested');
    try {
      this.#accumulatorMs = 0;
      this.#simulationSteps = 0;
      this.#droppedSimulationMs = 0;
      this.#lastError = null;
      this.#started = true;
      this.input.setEnabled(true);
      this.events.publish(this.#event('boot', { phase: this.#phase }));
      this.#transition('running', 'boot completed');
    } catch (error) {
      this.#fault('boot', error, false);
      throw error;
    }
  }

  pause(reason = 'manual pause'): void {
    if (this.#phase !== 'running') return;
    this._transitionIfValid('paused', reason);
  }

  resume(reason = 'manual resume'): void {
    if (this.#phase !== 'paused') return;
    this._transitionIfValid('running', reason);
  }

  addPlayer(player: RuntimePlayerFrame): void {
    if (!player.id.trim()) throw new Error('Player id cannot be empty.');
    this.#players.set(player.id, { ...player });
  }

  removePlayer(id: string): void {
    this.#players.delete(id);
  }

  tick(deltaMs: number): number {
    if (!this.#started || this.#phase !== 'running') return 0;
    const safeDelta = clamp(Number.isFinite(deltaMs) ? deltaMs : 0, 0, this.#maxFrameDeltaMs);
    this.clock.advance(safeDelta);
    const frame = this.clock.frame();
    this.#accumulatorMs += safeDelta;
    let steps = 0;
    const maxSteps = this.#policy?.shouldThrottle('simulation') ? 1 : this.#maxCatchUpSteps;
    try {
      while (this.#accumulatorMs >= this.#fixedStepMs && steps < maxSteps) {
        this.#simulationStep(this.#fixedStepMs);
        this.#accumulatorMs -= this.#fixedStepMs;
        steps += 1;
      }
      if (this.#accumulatorMs >= this.#fixedStepMs) {
        this.#droppedSimulationMs += this.#accumulatorMs;
        this.#accumulatorMs = 0;
      }
      this.#diagnostics?.increment('runtime.frame');
      this.#diagnostics?.increment('runtime.simulationSteps', steps);
      this.events.publish(this.#event('tick', { frame, deltaMs: safeDelta, steps }));
      return steps;
    } catch (error) {
      this.#fault('tick', error, true);
      return steps;
    }
  }

  requestPauseFromVisibility(hidden: boolean): void {
    if (!this.#pauseOnHidden) return;
    if (hidden) this.pause('document hidden');
    else this.resume('document visible');
  }

  async recover(): Promise<boolean> {
    if (this.#phase !== 'failed' && this.#phase !== 'recovering') return true;
    this.#transition('recovering', 'recovery requested');
    const result = await this.renderer.recover();
    if (!result.ok) {
      this.#fault('render-recovery', new Error(result.error.message), false);
      return false;
    }
    this.#lastError = null;
    this.#transition('running', 'recovery completed');
    return true;
  }

  async stop(reason = 'shutdown'): Promise<void> {
    if (this.#phase === 'stopped' || this.#phase === 'stopping') return;
    this.#transition('stopping', reason);
    this.input.setEnabled(false);
    this.worker.close();
    this.transport.close(reason);
    this.assets.invalidate();
    this.#started = false;
    this.#transition('stopped', reason);
    this.events.publish(this.#event('shutdown', { frame: this.clock.frame() }));
  }

  snapshot(): ApplicationSnapshot {
    return {
      phase: this.#phase,
      frame: this.clock.frame(),
      nowMs: this.clock.nowMs(),
      accumulatedMs: this.#accumulatorMs,
      simulationSteps: this.#simulationSteps,
      droppedSimulationMs: this.#droppedSimulationMs,
      playerCount: this.#players.size,
      lastError: this.#lastError,
    };
  }

  #simulationStep(deltaMs: number): void {
    this.#simulationSteps += 1;
    const now = this.clock.nowMs();
    const inputs = this.input.consume();
    if (this.#diagnostics) this.#diagnostics.mark('runtime.inputBatch', inputs.length);
    for (const player of this.#players.values()) {
      const movement = this.#movementFromInput(inputs, player.id);
      const target = {
        x: player.x + movement.x * deltaMs / 1000,
        y: player.y,
        z: player.z + movement.z * deltaMs / 1000,
        biome: this.world.nearestPoint(player.x, player.z, 2)?.biome ?? 'unknown',
      };
      const groundedBody = {
        id: player.id,
        position: { x: player.x, y: player.y, z: player.z, biome: target.biome },
        velocity: { x: movement.x, y: 0, z: movement.z },
        acceleration: { x: 0, y: 0, z: 0 },
        radius: player.radius,
        grounded: true,
      };
      const integrated = this.physics.integrate(groundedBody, {
        desiredVelocity: { x: movement.x, y: 0, z: movement.z },
        jump: false,
        gravityScale: 1,
        friction: 0.4,
      }, deltaMs);
      player.x = integrated.position.x;
      player.y = integrated.position.y;
      player.z = integrated.position.z;
      if (this.#diagnostics) this.#diagnostics.mark(`player.${player.id}.speed`, Math.hypot(integrated.velocity.x, integrated.velocity.z));
    }
    this.world as unknown as { advance?: (frame: number) => void };
    const maybeWorld = this.world as unknown as { advance?: (frame: number) => void };
    maybeWorld.advance?.(this.clock.frame());
    const maybeAssets = this.assets as unknown as { advance?: (nowMs: number) => void };
    maybeAssets.advance?.(now);
  }

  #movementFromInput(inputs: readonly { readonly action: string; readonly value: number }[], playerId: string): { x: number; z: number } {
    let x = 0;
    let z = 0;
    for (const input of inputs) {
      if (input.action === `${playerId}:moveX` || input.action === 'moveX') x += input.value;
      if (input.action === `${playerId}:moveY` || input.action === 'moveY') z += input.value;
      if (input.action === `${playerId}:left` || input.action === 'left') x -= Math.max(0, input.value);
      if (input.action === `${playerId}:right` || input.action === 'right') x += Math.max(0, input.value);
      if (input.action === `${playerId}:forward` || input.action === 'forward') z -= Math.max(0, input.value);
      if (input.action === `${playerId}:back` || input.action === 'back') z += Math.max(0, input.value);
    }
    const length = Math.hypot(x, z);
    return length <= 1 ? { x, z } : { x: x / length, z: z / length };
  }

  #event<TKey extends keyof ApplicationEvents & string>(type: TKey, payload: ApplicationEvents[TKey]): EventEnvelope<TKey, ApplicationEvents[TKey]> {
    return { type, frame: this.clock.frame(), atMs: this.clock.nowMs(), payload };
  }

  #transition(next: ApplicationPhase, reason: string): void {
    const previous = this.#phase;
    this.#phase = next;
    this.events.publish(this.#event('phase', { previous, next, reason }));
    this.logger.debug(`[runtime] ${previous} -> ${next}: ${reason}`);
  }

  _transitionIfValid(next: ApplicationPhase, reason: string): void {
    this.#transition(next, reason);
  }

  #fault(domain: string, error: unknown, recoverable: boolean): void {
    const message = error instanceof Error ? error.message : String(error);
    this.#lastError = message;
    this.#phase = recoverable ? 'failed' : 'failed';
    this.logger.error(`[runtime:${domain}] ${message}`, error);
    this.#diagnostics?.increment(`runtime.fault.${domain}`);
    this.events.publish(this.#event('fault', { domain, message, recoverable }));
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createApplicationRuntimeR3(dependencies: ApplicationRuntimeDependencies, config?: ApplicationRuntimeConfig): ApplicationRuntimeR3 {
  return new ApplicationRuntimeR3(dependencies, config);
}
