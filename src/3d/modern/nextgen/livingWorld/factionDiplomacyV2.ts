import { clamp } from '../types.ts';
import type { Tick } from '../types.ts';
import {
  factionId,
  relationTier,
  type DiplomacyDecision,
  type FactionId,
  type FactionProfile,
  type FactionRelation,
  type RelationTier,
  type SettlementSnapshot,
} from './livingWorldTypes.ts';

export interface FactionDiplomacyPolicy {
  readonly warThreshold: number;
  readonly peaceThreshold: number;
  readonly allianceThreshold: number;
  readonly tradeThreshold: number;
  readonly tensionDecay: number;
  readonly trustDecay: number;
  readonly borderWeight: number;
  readonly powerWeight: number;
  readonly aggressionWeight: number;
  readonly maxDecisionsPerTick: number;
}

export const DEFAULT_FACTION_DIPLOMACY_POLICY: FactionDiplomacyPolicy = {
  warThreshold: 78,
  peaceThreshold: 58,
  allianceThreshold: 72,
  tradeThreshold: 45,
  tensionDecay: 0.35,
  trustDecay: 0.08,
  borderWeight: 0.22,
  powerWeight: 0.2,
  aggressionWeight: 0.26,
  maxDecisionsPerTick: 32,
};

export interface FactionDiplomacyInput {
  readonly tick: Tick;
  readonly factions: readonly FactionProfile[];
  readonly relations: readonly FactionRelation[];
  readonly settlements: readonly SettlementSnapshot[];
}

export interface FactionDiplomacyOutput {
  readonly relations: readonly FactionRelation[];
  readonly decisions: readonly DiplomacyDecision[];
  readonly wars: readonly [FactionId, FactionId][];
  readonly alliances: readonly [FactionId, FactionId][];
  readonly digest: number;
}

function relationKey(a: FactionId, b: FactionId): string {
  return `${String(a)}::${String(b)}`;
}

function averageSettlementMetric(faction: FactionProfile, settlements: readonly SettlementSnapshot[], selector: (settlement: SettlementSnapshot) => number): number {
  const owned = settlements.filter((settlement) => faction.settlements.includes(settlement.profile.id));
  if (owned.length === 0) return 50;
  return owned.reduce((sum, settlement) => sum + selector(settlement), 0) / owned.length;
}

function borderPressure(from: FactionProfile, to: FactionProfile, settlements: readonly SettlementSnapshot[]): number {
  const ours = settlements.filter((settlement) => from.settlements.includes(settlement.profile.id));
  const theirs = settlements.filter((settlement) => to.settlements.includes(settlement.profile.id));
  if (!ours.length || !theirs.length) return 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (const left of ours) for (const right of theirs) {
    const distance = Math.hypot(left.profile.position.x - right.profile.position.x, left.profile.position.z - right.profile.position.z);
    nearest = Math.min(nearest, distance);
  }
  return Math.max(0, 100 - nearest / 150);
}

function relationBaseline(from: FactionProfile, to: FactionProfile, settlements: readonly SettlementSnapshot[], policy: FactionDiplomacyPolicy): number {
  const militaryGap = Math.abs(from.militaryPower - to.militaryPower) / Math.max(1, from.militaryPower + to.militaryPower) * 100;
  const economicGap = Math.abs(from.economicPower - to.economicPower) / Math.max(1, from.economicPower + to.economicPower) * 100;
  const border = borderPressure(from, to, settlements);
  const aggression = (from.aggression + to.aggression) * 50;
  const strategicFriction = Math.min(100, (militaryGap * policy.powerWeight + economicGap * 0.08 + border * policy.borderWeight + aggression * policy.aggressionWeight));
  return clamp(-strategicFriction, -100, 0);
}

function nextTierScore(current: FactionRelation, from: FactionProfile, to: FactionProfile, settlements: readonly SettlementSnapshot[], policy: FactionDiplomacyPolicy): number {
  const baseline = relationBaseline(from, to, settlements, policy);
  const powerBalance = 50 - Math.abs(from.militaryPower - to.militaryPower) / Math.max(1, from.militaryPower + to.militaryPower) * 50;
  const trust = current.trust * 0.25;
  const trade = current.trade * 0.18;
  const tension = current.tension * 0.35;
  const honor = ((from.honor + to.honor) * 50 - 50) * 0.12;
  return clamp(current.score * 0.62 + baseline * 0.12 + powerBalance * 0.18 + trust + trade + honor - tension, -100, 100);
}

function decisionFor(relation: FactionRelation, from: FactionProfile, to: FactionProfile, policy: FactionDiplomacyPolicy): DiplomacyDecision {
  const asymmetry = from.militaryPower - to.militaryPower;
  const defensivePressure = relation.borderPressure * 0.25 + relation.tension * 0.45;
  if (relation.tier === 'war' && relation.score > -policy.peaceThreshold && relation.trust > 25) return { from: from.id, to: to.id, action: 'offer-peace', score: relation.score, reason: 'war-cost has exceeded strategic benefit' };
  if (relation.tier !== 'war' && relation.score < -policy.warThreshold && asymmetry > -15) return { from: from.id, to: to.id, action: 'declare-war', score: -relation.score + defensivePressure, reason: 'high tension with acceptable power balance' };
  if (relation.tier === 'friendly' && relation.trust > policy.allianceThreshold && relation.tension < 20) return { from: from.id, to: to.id, action: 'alliance', score: relation.score + relation.trust, reason: 'high trust and low tension' };
  if (relation.score > 5 && relation.trade > policy.tradeThreshold) return { from: from.id, to: to.id, action: 'trade', score: relation.score + relation.trade, reason: 'mutual economic utility' };
  if (relation.tension > 65) return { from: from.id, to: to.id, action: 'threaten', score: relation.tension, reason: 'border and security pressure require signalling' };
  return { from: from.id, to: to.id, action: 'ignore', score: relation.score, reason: 'no diplomatic action exceeds the decision threshold' };
}

export class FactionDiplomacyV2 {
  readonly #policy: FactionDiplomacyPolicy;
  #lastOutput: FactionDiplomacyOutput | undefined;

  constructor(policy: Partial<FactionDiplomacyPolicy> = {}) {
    this.#policy = { ...DEFAULT_FACTION_DIPLOMACY_POLICY, ...policy };
  }

  step(input: FactionDiplomacyInput): FactionDiplomacyOutput {
    const factions = input.factions.slice(0, 32).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const factionMap = new Map(factions.map((faction) => [faction.id, faction]));
    const relationMap = new Map<string, FactionRelation>();
    for (const relation of input.relations) relationMap.set(relationKey(relation.from, relation.to), { ...relation });
    for (const from of factions) {
      for (const to of factions) {
        if (from.id === to.id) continue;
        const key = relationKey(from.id, to.id);
        const existing = relationMap.get(key) ?? {
          from: from.id,
          to: to.id,
          score: 0,
          tier: 'neutral',
          trust: 50,
          tension: 0,
          trade: 0,
          borderPressure: 0,
          casusBelli: 0,
          lastChangedTick: input.tick,
        } satisfies FactionRelation;
        const nextScore = nextTierScore(existing, from, to, input.settlements, this.#policy);
        const nextBorder = borderPressure(from, to, input.settlements);
        const economicBenefit = averageSettlementMetric(from, input.settlements, (settlement) => settlement.prosperity) - averageSettlementMetric(to, input.settlements, (settlement) => settlement.prosperity);
        let trust = clamp(existing.trust + (existing.trade > 20 ? 0.15 : -this.#policy.trustDecay * 0.1) - Math.max(0, nextBorder - existing.borderPressure) * 0.02, 0, 100);
        let tension = clamp(existing.tension + nextBorder * this.#policy.borderWeight * 0.02 - this.#policy.tensionDecay - Math.max(0, existing.trust - 70) * 0.01, 0, 100);
        let trade = clamp(existing.trade + (economicBenefit > -15 ? 0.5 : -0.35) - (tension > 70 ? 0.8 : 0), 0, 100);
        const currentTier = existing.tier;
        const nextRelation: FactionRelation = {
          ...existing,
          score: nextScore,
          tier: relationTier(nextScore),
          trust,
          tension,
          trade,
          borderPressure: nextBorder,
          casusBelli: clamp(existing.casusBelli + (nextScore < -35 ? 0.45 : -0.2), 0, 100),
          lastChangedTick: currentTier === relationTier(nextScore) && Math.abs(nextScore - existing.score) < 1 ? existing.lastChangedTick : input.tick,
        };
        if (nextRelation.tier === 'war') { trust *= 0.8; trade *= 0.25; }
        relationMap.set(key, { ...nextRelation, trust, trade });
      }
    }

    const decisions: DiplomacyDecision[] = [];
    for (const relation of relationMap.values()) {
      const from = factionMap.get(relation.from);
      const to = factionMap.get(relation.to);
      if (!from || !to) continue;
      const decision = decisionFor(relation, from, to, this.#policy);
      if (decision.action !== 'ignore') decisions.push(decision);
    }
    decisions.sort((a, b) => b.score - a.score || String(a.from).localeCompare(String(b.from)) || String(a.to).localeCompare(String(b.to)));
    decisions.splice(this.#policy.maxDecisionsPerTick);

    const wars: [FactionId, FactionId][] = [];
    const alliances: [FactionId, FactionId][] = [];
    for (const decision of decisions) {
      if (decision.action === 'declare-war') wars.push([factionId(String(decision.from)), factionId(String(decision.to))]);
      if (decision.action === 'alliance') alliances.push([factionId(String(decision.from)), factionId(String(decision.to))]);
    }
    let digest = Number(tickValue(Number(input.tick)));
    for (const relation of [...relationMap.values()].sort((a, b) => relationKey(a.from, a.to).localeCompare(relationKey(b.from, b.to)))) {
      digest ^= Math.round(relation.score * 10);
      digest ^= Math.round(relation.trust * 7);
      digest ^= Math.round(relation.tension * 3);
      digest = Math.imul(digest >>> 0, 16777619);
    }
    const output = { relations: [...relationMap.values()], decisions, wars, alliances, digest: digest >>> 0 };
    this.#lastOutput = output;
    return { ...output, relations: output.relations.map((relation) => ({ ...relation })), decisions: [...decisions], wars: wars.map((pair) => [...pair] as [FactionId, FactionId]), alliances: alliances.map((pair) => [...pair] as [FactionId, FactionId]) };
  }

  lastOutput(): FactionDiplomacyOutput | undefined {
    return this.#lastOutput ? { ...this.#lastOutput, relations: [...this.#lastOutput.relations], decisions: [...this.#lastOutput.decisions], wars: this.#lastOutput.wars.map((pair) => [...pair] as [FactionId, FactionId]), alliances: this.#lastOutput.alliances.map((pair) => [...pair] as [FactionId, FactionId]) } : undefined;
  }

  policy(): FactionDiplomacyPolicy { return { ...this.#policy }; }
}
