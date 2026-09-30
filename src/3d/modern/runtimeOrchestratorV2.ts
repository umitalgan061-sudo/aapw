import { AnimationAuthority, type AnimationContext, type AnimationSnapshot } from './animationAuthority.ts';
import { AiAuthority, type AiAgentState, type AiDecision } from './aiAuthority.ts';
import { CombatAuthority, type CombatEvent } from './combatAuthority.ts';
import { diagnoseRuntime, type RuntimeDiagnosticInput, type RuntimeDiagnosticSnapshot } from './runtimeDiagnosticsV2.ts';
import { RuntimeIntegrationV2, type RuntimeFrameInput, type RuntimeFrameResult, type RuntimeIntegrationOptions } from './runtimeIntegrationV2.ts';
import { RuntimeTelemetry } from './diagnostics.ts';
import { playerToNetworkEntity, encodeSnapshot, type WorldSnapshotV2 } from './networkRuntimeV2.ts';
import { WorldClock } from './worldSimulation.ts';
import { composeWeatherPresentation, type WeatherPresentationState } from './weatherRuntime.ts';

export interface OrchestratorFrame {
  readonly simulation: RuntimeFrameResult;
  readonly animation: AnimationSnapshot;
  readonly ai: readonly AiDecision[];
  readonly weather: WeatherPresentationState;
  readonly diagnostics: RuntimeDiagnosticSnapshot;
  readonly snapshot: WorldSnapshotV2;
}

export interface OrchestratorOptions extends RuntimeIntegrationOptions {
  readonly ai?: { readonly maxThinkersPerFrame?: number; readonly perceptionRadius?: number };
  readonly telemetry?: boolean;
}

export class RuntimeOrchestratorV2 {
  readonly integration: RuntimeIntegrationV2;
  readonly animation = new AnimationAuthority();
  readonly ai: AiAuthority;
  readonly telemetry = new RuntimeTelemetry();
  readonly #clock: WorldClock;
  readonly #sessionId: string;
  #sequence = 0;
  #lastFrameTimeMs = 16.67;
  #lastFrame: OrchestratorFrame | null = null;
  #disposed = false;

  constructor(options: OrchestratorOptions = {}) {
    this.integration = new RuntimeIntegrationV2(options);
    this.ai = new AiAuthority({ ...options.ai, now: options.now });
    this.#clock = new WorldClock({ seed: options.worldSeed ?? 0x57455354, now: undefined as never });
    this.#sessionId = `local-${Math.abs((options.worldSeed ?? 0x57) >>> 0).toString(36)}`;
  }

  addNpc(agent: AiAgentState): void { this.ai.register(agent); }
  removeNpc(id: string): void { this.ai.remove(id); }

  tick(input: RuntimeFrameInput): OrchestratorFrame {
    if (this.#disposed) throw new Error('Runtime orchestrator is disposed.');
    const started = typeof performance !== 'undefined' ? performance.now() : 0;
    const simulation = this.integration.tick(input);
    const player = simulation.player;
    const animationContext: AnimationContext = {
      locomotion: player.locomotion,
      speed: Math.hypot(player.velocity.x, player.velocity.z),
      grounded: player.transform.grounded,
      attack: player.locomotion === 'attack',
      stunned: player.locomotion === 'stunned',
      dead: player.locomotion === 'dead',
      aimWeight: input.player?.aimX !== undefined && input.player?.aimZ !== undefined ? Math.min(1, Math.hypot(input.player.aimX, input.player.aimZ)) : 0,
    };
    const animation = this.animation.update(animationContext, input.deltaMs);
    const ai = this.ai.tick(input.deltaMs);
    const weather = composeWeatherPresentation(simulation.time);
    const chunkMetrics = this.integration.chunks.metrics();
    const spatialMetrics = this.integration.spatial.metrics();
    const diagnosticsInput: RuntimeDiagnosticInput = {
      integration: this.integration.snapshot(),
      chunks: chunkMetrics,
      spatial: spatialMetrics,
      frameTimeMs: this.#lastFrameTimeMs,
    };
    const diagnostics = diagnoseRuntime(diagnosticsInput);
    const snapshot = encodeSnapshot({ protocol: 2, sessionId: this.#sessionId, tick: simulation.frame, ack: Math.max(0, simulation.frame - 1), createdAt: simulation.frame, entities: [playerToNetworkEntity(player)], player });
    const frame: OrchestratorFrame = Object.freeze({ simulation, animation, ai, weather, diagnostics, snapshot });
    this.#lastFrame = frame;
    this.#lastFrameTimeMs = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : started) - started);
    this.#sequence += 1;
    this.telemetry.gauge('orchestrator.frame', this.#sequence);
    this.telemetry.gauge('orchestrator.frameTimeMs', this.#lastFrameTimeMs);
    this.telemetry.gauge('orchestrator.aiDecisions', ai.length);
    this.telemetry.gauge('orchestrator.diagnosticScore', diagnostics.score);
    this.telemetry.gauge('orchestrator.weatherIntensity', weather.intensity);
    return frame;
  }

  latest(): OrchestratorFrame | null { return this.#lastFrame; }
  diagnostics(): RuntimeDiagnosticSnapshot | null { return this.#lastFrame?.diagnostics ?? null; }
  metrics(): Readonly<{ sequence: number; frameTimeMs: number; aiAgents: number; playerRevision: number; chunkActive: number; spatialItems: number; telemetryDigest: string }> {
    const integration = this.integration.snapshot();
    const chunks = this.integration.chunks.metrics();
    return Object.freeze({ sequence: this.#sequence, frameTimeMs: this.#lastFrameTimeMs, aiAgents: this.ai.metrics().agents, playerRevision: integration.playerRevision, chunkActive: chunks.active, spatialItems: integration.spatialItems, telemetryDigest: this.telemetry.snapshot().digest });
  }

  dispose(): void { if (this.#disposed) return; this.#disposed = true; this.integration.dispose(); this.animation.reset(); this.ai.values(); }
}

export const extractCombatEvents = (frame: OrchestratorFrame): readonly CombatEvent[] => frame.simulation.combatEvents;
export const extractPlayerState = (frame: OrchestratorFrame) => frame.simulation.player;
