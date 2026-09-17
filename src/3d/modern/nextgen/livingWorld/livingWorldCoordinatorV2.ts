import { mixHash, stableChecksum, tickValue } from '../types.ts';
import type { Tick } from '../types.ts';
import { EconomySimulationV2, DEFAULT_ECONOMY_POLICY } from './economySimulationV2.ts';
import { SettlementSimulationV2 } from './settlementSimulationV2.ts';
import { FactionDiplomacyV2 } from './factionDiplomacyV2.ts';
import { EcologySimulationV2 } from './ecologySimulationV2.ts';
import { TradeRoutePlannerV2 } from './tradeRoutePlannerV2.ts';
import { WorldEventOrchestratorV2 } from './worldEventOrchestratorV2.ts';
import { WorldClimateModelV2, type ClimateRegion } from './worldClimateModelV2.ts';
import type {
  FactionProfile,
  FactionRelation,
  LivingWorldConfig,
  LivingWorldDiagnostics,
  LivingWorldFrame,
  LivingWorldHealth,
  MigrationTransfer,
  Season,
  SettlementProfile,
  SettlementSnapshot,
  TradeRoute,
  TradeTransfer,
  BiomeCell,
  WildlifePopulation,
} from './livingWorldTypes.ts';
import { DEFAULT_LIVING_WORLD_CONFIG, dayForTick, seasonForTick, yearForTick } from './livingWorldTypes.ts';
import { WorldEventJournalV2 } from '../worldEventJournalV2.ts';

export interface LivingWorldInput {
  readonly tick?: Tick;
  readonly settlements: readonly SettlementSnapshot[];
  readonly settlementProfiles?: readonly SettlementProfile[];
  readonly factions: readonly FactionProfile[];
  readonly relations: readonly FactionRelation[];
  readonly ecologyCells: readonly BiomeCell[];
  readonly wildlife: readonly WildlifePopulation[];
  readonly species: readonly string[];
  readonly climateRegions?: readonly ClimateRegion[];
  readonly tradeRoutes?: readonly TradeRoute[];
  readonly weatherPressure?: number;
  readonly factionWarPairs?: readonly [string, string][];
}

export interface LivingWorldOutput extends LivingWorldFrame {
  readonly health: LivingWorldHealth;
  readonly diagnostics: LivingWorldDiagnostics;
  readonly journalEvents: number;
}

function average(values: readonly number[], fallback = 0): number {
  if (!values.length) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function healthFor(
  settlements: readonly SettlementSnapshot[],
  relations: readonly FactionRelation[],
  ecologyIntegrity: number,
  crisisCount: number,
): LivingWorldHealth {
  const settlementStability = average(settlements.map((settlement) => settlement.stability), 50);
  const foodSecurity = average(settlements.map((settlement) => {
    const target = Math.max(1, settlement.population.total * DEFAULT_ECONOMY_POLICY.baseConsumptionPerCitizen * DEFAULT_ECONOMY_POLICY.reserveFoodDays);
    return Math.min(100, settlement.economy.stocks.food / target * 100);
  }), 0);
  const diplomaticStability = average(relations.map((relation) => (relation.score + 100) / 2), 50);
  const score = Math.max(0, Math.min(100, settlementStability * 0.32 + foodSecurity * 0.28 + diplomaticStability * 0.22 + ecologyIntegrity * 0.18 - crisisCount * 1.5));
  const warnings: string[] = [];
  if (foodSecurity < 40) warnings.push('food-security');
  if (settlementStability < 40) warnings.push('settlement-instability');
  if (diplomaticStability < 35) warnings.push('diplomatic-instability');
  if (ecologyIntegrity < 45) warnings.push('ecology-stress');
  if (crisisCount > 8) warnings.push('active-crises');
  return { score, settlementStability, foodSecurity, diplomaticStability, ecologicalIntegrity: ecologyIntegrity, activeCrises: crisisCount, warnings };
}

function cloneSettlement(settlement: SettlementSnapshot): SettlementSnapshot {
  return {
    ...settlement,
    profile: { ...settlement.profile, position: { ...settlement.profile.position } },
    population: { ...settlement.population },
    economy: {
      ...settlement.economy,
      stocks: { ...settlement.economy.stocks },
      production: { ...settlement.economy.production },
      consumption: { ...settlement.economy.consumption },
      prices: { ...settlement.economy.prices },
    },
  };
}

function stableSortSettlements(value: readonly SettlementSnapshot[]): SettlementSnapshot[] {
  return value.map(cloneSettlement).sort((a, b) => String(a.profile.id).localeCompare(String(b.profile.id)));
}

export class LivingWorldCoordinatorV2 {
  readonly #config: LivingWorldConfig;
  readonly #economy: EconomySimulationV2;
  readonly #settlements: SettlementSimulationV2;
  readonly #diplomacy: FactionDiplomacyV2;
  readonly #ecology: EcologySimulationV2;
  readonly #routes: TradeRoutePlannerV2;
  readonly #events: WorldEventOrchestratorV2;
  readonly #climate: WorldClimateModelV2;
  readonly #journal: WorldEventJournalV2<unknown>;
  #last: LivingWorldOutput | undefined;
  #tick: Tick = tickValue(0);

  constructor(seed: number, options: {
    config?: Partial<LivingWorldConfig>;
    economy?: Partial<Parameters<typeof EconomySimulationV2.prototype.policy>[0]>;
    diplomacy?: ConstructorParameters<typeof FactionDiplomacyV2>[0];
    ecology?: ConstructorParameters<typeof EcologySimulationV2>[0];
    routes?: ConstructorParameters<typeof TradeRoutePlannerV2>[0];
    events?: ConstructorParameters<typeof WorldEventOrchestratorV2>[0];
    climate?: ConstructorParameters<typeof WorldClimateModelV2>[1];
    journal?: WorldEventJournalV2<unknown>;
  } = {}) {
    this.#config = { ...DEFAULT_LIVING_WORLD_CONFIG, ...options.config };
    this.#economy = new EconomySimulationV2(options.economy);
    this.#settlements = new SettlementSimulationV2();
    this.#diplomacy = new FactionDiplomacyV2(options.diplomacy);
    this.#ecology = new EcologySimulationV2(options.ecology);
    this.#routes = new TradeRoutePlannerV2(options.routes);
    this.#events = new WorldEventOrchestratorV2(options.events);
    this.#climate = new WorldClimateModelV2(seed, options.climate);
    this.#journal = options.journal ?? new WorldEventJournalV2();
  }

  get tick(): Tick { return this.#tick; }

  step(input: LivingWorldInput): LivingWorldOutput {
    this.#tick = input.tick === undefined ? tickValue(Number(this.#tick) + 1) : input.tick;
    const season: Season = seasonForTick(Number(this.#tick), this.#config);
    const day = dayForTick(Number(this.#tick), this.#config);
    const year = yearForTick(Number(this.#tick), this.#config);
    const profiles = input.settlementProfiles ?? input.settlements.map((settlement) => settlement.profile);
    const climate = this.#climate.sample(this.#tick, input.climateRegions ?? [], profiles);
    const climateStress = Math.min(1, climate.droughtPressure * 0.6 + climate.stormPressure * 0.25 + Math.max(0, -climate.globalTemperature - 0.5) * 0.15);

    const routePlan = input.tradeRoutes?.length ? { routes: input.tradeRoutes, digest: stableChecksum(input.tradeRoutes) } : this.#routes.plan({ settlements: input.settlements, factionWarPairs: input.factionWarPairs });
    const economy = this.#economy.step({ tick: this.#tick, season, profiles, settlements: stableSortSettlements(input.settlements), routes: routePlan.routes });
    const famine = economy.shortages.filter((item) => item.resource === 'food' && item.severity > 0.75).map((item) => item.settlement);
    const warSettlementIds = new Set<string>();
    const factionBySettlement = new Map<string, string>();
    for (const faction of input.factions) for (const settlement of faction.settlements) factionBySettlement.set(String(settlement), String(faction.id));
    for (const [left, right] of input.factionWarPairs ?? []) for (const [settlementId, owner] of factionBySettlement) if (owner === left || owner === right) warSettlementIds.add(settlementId);
    const population = this.#settlements.step({ tick: this.#tick, season, settlements: economy.settlements, profiles, famineSettlements: famine, warSettlements: [...warSettlementIds].map((id) => id as never) });
    const diplomacy = this.#diplomacy.step({ tick: this.#tick, factions: input.factions, relations: input.relations, settlements: population.settlements });
    const routePlanAfterPopulation = this.#routes.plan({ settlements: population.settlements, roadGraph: input.tradeRoutes?.map((route) => ({ from: route.from, to: route.to, distanceMeters: route.distanceMeters, quality: 1 - route.risk })), factionWarPairs: diplomacy.wars.map(([from, to]) => [String(from), String(to)]) });
    const transfers = this.#economy.step({ tick: this.#tick, season, profiles, settlements: population.settlements, routes: routePlanAfterPopulation.routes }).transfers;
    const ecology = this.#ecology.step({ tick: this.#tick, season, cells: input.ecologyCells, wildlife: input.wildlife, settlements: population.settlements, species: input.species, weatherPressure: Math.max(input.weatherPressure ?? 0, climateStress) });
    const systemicEvents = this.#events.step({ tick: this.#tick, season, settlements: population.settlements, climatePressure: climate.stormPressure, ecologicalStress: 1 - ecology.forestHealth / 100, activeWars: diplomacy.wars.map(([from, to]) => `${String(from)}:${String(to)}`) });

    let journalEvents = 0;
    for (const event of systemicEvents.events) {
      this.#journal.append({ tick: this.#tick, kind: event.type === 'war' ? 'custom' : event.type === 'peace' ? 'custom' : 'settlement', source: event.source, payload: event });
      journalEvents += 1;
    }
    for (const transfer of transfers) {
      this.#journal.append({ tick: this.#tick, kind: 'settlement', source: 'trade', payload: transfer });
      journalEvents += 1;
    }
    for (const migration of population.migration) {
      this.#journal.append({ tick: this.#tick, kind: 'settlement', source: 'migration', payload: migration });
      journalEvents += 1;
    }
    for (const event of ecology.events) {
      this.#journal.append({ tick: this.#tick, kind: 'weather', source: 'ecology', payload: event });
      journalEvents += 1;
    }

    const frame: LivingWorldFrame = {
      tick: this.#tick,
      day,
      season,
      year,
      settlements: stableSortSettlements(population.settlements),
      factions: input.factions.map((faction) => ({ ...faction, settlements: [...faction.settlements] })),
      relations: diplomacy.relations.map((relation) => ({ ...relation })),
      trade: transfers.map((transfer) => ({ ...transfer })),
      migration: population.migration.map((migration) => ({ ...migration })),
      ecology: ecology.events.map((event) => ({ ...event })),
      events: systemicEvents.events.map((event) => ({ ...event, subjects: [...event.subjects], payload: { ...event.payload } })),
    };
    const ecologyIntegrity = Math.min(100, Math.max(0, (ecology.forestHealth * 0.6 + ecology.biodiversity * 0.4) * (1 - climateStress * 0.35)));
    const health = healthFor(frame.settlements, frame.relations, ecologyIntegrity, systemicEvents.crisisCount);
    let digest = stableChecksum({ tick: Number(this.#tick), day, season, year, economy: economy.digest, population: population.digest, diplomacy: diplomacy.digest, ecology: ecology.digest, events: systemicEvents.digest, routes: routePlanAfterPopulation.digest });
    digest = mixHash(digest, this.#journal.hash());
    const diagnostics: LivingWorldDiagnostics = {
      settlementCount: frame.settlements.length,
      factionCount: frame.factions.length,
      relationCount: frame.relations.length,
      routeCount: routePlanAfterPopulation.routes.length,
      population: frame.settlements.reduce((sum, settlement) => sum + settlement.population.total, 0),
      eventCount: frame.events.length + frame.ecology.length + frame.trade.length + frame.migration.length,
      ecologyCells: ecology.cells.length,
      frameDigest: digest >>> 0,
    };
    const output: LivingWorldOutput = { ...frame, health, diagnostics, journalEvents };
    this.#last = output;
    return {
      ...output,
      settlements: output.settlements.map(cloneSettlement),
      factions: output.factions.map((faction) => ({ ...faction, settlements: [...faction.settlements] })),
      relations: output.relations.map((relation) => ({ ...relation })),
      trade: output.trade.map((trade) => ({ ...trade })),
      migration: output.migration.map((migration) => ({ ...migration })),
      ecology: output.ecology.map((event) => ({ ...event })),
      events: output.events.map((event) => ({ ...event, subjects: [...event.subjects], payload: { ...event.payload } })),
      health: { ...output.health, warnings: [...output.health.warnings] },
      diagnostics: { ...output.diagnostics },
    };
  }

  last(): LivingWorldOutput | undefined {
    if (!this.#last) return undefined;
    return {
      ...this.#last,
      settlements: this.#last.settlements.map(cloneSettlement),
      factions: this.#last.factions.map((faction) => ({ ...faction, settlements: [...faction.settlements] })),
      relations: this.#last.relations.map((relation) => ({ ...relation })),
      trade: [...this.#last.trade],
      migration: [...this.#last.migration],
      ecology: [...this.#last.ecology],
      events: this.#last.events.map((event) => ({ ...event, subjects: [...event.subjects], payload: { ...event.payload } })),
      health: { ...this.#last.health, warnings: [...this.#last.health.warnings] },
      diagnostics: { ...this.#last.diagnostics },
    };
  }

  journal(): WorldEventJournalV2<unknown> { return this.#journal; }

  reset(): void {
    this.#tick = tickValue(0);
    this.#last = undefined;
    this.#journal.clear();
  }
}
