import { hashString, mixHash, tickValue } from '../types.ts';
import type { Tick } from '../types.ts';
import {
  addResources,
  climateMultiplier,
  DEFAULT_LIVING_WORLD_CONFIG,
  emptyResources,
  type ResourceDelta,
  type ResourceKind,
  type ResourceStock,
  type Season,
  type SettlementEconomy,
  type SettlementId,
  type SettlementProfile,
  type SettlementSnapshot,
  type TradeRoute,
  type TradeTransfer,
} from './livingWorldTypes.ts';

export interface EconomyPolicy {
  readonly baseConsumptionPerCitizen: number;
  readonly reserveFoodDays: number;
  readonly reserveWaterDays: number;
  readonly minPrice: number;
  readonly maxPrice: number;
  readonly priceElasticity: number;
  readonly productionEfficiency: number;
  readonly tradeEfficiency: number;
  readonly taxRate: number;
}

export const DEFAULT_ECONOMY_POLICY: EconomyPolicy = {
  baseConsumptionPerCitizen: 0.025,
  reserveFoodDays: 12,
  reserveWaterDays: 8,
  minPrice: 0.25,
  maxPrice: 20,
  priceElasticity: 0.7,
  productionEfficiency: 0.92,
  tradeEfficiency: 0.84,
  taxRate: 0.08,
};

export interface EconomyTickInput {
  readonly tick: Tick;
  readonly season: Season;
  readonly profiles: readonly SettlementProfile[];
  readonly settlements: readonly SettlementSnapshot[];
  readonly routes: readonly TradeRoute[];
}

export interface EconomyTickOutput {
  readonly settlements: readonly SettlementSnapshot[];
  readonly transfers: readonly TradeTransfer[];
  readonly shortages: readonly EconomyShortage[];
  readonly surpluses: readonly EconomySurplus[];
  readonly treasuryDelta: Readonly<Record<string, number>>;
  readonly digest: number;
}

export interface EconomyShortage {
  readonly settlement: SettlementId;
  readonly resource: ResourceKind;
  readonly deficit: number;
  readonly severity: number;
}

export interface EconomySurplus {
  readonly settlement: SettlementId;
  readonly resource: ResourceKind;
  readonly surplus: number;
  readonly exportable: number;
}

interface MutableSettlementEconomy extends SettlementEconomy {
  stocks: ResourceStock;
  production: ResourceStock;
  consumption: ResourceStock;
  prices: Record<ResourceKind, number>;
  treasury: number;
  debt: number;
}

const RESOURCE_KINDS: readonly ResourceKind[] = [
  'food', 'wood', 'stone', 'iron', 'gold', 'water', 'knowledge', 'influence',
];

const PRICE_BASE: Readonly<Record<ResourceKind, number>> = {
  food: 1,
  wood: 1.4,
  stone: 1.8,
  iron: 3.5,
  gold: 8,
  water: 1.2,
  knowledge: 5,
  influence: 4,
};

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function stockTotal(stock: ResourceStock): number {
  return RESOURCE_KINDS.reduce((sum, kind) => sum + stock[kind], 0);
}

function cloneEconomy(economy: SettlementEconomy): MutableSettlementEconomy {
  return {
    stocks: { ...economy.stocks },
    production: { ...economy.production },
    consumption: { ...economy.consumption },
    prices: { ...economy.prices },
    tradeCapacity: economy.tradeCapacity,
    treasury: economy.treasury,
    debt: economy.debt,
  };
}

function normalizePrices(prices: Record<ResourceKind, number>, policy: EconomyPolicy): Record<ResourceKind, number> {
  for (const kind of RESOURCE_KINDS) prices[kind] = Math.min(policy.maxPrice, Math.max(policy.minPrice, finite(prices[kind], PRICE_BASE[kind])));
  return prices;
}

function productionFor(
  profile: SettlementProfile,
  population: SettlementSnapshot['population'],
  season: Season,
  policy: EconomyPolicy,
): ResourceStock {
  const climate = climateMultiplier(profile.climate, season);
  const workers = Math.max(1, population.workers);
  const skill = 0.65 + population.specialists / Math.max(1, population.total) * 0.55;
  const fertility = 0.4 + profile.fertility * 1.5;
  const water = 0.25 + profile.waterAccess * 1.35;
  const defense = 0.5 + profile.defensibility * 0.25;
  return {
    food: workers * policy.baseConsumptionPerCitizen * 60 * fertility * climate * policy.productionEfficiency,
    wood: workers * 0.013 * (1 - profile.coastal * 0.15) * climate * policy.productionEfficiency,
    stone: workers * 0.007 * (0.65 + profile.elevationMeters / 1800) * policy.productionEfficiency,
    iron: workers * 0.004 * (0.4 + profile.elevationMeters / 2400 + skill * 0.2) * policy.productionEfficiency,
    gold: workers * 0.00055 * (0.6 + profile.strategicValue * 0.8) * policy.productionEfficiency,
    water: population.total * 0.018 * water * climate,
    knowledge: population.specialists * 0.011 * (0.8 + profile.connectedRoads * 0.025) * policy.productionEfficiency,
    influence: (population.soldiers * 0.002 + population.specialists * 0.004) * defense,
  };
}

function consumptionFor(population: SettlementSnapshot['population'], policy: EconomyPolicy): ResourceStock {
  const citizen = Math.max(0, population.total) * policy.baseConsumptionPerCitizen;
  const soldier = Math.max(0, population.soldiers) * citizen * 0.55;
  const specialist = Math.max(0, population.specialists) * citizen * 0.18;
  return {
    food: citizen + soldier * 0.28,
    wood: Math.max(0, population.total * 0.0025),
    stone: Math.max(0, population.total * 0.0014),
    iron: Math.max(0, population.soldiers * 0.004 + population.specialists * 0.001),
    gold: 0,
    water: citizen * 0.7,
    knowledge: Math.max(0, specialist * 0.08),
    influence: Math.max(0, population.soldiers * 0.0012),
  };
}

function targetStock(populationTotal: number, kind: ResourceKind, policy: EconomyPolicy): number {
  if (kind === 'food') return populationTotal * policy.baseConsumptionPerCitizen * policy.reserveFoodDays;
  if (kind === 'water') return populationTotal * policy.baseConsumptionPerCitizen * policy.reserveWaterDays;
  if (kind === 'wood') return populationTotal * 0.02;
  if (kind === 'stone') return populationTotal * 0.01;
  if (kind === 'iron') return populationTotal * 0.008;
  return populationTotal * 0.002;
}

function priceFor(stock: number, target: number, base: number, policy: EconomyPolicy): number {
  const scarcity = target <= 0 ? 1 : Math.max(-0.9, Math.min(4, 1 - stock / target));
  const multiplier = Math.exp(scarcity * policy.priceElasticity);
  return Math.min(policy.maxPrice, Math.max(policy.minPrice, base * multiplier));
}

function severity(deficit: number, target: number): number {
  if (target <= 0) return deficit > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, deficit / target));
}

function mutatePopulation(settlement: SettlementSnapshot, shortage: readonly EconomyShortage[], surplus: readonly EconomySurplus[]): SettlementSnapshot['population'] {
  const foodShort = shortage.find((item) => item.resource === 'food' && item.settlement === settlement.profile.id);
  const waterShort = shortage.find((item) => item.resource === 'water' && item.settlement === settlement.profile.id);
  const hasSurplus = surplus.some((item) => item.settlement === settlement.profile.id && item.resource === 'food' && item.exportable > 0);
  let health = settlement.population.health;
  let morale = settlement.population.morale;
  let migrationPressure = settlement.population.migrationPressure;
  if (foodShort) { health -= foodShort.severity * 4; morale -= foodShort.severity * 7; migrationPressure += foodShort.severity * 8; }
  if (waterShort) { health -= waterShort.severity * 5; morale -= waterShort.severity * 5; migrationPressure += waterShort.severity * 10; }
  if (hasSurplus) { morale += 0.7; migrationPressure -= 1.2; }
  const clampedHealth = Math.min(100, Math.max(0, health));
  const clampedMorale = Math.min(100, Math.max(0, morale));
  return { ...settlement.population, health: clampedHealth, morale: clampedMorale, migrationPressure: Math.min(100, Math.max(0, migrationPressure)) };
}

function recomputeSettlementState(settlement: SettlementSnapshot, population: SettlementSnapshot['population'], economy: MutableSettlementEconomy, shortages: readonly EconomyShortage[]): SettlementSnapshot {
  const food = economy.stocks.food / Math.max(1, targetStock(population.total, 'food', DEFAULT_ECONOMY_POLICY));
  const water = economy.stocks.water / Math.max(1, targetStock(population.total, 'water', DEFAULT_ECONOMY_POLICY));
  const stability = Math.min(100, Math.max(0, settlement.stability + (population.morale - 50) * 0.04 - shortages.filter((item) => item.settlement === settlement.profile.id).reduce((sum, item) => sum + item.severity * 3, 0)));
  const security = Math.min(100, Math.max(0, settlement.security + (population.health - 50) * 0.02));
  const prosperity = Math.min(100, Math.max(0, settlement.prosperity + (food + water) * 0.8 + (economy.treasury > 0 ? 0.2 : -0.4)));
  const localCrisis = shortages.some((item) => item.settlement === settlement.profile.id && item.severity > 0.75);
  const state = localCrisis && food < 0.3 ? 'starving' : security < 25 ? 'besieged' : prosperity > 78 ? 'thriving' : stability < 35 ? 'strained' : 'stable';
  return { ...settlement, population, economy: { ...economy, stocks: { ...economy.stocks }, production: { ...economy.production }, consumption: { ...economy.consumption }, prices: { ...economy.prices } }, security, stability, prosperity, state };
}

export class EconomySimulationV2 {
  readonly #policy: EconomyPolicy;
  readonly #config: typeof DEFAULT_LIVING_WORLD_CONFIG;
  #lastOutput: EconomyTickOutput | undefined;

  constructor(policy: Partial<EconomyPolicy> = {}) {
    this.#policy = { ...DEFAULT_ECONOMY_POLICY, ...policy };
    this.#config = DEFAULT_LIVING_WORLD_CONFIG;
  }

  step(input: EconomyTickInput): EconomyTickOutput {
    const profileById = new Map(input.profiles.map((profile) => [profile.id, profile]));
    const working = new Map<SettlementId, SettlementSnapshot>();
    for (const settlement of input.settlements.slice(0, this.#config.settlementCap)) {
      const profile = profileById.get(settlement.profile.id) ?? settlement.profile;
      const economy = cloneEconomy(settlement.economy);
      const production = productionFor(profile, settlement.population, input.season, this.#policy);
      const consumption = consumptionFor(settlement.population, this.#policy);
      economy.production = production;
      economy.consumption = consumption;
      const delta: ResourceDelta = {};
      for (const kind of RESOURCE_KINDS) delta[kind] = production[kind] - consumption[kind];
      economy.stocks = addResources(economy.stocks, delta);
      working.set(settlement.profile.id, { ...settlement, economy, population: { ...settlement.population } });
    }

    const shortages: EconomyShortage[] = [];
    const surpluses: EconomySurplus[] = [];
    for (const settlement of working.values()) {
      const economy = cloneEconomy(settlement.economy);
      for (const kind of RESOURCE_KINDS) {
        const target = targetStock(settlement.population.total, kind, this.#policy);
        economy.prices[kind] = priceFor(economy.stocks[kind], target, PRICE_BASE[kind], this.#policy);
        const deficit = Math.max(0, target - economy.stocks[kind]);
        if (deficit > 0) shortages.push({ settlement: settlement.profile.id, resource: kind, deficit, severity: severity(deficit, target) });
        const surplus = Math.max(0, economy.stocks[kind] - target * 1.35);
        if (surplus > 0) surpluses.push({ settlement: settlement.profile.id, resource: kind, surplus, exportable: surplus * 0.65 });
      }
      economy.treasury = Math.max(0, economy.treasury + economy.production.gold * this.#policy.taxRate - economy.consumption.gold);
      economy.debt = Math.max(0, economy.debt - Math.min(economy.debt, economy.treasury * 0.02));
      economy.prices = normalizePrices(economy.prices, this.#policy);
      working.set(settlement.profile.id, { ...settlement, economy });
    }

    const transfers: TradeTransfer[] = [];
    const donorByResource = new Map<ResourceKind, EconomySurplus[]>();
    const needByResource = new Map<ResourceKind, EconomyShortage[]>();
    for (const item of surpluses) { const list = donorByResource.get(item.resource) ?? []; list.push(item); donorByResource.set(item.resource, list); }
    for (const item of shortages) { const list = needByResource.get(item.resource) ?? []; list.push(item); needByResource.set(item.resource, list); }

    const sortedRoutes = [...input.routes].filter((route) => route.active).sort((a, b) => a.id.localeCompare(b.id)).slice(0, this.#config.maxTradeRoutes);
    for (const route of sortedRoutes) {
      const from = working.get(route.from);
      const to = working.get(route.to);
      if (!from || !to || route.risk > 0.88) continue;
      const candidates = RESOURCE_KINDS
        .filter((kind) => from.economy.stocks[kind] > targetStock(from.population.total, kind, this.#policy) * 1.35)
        .sort((a, b) => (to.economy.prices[b] - to.economy.prices[a]) || a.localeCompare(b));
      for (const resource of candidates) {
        const target = targetStock(to.population.total, resource, this.#policy);
        const need = Math.max(0, target - to.economy.stocks[resource]);
        const available = Math.max(0, from.economy.stocks[resource] - targetStock(from.population.total, resource, this.#policy));
        const amount = Math.min(route.capacity, available * this.#policy.tradeEfficiency, need);
        if (amount <= 0) continue;
        const value = amount * ((from.economy.prices[resource] + to.economy.prices[resource]) * 0.5) * (1 + route.risk * 0.45);
        from.economy.stocks = addResources(from.economy.stocks, { [resource]: -amount });
        to.economy.stocks = addResources(to.economy.stocks, { [resource]: amount });
        from.economy.treasury += value * 0.35;
        to.economy.treasury = Math.max(0, to.economy.treasury - value);
        transfers.push({ route: route.id, resource, amount, value, from: route.from, to: route.to });
        break;
      }
    }

    const updated: SettlementSnapshot[] = [];
    for (const settlement of working.values()) {
      const population = mutatePopulation(settlement, shortages, surpluses);
      updated.push(recomputeSettlementState(settlement, population, cloneEconomy(settlement.economy), shortages));
    }

    const treasuryDelta: Record<string, number> = {};
    for (const settlement of updated) treasuryDelta[String(settlement.profile.id)] = settlement.economy.treasury - (working.get(settlement.profile.id)?.economy.treasury ?? settlement.economy.treasury);
    let digest = Number(tickValue(Number(input.tick)));
    for (const settlement of updated.sort((a, b) => String(a.profile.id).localeCompare(String(b.profile.id)))) {
      digest = mixHash(digest, hashString(String(settlement.profile.id)));
      digest = mixHash(digest, Math.round(settlement.prosperity * 100));
      digest = mixHash(digest, Math.round(settlement.economy.treasury * 100));
    }
    const output: EconomyTickOutput = { settlements: updated, transfers, shortages, surpluses, treasuryDelta, digest: digest >>> 0 };
    this.#lastOutput = output;
    return { ...output, settlements: updated.map((item) => ({ ...item })), transfers: [...transfers], shortages: [...shortages], surpluses: [...surpluses], treasuryDelta: { ...treasuryDelta } };
  }

  lastOutput(): EconomyTickOutput | undefined {
    return this.#lastOutput ? { ...this.#lastOutput, settlements: [...this.#lastOutput.settlements], transfers: [...this.#lastOutput.transfers], shortages: [...this.#lastOutput.shortages], surpluses: [...this.#lastOutput.surpluses], treasuryDelta: { ...this.#lastOutput.treasuryDelta } } : undefined;
  }

  policy(): EconomyPolicy { return { ...this.#policy }; }

  static baseEconomy(): SettlementEconomy {
    return { stocks: emptyResources(), production: emptyResources(), consumption: emptyResources(), prices: { ...PRICE_BASE }, tradeCapacity: 25, treasury: 0, debt: 0 };
  }
}
