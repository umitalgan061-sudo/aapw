import { hashString, mixHash, clamp } from '../types.ts';
import type { Tick } from '../types.ts';
import {
  type ClimateBand,
  type SettlementSnapshot,
  type WorldEvent,
  type WorldEventDecision,
} from './livingWorldTypes.ts';

export interface EventOrchestratorPolicy {
  readonly droughtProbability: number;
  readonly stormProbability: number;
  readonly shortageProbability: number;
  readonly discoveryProbability: number;
  readonly festivalProbability: number;
  readonly rebellionThreshold: number;
  readonly famineThreshold: number;
  readonly maxEvents: number;
}

export const DEFAULT_EVENT_ORCHESTRATOR_POLICY: EventOrchestratorPolicy = {
  droughtProbability: 0.004,
  stormProbability: 0.003,
  shortageProbability: 0.006,
  discoveryProbability: 0.002,
  festivalProbability: 0.005,
  rebellionThreshold: 32,
  famineThreshold: 0.28,
  maxEvents: 64,
};

export interface EventOrchestratorInput {
  readonly tick: Tick;
  readonly settlements: readonly SettlementSnapshot[];
  readonly season: 'winter' | 'spring' | 'summer' | 'autumn';
  readonly climatePressure?: number;
  readonly ecologicalStress?: number;
  readonly activeWars?: readonly string[];
}

export interface EventOrchestratorOutput {
  readonly decisions: readonly WorldEventDecision[];
  readonly events: readonly WorldEvent[];
  readonly crisisCount: number;
  readonly digest: number;
}

function deterministicRoll(tick: number, salt: string, subject: string): number {
  return (hashString(`${tick}:${salt}:${subject}`) % 100000) / 100000;
}

function climateRisk(climate: ClimateBand, season: EventOrchestratorInput['season']): number {
  if (climate === 'polar') return season === 'winter' ? 1.45 : 0.65;
  if (climate === 'dry') return season === 'summer' ? 1.55 : 0.85;
  if (climate === 'hot') return season === 'summer' ? 1.25 : 0.9;
  return season === 'summer' ? 1.05 : 0.9;
}

function makeEvent(tick: Tick, index: number, decision: WorldEventDecision): WorldEvent {
  const body = {
    id: `${Number(tick)}:${index}:${decision.type}:${String(decision.subject)}`,
    tick,
    type: decision.type,
    source: decision.source,
    priority: decision.priority,
    subjects: [decision.subject],
    payload: decision.payload,
  } satisfies Omit<WorldEvent, 'checksum'>;
  let checksum = hashString(body.id);
  checksum = mixHash(checksum, Number(tick));
  checksum = mixHash(checksum, Math.round(decision.probability * 100000));
  checksum = mixHash(checksum, Math.round(decision.severity * 100000));
  return { ...body, checksum: checksum >>> 0 };
}

export class WorldEventOrchestratorV2 {
  readonly #policy: EventOrchestratorPolicy;
  #lastOutput: EventOrchestratorOutput | undefined;

  constructor(policy: Partial<EventOrchestratorPolicy> = {}) {
    this.#policy = { ...DEFAULT_EVENT_ORCHESTRATOR_POLICY, ...policy };
  }

  step(input: EventOrchestratorInput): EventOrchestratorOutput {
    const decisions: WorldEventDecision[] = [];
    const settlements = [...input.settlements].sort((a, b) => String(a.profile.id).localeCompare(String(b.profile.id)));
    const weather = clamp(input.climatePressure ?? 0, 0, 1);
    const ecology = clamp(input.ecologicalStress ?? 0, 0, 1);
    const warSet = new Set(input.activeWars ?? []);

    for (const settlement of settlements) {
      const id = String(settlement.profile.id);
      const risk = climateRisk(settlement.profile.climate, input.season);
      const foodRatio = settlement.economy.stocks.food / Math.max(1, settlement.population.total * 0.025 * 12);
      const securityRisk = 1 - settlement.security / 100;
      const pressure = clamp((1 - Math.min(1, foodRatio)) * 0.48 + securityRisk * 0.24 + weather * 0.14 + ecology * 0.14, 0, 1);

      const droughtRoll = deterministicRoll(Number(input.tick), 'drought', id);
      if (droughtRoll < this.#policy.droughtProbability * risk * (0.65 + weather) && settlement.profile.climate !== 'polar') decisions.push({ type: 'drought', source: 'climate', priority: 3, subject: settlement.profile.id, probability: this.#policy.droughtProbability * risk, severity: pressure, payload: { durationDays: Math.round(5 + pressure * 20), yieldPenalty: Number((0.18 + pressure * 0.45).toFixed(3)) } });

      const stormRoll = deterministicRoll(Number(input.tick), 'storm', id);
      if (stormRoll < this.#policy.stormProbability * (0.7 + weather * 2)) decisions.push({ type: 'storm', source: 'weather', priority: 2, subject: settlement.profile.id, probability: this.#policy.stormProbability, severity: clamp(0.3 + weather * 0.6, 0, 1), payload: { travelPenalty: Number((0.25 + weather * 0.4).toFixed(3)), durationHours: Math.round(2 + weather * 14) } });

      const shortageRoll = deterministicRoll(Number(input.tick), 'shortage', id);
      if (shortageRoll < this.#policy.shortageProbability * (1 + pressure)) {
        const kind = settlement.economy.stocks.food < settlement.economy.stocks.water ? 'food' : 'water';
        decisions.push({ type: 'shortage', source: 'economy', priority: 3, subject: settlement.profile.id, probability: this.#policy.shortageProbability, severity: pressure, payload: { resource: kind, priceShock: Number((1 + pressure * 2.5).toFixed(3)) } });
      }

      const famine = foodRatio < this.#policy.famineThreshold;
      if (famine) decisions.push({ type: 'famine', source: 'economy', priority: 4, subject: settlement.profile.id, probability: 1, severity: clamp(1 - foodRatio, 0, 1), payload: { foodRatio: Number(foodRatio.toFixed(3)), mortality: Number((0.002 + (1 - foodRatio) * 0.018).toFixed(4)) } });

      const rebellionRisk = settlement.population.morale < this.#policy.rebellionThreshold && settlement.stability < 36;
      if (rebellionRisk && warSet.size === 0) decisions.push({ type: 'rebellion', source: 'society', priority: 4, subject: settlement.profile.id, probability: 1, severity: clamp((this.#policy.rebellionThreshold - settlement.population.morale) / this.#policy.rebellionThreshold + (36 - settlement.stability) / 36, 0, 1) / 2, payload: { garrisonDemand: Math.round(settlement.population.total * 0.08), stabilityLoss: 8 } });

      const discoveryRoll = deterministicRoll(Number(input.tick), 'discovery', id);
      if (discoveryRoll < this.#policy.discoveryProbability * (0.5 + settlement.profile.strategicValue)) decisions.push({ type: 'discovery', source: 'exploration', priority: 1, subject: settlement.profile.id, probability: this.#policy.discoveryProbability, severity: 0.25 + settlement.profile.strategicValue * 0.5, payload: { knowledge: Math.round(5 + settlement.profile.strategicValue * 35), influence: Math.round(2 + settlement.profile.strategicValue * 12) } });

      const festivalRoll = deterministicRoll(Number(input.tick), 'festival', id);
      if (festivalRoll < this.#policy.festivalProbability && settlement.population.morale > 55 && settlement.economy.treasury > settlement.population.total * 0.02) decisions.push({ type: 'festival', source: 'society', priority: 1, subject: settlement.profile.id, probability: this.#policy.festivalProbability, severity: 0.2, payload: { moraleGain: 4, prosperityGain: 3, cost: Math.round(settlement.population.total * 0.01) } });

      if (decisions.length >= this.#policy.maxEvents * 2) break;
    }

    decisions.sort((a, b) => b.priority - a.priority || b.severity - a.severity || String(a.type).localeCompare(String(b.type)) || String(a.subject).localeCompare(String(b.subject)));
    const bounded = decisions.slice(0, this.#policy.maxEvents);
    const events = bounded.map((decision, index) => makeEvent(input.tick, index, decision));
    let digest = hashString(input.season);
    for (const event of events) digest = mixHash(digest, event.checksum);
    const output = { decisions: bounded, events, crisisCount: events.filter((event) => event.priority >= 3).length, digest: digest >>> 0 };
    this.#lastOutput = output;
    return { ...output, decisions: [...bounded], events: [...events] };
  }

  lastOutput(): EventOrchestratorOutput | undefined {
    return this.#lastOutput ? { ...this.#lastOutput, decisions: [...this.#lastOutput.decisions], events: [...this.#lastOutput.events] } : undefined;
  }

  policy(): EventOrchestratorPolicy { return { ...this.#policy }; }
}
