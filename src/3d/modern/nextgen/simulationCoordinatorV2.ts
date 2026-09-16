import { EntityId, Tick, clamp, tickValue } from './types.ts';
import { ActorSimulationV2 } from './actorSimulationV2.ts';
import { InteractionRuntimeV2, TriggerRuntimeV2 } from './interactionRuntimeV2.ts';
import { RuntimePolicyV2 } from './runtimePolicyV2.ts';
import { WorldEventJournalV2 } from './worldEventJournalV2.ts';
import { WorldStreamingOrchestratorV2 } from './streamingOrchestratorV2.ts';

export type CoordinatorPhase = 'idle' | 'input' | 'simulation' | 'interactions' | 'streaming' | 'journal' | 'complete' | 'faulted';

export interface CoordinatorInput {
  deltaSeconds: number;
  interests: readonly { owner: EntityId; position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number }; viewDistance: number; priority: number }[];
  targets: Parameters<ActorSimulationV2['step']>[0];
}

export interface CoordinatorTickReport {
  tick: Tick;
  phase: CoordinatorPhase;
  elapsedMs: number;
  actorEvents: number;
  interactionEvents: number;
  streamDecisions: number;
  journalEvents: number;
  policyAccepted: boolean;
  faults: readonly CoordinatorFault[];
}

export interface CoordinatorFault {
  phase: CoordinatorPhase;
  code: string;
  message: string;
  recoverable: boolean;
}

export interface CoordinatorConfig {
  maxDeltaSeconds: number;
  maxActorsPerTick: number;
  maxStreamDecisions: number;
  maxFaults: number;
}

const DEFAULT_CONFIG: CoordinatorConfig = {
  maxDeltaSeconds: 0.25,
  maxActorsPerTick: 12000,
  maxStreamDecisions: 24,
  maxFaults: 16,
};

export class NextGenSimulationCoordinatorV2 {
  readonly actors: ActorSimulationV2;
  readonly interactions: InteractionRuntimeV2;
  readonly triggers: TriggerRuntimeV2;
  readonly streaming: WorldStreamingOrchestratorV2;
  readonly journal: WorldEventJournalV2<unknown>;
  readonly policy: RuntimePolicyV2;
  readonly #config: CoordinatorConfig;
  readonly #faults: CoordinatorFault[] = [];
  #phase: CoordinatorPhase = 'idle';
  #tick: Tick = tickValue(0);
  #lastReport: CoordinatorTickReport | undefined;

  constructor(options: {
    seed: number;
    actors?: ActorSimulationV2;
    interactions?: InteractionRuntimeV2;
    triggers?: TriggerRuntimeV2;
    streaming?: WorldStreamingOrchestratorV2;
    journal?: WorldEventJournalV2<unknown>;
    policy?: RuntimePolicyV2;
    config?: Partial<CoordinatorConfig>;
  }) {
    this.actors = options.actors ?? new ActorSimulationV2(options.seed);
    this.interactions = options.interactions ?? new InteractionRuntimeV2();
    this.triggers = options.triggers ?? new TriggerRuntimeV2();
    this.streaming = options.streaming ?? new WorldStreamingOrchestratorV2();
    this.journal = options.journal ?? new WorldEventJournalV2();
    this.policy = options.policy ?? new RuntimePolicyV2();
    this.#config = { ...DEFAULT_CONFIG, ...options.config };
  }

  get tick(): Tick { return this.#tick; }
  get phase(): CoordinatorPhase { return this.#phase; }
  get lastReport(): CoordinatorTickReport | undefined { return this.#lastReport ? { ...this.#lastReport, faults: [...this.#lastReport.faults] } : undefined; }
  get faults(): CoordinatorFault[] { return this.#faults.map((fault) => ({ ...fault })); }

  step(input: CoordinatorInput): CoordinatorTickReport {
    const started = performance.now();
    this.#faults.length = 0;
    this.#tick = tickValue(Number(this.#tick) + 1);
    const safeDelta = clamp(input.deltaSeconds, 0, this.#config.maxDeltaSeconds);
    let actorEvents = 0;
    let interactionEvents = 0;
    let streamDecisions = 0;
    let journalEvents = 0;
    let policyAccepted = true;

    try {
      this.#phase = 'input';
      for (const interest of input.interests) this.streaming.setInterest(interest);

      this.#phase = 'simulation';
      if (this.actors.actorCount <= this.#config.maxActorsPerTick) {
        actorEvents = this.actors.step(input.targets).length;
      } else {
        this.#fault('ACTOR_LIMIT', `Actor count ${this.actors.actorCount} exceeds coordinator limit`, false);
      }

      this.#phase = 'interactions';
      interactionEvents = this.interactions.events().length;
      const interactionContext = {
        actor: (input.interests[0]?.owner ?? (1 as EntityId)),
        speaker: (input.interests[0]?.owner ?? (1 as EntityId)),
        tick: Number(this.#tick),
        distance: 0,
        tags: new Set<string>(),
        flags: {},
        values: {},
      };
      this.triggers.evaluate(interactionContext);

      this.#phase = 'streaming';
      const decisions = this.streaming.plan(this.#tick);
      streamDecisions = Math.min(decisions.length, this.#config.maxStreamDecisions);

      this.#phase = 'journal';
      for (const event of this.actors.events()) {
        this.journal.append({ tick: this.#tick, kind: event.type === 'attacked' ? 'damage' : event.type === 'died' ? 'despawn' : 'spawn', source: 'actor-simulation', entity: Number(event.actor), payload: event });
        journalEvents += 1;
      }
      for (const decision of decisions.slice(0, this.#config.maxStreamDecisions)) {
        this.journal.append({ tick: this.#tick, kind: 'custom', source: 'streaming', payload: decision });
        journalEvents += 1;
      }

      this.#phase = 'complete';
      const policy = this.policy.evaluate({
        entities: this.actors.actorCount,
        commands: interactionEvents,
        events: actorEvents + interactionEvents + streamDecisions,
        networkBytesPerSecond: 0,
        largestAssetBytes: 0,
        workerRequests: streamDecisions,
      });
      policyAccepted = policy.accepted;
      if (!policyAccepted) this.#fault('POLICY_REJECTED', policy.violations.map((violation) => violation.code).join(','), true);
    } catch (error) {
      this.#fault('COORDINATOR_FAILURE', error instanceof Error ? error.message : String(error), false);
      this.#phase = 'faulted';
    }

    const report: CoordinatorTickReport = {
      tick: this.#tick,
      phase: this.#phase,
      elapsedMs: performance.now() - started,
      actorEvents,
      interactionEvents,
      streamDecisions,
      journalEvents,
      policyAccepted,
      faults: this.faults,
    };
    this.#lastReport = report;
    return { ...report, faults: [...report.faults] };
  }

  reset(): void {
    this.#tick = tickValue(0);
    this.#phase = 'idle';
    this.#faults.length = 0;
    this.#lastReport = undefined;
    this.journal.clear();
  }

  digest(): number {
    let result = Number(this.#tick) ^ this.actors.digest();
    result = (result ^ this.journal.hash()) >>> 0;
    result = (result ^ this.streaming.digest()) >>> 0;
    result = (result ^ this.policy.snapshot().checksum) >>> 0;
    return result >>> 0;
  }

  #fault(code: string, message: string, recoverable: boolean): void {
    if (this.#faults.length >= this.#config.maxFaults) return;
    this.#faults.push({ phase: this.#phase, code, message, recoverable });
  }
}

export interface CoordinatorHealth {
  status: 'healthy' | 'degraded' | 'critical';
  score: number;
  reasons: readonly string[];
}

export function coordinatorHealth(report: CoordinatorTickReport): CoordinatorHealth {
  let score = 100;
  const reasons: string[] = [];
  if (report.elapsedMs > 16.6) { score -= 20; reasons.push('tick_budget'); }
  if (report.actorEvents > 512) { score -= 15; reasons.push('actor_event_pressure'); }
  if (report.streamDecisions > 24) { score -= 10; reasons.push('stream_pressure'); }
  if (!report.policyAccepted) { score -= 25; reasons.push('policy_rejected'); }
  if (report.faults.some((fault) => !fault.recoverable)) { score -= 35; reasons.push('nonrecoverable_fault'); }
  score = clamp(score, 0, 100);
  return { status: score >= 80 ? 'healthy' : score >= 55 ? 'degraded' : 'critical', score, reasons };
}
