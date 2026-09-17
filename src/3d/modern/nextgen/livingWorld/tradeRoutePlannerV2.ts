import { clamp } from '../types.ts';
import {
  type ResourceKind,
  type SettlementId,
  type SettlementSnapshot,
  type TradeRoute,
} from './livingWorldTypes.ts';

export interface TradeRoutePolicy {
  readonly maxRoutes: number;
  readonly maxDistanceMeters: number;
  readonly riskThreshold: number;
  readonly routeCapacityPerPopulation: number;
  readonly prosperityWeight: number;
  readonly scarcityWeight: number;
  readonly distanceWeight: number;
  readonly securityWeight: number;
}

export const DEFAULT_TRADE_ROUTE_POLICY: TradeRoutePolicy = {
  maxRoutes: 256,
  maxDistanceMeters: 24000,
  riskThreshold: 0.82,
  routeCapacityPerPopulation: 0.005,
  prosperityWeight: 0.32,
  scarcityWeight: 0.44,
  distanceWeight: 0.000025,
  securityWeight: 0.18,
};

export interface TradeRoutePlannerInput {
  readonly settlements: readonly SettlementSnapshot[];
  readonly roadGraph?: readonly { from: SettlementId; to: SettlementId; distanceMeters: number; quality: number }[];
  readonly factionWarPairs?: readonly [string, string][];
}

export interface TradeRoutePlannerOutput {
  readonly routes: readonly TradeRoute[];
  readonly digest: number;
}

const RESOURCE_KINDS: readonly ResourceKind[] = ['food', 'wood', 'stone', 'iron', 'gold', 'water', 'knowledge', 'influence'];

function stockNeed(settlement: SettlementSnapshot, kind: ResourceKind): number {
  const stock = settlement.economy.stocks[kind];
  if (kind === 'food') return Math.max(0, settlement.population.total * 0.025 * 12 - stock);
  if (kind === 'water') return Math.max(0, settlement.population.total * 0.018 * 8 - stock);
  return Math.max(0, settlement.population.total * 0.01 - stock);
}

function stockSurplus(settlement: SettlementSnapshot, kind: ResourceKind): number {
  const stock = settlement.economy.stocks[kind];
  if (kind === 'food') return Math.max(0, stock - settlement.population.total * 0.025 * 16);
  if (kind === 'water') return Math.max(0, stock - settlement.population.total * 0.018 * 12);
  return Math.max(0, stock - settlement.population.total * 0.01 * 1.5);
}

function pairDistance(a: SettlementSnapshot, b: SettlementSnapshot): number {
  return Math.hypot(a.profile.position.x - b.profile.position.x, a.profile.position.z - b.profile.position.z);
}

function warBetween(a: SettlementSnapshot, b: SettlementSnapshot, pairs: readonly [string, string][], factionOf: Map<SettlementId, string>): boolean {
  const from = factionOf.get(a.profile.id);
  const to = factionOf.get(b.profile.id);
  if (!from || !to) return false;
  return pairs.some((pair) => (pair[0] === from && pair[1] === to) || (pair[0] === to && pair[1] === from));
}

export class TradeRoutePlannerV2 {
  readonly #policy: TradeRoutePolicy;
  #lastOutput: TradeRoutePlannerOutput | undefined;

  constructor(policy: Partial<TradeRoutePolicy> = {}) {
    this.#policy = { ...DEFAULT_TRADE_ROUTE_POLICY, ...policy };
  }

  plan(input: TradeRoutePlannerInput): TradeRoutePlannerOutput {
    const settlements = [...input.settlements].sort((a, b) => String(a.profile.id).localeCompare(String(b.profile.id)));
    const factionOf = new Map<SettlementId, string>();
    const routeCandidates = [...(input.roadGraph ?? [])];
    const routes: TradeRoute[] = [];

    const addCandidate = (from: SettlementSnapshot, to: SettlementSnapshot, distanceMeters: number, quality: number): void => {
      if (from.profile.id === to.profile.id || distanceMeters > this.#policy.maxDistanceMeters) return;
      if (routes.length >= this.#policy.maxRoutes) return;
      if (warBetween(from, to, input.factionWarPairs ?? [], factionOf)) return;
      const needs = RESOURCE_KINDS.map((kind) => ({ kind, need: stockNeed(to, kind), surplus: stockSurplus(from, kind), price: to.economy.prices[kind] })).filter((item) => item.need > 0 && item.surplus > 0);
      if (!needs.length) return;
      needs.sort((a, b) => (b.need * b.price - a.need * a.price) - (b.surplus * b.price - a.surplus * a.price) || String(a.kind).localeCompare(String(b.kind)));
      const preferred = needs[0]!;
      const midpointSecurity = (from.security + to.security) / 200;
      const risk = clamp(1 - midpointSecurity + distanceMeters / this.#policy.maxDistanceMeters * 0.35 + (1 - quality) * 0.25, 0, 1);
      if (risk > this.#policy.riskThreshold) return;
      const utility = clamp(
        preferred.need * this.#policy.scarcityWeight
          + Math.max(0, to.prosperity - from.prosperity) * this.#policy.prosperityWeight
          + midpointSecurity * this.#policy.securityWeight
          - distanceMeters * this.#policy.distanceWeight,
        0,
        1000,
      );
      if (utility <= 1) return;
      const capacity = Math.max(1, Math.floor(Math.min(from.economy.tradeCapacity, to.economy.tradeCapacity, from.population.total * this.#policy.routeCapacityPerPopulation) * (1 - risk)));
      routes.push({ id: `route:${String(from.profile.id)}>${String(to.profile.id)}:${preferred.kind}`, from: from.profile.id, to: to.profile.id, distanceMeters, capacity, risk, preferredResource: preferred.kind, active: true });
    };

    if (routeCandidates.length) {
      for (const edge of routeCandidates.sort((a, b) => `${String(a.from)}:${String(a.to)}`.localeCompare(`${String(b.from)}:${String(b.to)}`))) {
        const from = settlements.find((settlement) => settlement.profile.id === edge.from);
        const to = settlements.find((settlement) => settlement.profile.id === edge.to);
        if (from && to) addCandidate(from, to, edge.distanceMeters, edge.quality);
        if (from && to) addCandidate(to, from, edge.distanceMeters, edge.quality);
      }
    } else {
      for (let left = 0; left < settlements.length; left += 1) {
        for (let right = left + 1; right < settlements.length; right += 1) {
          const from = settlements[left]!;
          const to = settlements[right]!;
          addCandidate(from, to, pairDistance(from, to), 0.8);
          addCandidate(to, from, pairDistance(from, to), 0.8);
          if (routes.length >= this.#policy.maxRoutes) break;
        }
        if (routes.length >= this.#policy.maxRoutes) break;
      }
    }

    routes.sort((a, b) => b.capacity * (1 - b.risk) - a.capacity * (1 - a.risk) || a.id.localeCompare(b.id));
    routes.splice(this.#policy.maxRoutes);
    let digest = routes.length;
    for (const route of routes) digest = ((digest * 16777619) ^ Math.round(route.distanceMeters) ^ Math.round(route.risk * 10000) ^ route.capacity) >>> 0;
    const output = { routes, digest: digest >>> 0 };
    this.#lastOutput = output;
    return { ...output, routes: routes.map((route) => ({ ...route })) };
  }

  lastOutput(): TradeRoutePlannerOutput | undefined {
    return this.#lastOutput ? { ...this.#lastOutput, routes: this.#lastOutput.routes.map((route) => ({ ...route })) } : undefined;
  }

  policy(): TradeRoutePolicy { return { ...this.#policy }; }
}
