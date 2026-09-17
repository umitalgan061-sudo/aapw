import {
  checksumV7,
  frameV7,
  runtimeIdV7,
  tickV7,
  type FrameV7,
  type InputModeV7,
  type QualityTierV7,
  type RenderPacketV7,
  type RenderViewV7,
  type RuntimeDiagnosticsV7,
  type RuntimeIdentityV7,
  type RuntimeModeV7,
  type RuntimeUsageV7,
  type RuntimeBudgetV7,
  type Vec3V7,
} from './runtimeContractsV7';
import { AdaptiveDirectorV7, type DirectorSignalV7 } from './adaptiveDirectorV7';
import { WorldStreamingV7 } from './worldStreamingV7';
import { RenderCompilerV7, type RenderCandidateV7 } from './renderCompilerV7';
import { InputCommandRouterV7, installDefaultBindingsV7, type InputFrameV7 } from './inputCommandV7';
import { QuestRuntimeV7 } from './questRuntimeV7';
import { RuntimeTelemetryV7 } from './runtimeTelemetryV7';

export interface RuntimeOrchestratorOptionsV7 {
  readonly id?: string;
  readonly build?: string;
  readonly fixedStepMs?: number;
  readonly maxCatchUpSteps?: number;
  readonly budget?: Partial<RuntimeBudgetV7>;
  readonly now?: () => number;
  readonly hooks?: RuntimeHooksV7;
}

export interface RuntimeHooksV7 {
  readonly onPhase?: (phase: RuntimeModeV7) => void;
  readonly onFrame?: (packet: RenderPacketV7) => void;
  readonly onError?: (error: Error) => void;
}

export interface RuntimeFrameInputV7 {
  readonly deltaMs: number;
  readonly camera: RenderViewV7;
  readonly input?: InputFrameV7;
  readonly candidates?: readonly RenderCandidateV7[];
  readonly center?: Vec3V7;
  readonly centerVelocity?: Vec3V7;
  readonly signal?: DirectorSignalV7;
}

export interface RuntimeFrameResultV7 {
  readonly frame: FrameV7;
  readonly tick: ReturnType<typeof tickV7>;
  readonly simulationSteps: number;
  readonly alpha: number;
  readonly quality: QualityTierV7;
  readonly packet: RenderPacketV7;
  readonly phase: RuntimeModeV7;
  readonly inputAccepted: boolean;
  readonly streamActions: number;
  readonly checksum: string;
}

const DEFAULT_BUDGET: RuntimeBudgetV7 = Object.freeze({
  cpuMs: 7,
  gpuMs: 8,
  networkBytes: 256 * 1024,
  assetBytes: 64 * 1024 * 1024,
  drawCalls: 900,
  triangles: 1_500_000,
  visibleEntities: 2400,
  simulationSteps: 2,
});

export class RuntimeOrchestratorV7 {
  readonly identity: RuntimeIdentityV7;
  readonly fixedStepMs: number;
  readonly maxCatchUpSteps: number;
  readonly director: AdaptiveDirectorV7;
  readonly streaming: WorldStreamingV7;
  readonly renderer: RenderCompilerV7;
  readonly input: InputCommandRouterV7;
  readonly quests: QuestRuntimeV7;
  readonly telemetry: RuntimeTelemetryV7;
  #phase: RuntimeModeV7 = 'boot';
  #inputMode: InputModeV7 = 'gameplay';
  #frame = 0;
  #tick = 0;
  #accumulatorMs = 0;
  #now: () => number;
  #startedAt: number;
  #errors: string[] = [];
  #hooks: RuntimeHooksV7 | undefined;

  constructor(options: RuntimeOrchestratorOptionsV7 = {}) {
    this.#now = options.now ?? (() => Date.now());
    this.#startedAt = this.#now();
    this.#hooks = options.hooks;
    this.identity = Object.freeze({ id: runtimeIdV7(options.id ?? `runtime-v7-${this.#startedAt}`), build: options.build ?? 'modern-v7', protocol: 7, startedAt: this.#startedAt });
    this.fixedStepMs = Math.max(4, options.fixedStepMs ?? 16.6666667);
    this.maxCatchUpSteps = Math.max(1, Math.trunc(options.maxCatchUpSteps ?? 4));
    const budget: RuntimeBudgetV7 = Object.freeze({ ...DEFAULT_BUDGET, ...(options.budget ?? {}) });
    this.director = new AdaptiveDirectorV7({ budget, now: this.#now, initialQuality: 'high' });
    this.streaming = new WorldStreamingV7({ now: this.#now });
    this.renderer = new RenderCompilerV7({ now: this.#now });
    this.input = new InputCommandRouterV7();
    installDefaultBindingsV7(this.input);
    this.quests = new QuestRuntimeV7();
    this.telemetry = new RuntimeTelemetryV7({ now: this.#now });
    this.#setPhase('loading');
  }

  start(): void {
    if (this.#phase === 'running') return;
    if (this.#phase === 'failed' || this.#phase === 'stopped') throw new Error(`Cannot start runtime from ${this.#phase}`);
    this.#setPhase('running');
  }

  pause(): void { if (this.#phase === 'running') this.#setPhase('paused'); }
  resume(): void { if (this.#phase === 'paused') this.#setPhase('running'); }
  stop(): void { if (this.#phase !== 'stopped') this.#setPhase('stopped'); }
  phase(): RuntimeModeV7 { return this.#phase; }
  inputMode(): InputModeV7 { return this.#inputMode; }
  setInputMode(mode: InputModeV7): void { this.#inputMode = mode; }
  frame(): number { return this.#frame; }
  tick(): number { return this.#tick; }

  step(input: RuntimeFrameInputV7): RuntimeFrameResultV7 {
    if (this.#phase !== 'running') throw new Error(`Runtime is not running: ${this.#phase}`);
    try {
      this.#frame += 1;
      const delta = Math.max(0, Math.min(250, Number(input.deltaMs) || 0));
      this.#accumulatorMs += delta;
      let simulationSteps = 0;
      while (this.#accumulatorMs >= this.fixedStepMs && simulationSteps < this.maxCatchUpSteps) {
        this.#tick += 1;
        this.#accumulatorMs -= this.fixedStepMs;
        simulationSteps += 1;
        this.telemetry.counter('simulation.steps', 1, this.#tick);
      }
      if (simulationSteps === this.maxCatchUpSteps && this.#accumulatorMs >= this.fixedStepMs) this.#accumulatorMs = 0;
      const alpha = this.#accumulatorMs / this.fixedStepMs;
      let inputAccepted = true;
      if (input.input) {
        const decision = this.input.decide(input.input);
        inputAccepted = decision.accepted;
        this.telemetry.counter(decision.accepted ? 'input.accepted' : 'input.rejected', 1, this.#tick);
      }
      const center = input.center ?? input.camera.position;
      const streamActions = this.streaming.plan(center, input.centerVelocity ?? { x: 0, y: 0, z: 0 });
      const signal = input.signal ?? {
        cpuMs: 0,
        gpuMs: 0,
        frameMs: delta,
        memoryBytes: 0,
        networkKbps: 0,
        loadedAssets: this.streaming.cells().filter((cell) => cell.loaded).length,
        visibleEntities: input.candidates?.length ?? 0,
        simulationDebtMs: Math.max(0, this.#accumulatorMs - this.fixedStepMs),
      };
      const decision = this.director.sample(signal);
      const packet = this.renderer.compile(this.#frame, this.#tick, decision.quality, { ...input.camera, renderScale: decision.renderScale }, input.candidates ?? []);
      this.telemetry.sample('render.items', packet.items.length, 'count', this.#tick);
      this.telemetry.sample('render.batches', packet.batches, 'count', this.#tick);
      const result = Object.freeze({
        frame: frameV7(this.#frame),
        tick: tickV7(this.#tick),
        simulationSteps,
        alpha,
        quality: decision.quality,
        packet,
        phase: this.#phase,
        inputAccepted,
        streamActions: streamActions.length,
        checksum: checksumV7({ frame: this.#frame, tick: this.#tick, packet, quality: decision.quality, inputAccepted }),
      });
      this.telemetry.event('runtime.frame', this.#tick, 'engine', { frame: this.#frame, steps: simulationSteps, quality: decision.quality, inputAccepted });
      this.#hooks?.onFrame?.(packet);
      return result;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.#errors.push(error.message);
      if (this.#errors.length > 32) this.#errors.shift();
      this.#phase = 'failed';
      this.#hooks?.onError?.(error);
      throw error;
    }
  }

  diagnostics(): RuntimeDiagnosticsV7 {
    const usage: RuntimeUsageV7 = {
      cpuMs: 0,
      gpuMs: 0,
      networkBytes: 0,
      assetBytes: this.streaming.residentBytes(),
      drawCalls: 0,
      triangles: 0,
      visibleEntities: 0,
      simulationSteps: 0,
      frameMs: 0,
      activeEntities: 0,
      queuedAssets: this.streaming.snapshot().tickets.length,
      pendingCommands: this.input.pendingTicks().length,
      memoryBytes: this.streaming.residentBytes(),
    };
    return Object.freeze({ identity: this.identity, phase: this.#phase, tick: tickV7(this.#tick), frame: frameV7(this.#frame), health: this.director.health(usage), usage, activeCells: this.streaming.cells().filter((cell) => cell.desired).length, loadedAssets: this.streaming.cells().filter((cell) => cell.loaded).length, peers: 0, quests: this.quests.active().length, encounters: 0, recentErrors: Object.freeze(this.#errors.slice()) });
  }

  telemetrySnapshot(): ReturnType<RuntimeTelemetryV7['snapshot']> { return this.telemetry.snapshot(); }

  #setPhase(phase: RuntimeModeV7): void {
    this.#phase = phase;
    this.#hooks?.onPhase?.(phase);
  }
}
