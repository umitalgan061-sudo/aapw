import { hashString, mixHash, tickValue } from '../types.ts';
import type { Tick } from '../types.ts';
import {
  climateMultiplier,
  type MigrationTransfer,
  type PopulationState,
  type Season,
  type SettlementId,
  type SettlementProfile,
  type SettlementSnapshot,
} from './livingWorldTypes.ts';

export interface SettlementSimulationPolicy {
  readonly naturalGrowthPerYear: number;
  readonly childShare: number;
  readonly elderShare: number;
  readonly soldierShare: number;
  readonly specialistShare: number;
  readonly minimumPopulation: number;
  readonly migrationThreshold: number;
  readonly migrationFraction: number;
  readonly warLossMultiplier: number;
  readonly healthRecoveryRate: number;
  readonly moraleRecoveryRate: number;
}

export const DEFAULT_SETTLEMENT_POLICY: SettlementSimulationPolicy = {
  naturalGrowthPerYear: 0.018,
  childShare: 0.19,
  elderShare: 0.11,
  soldierShare: 0.12,
  specialistShare: 0.09,
  minimumPopulation: 20,
  migrationThreshold: 72,
  migrationFraction: 0.025,
  warLossMultiplier: 0.06,
  healthRecoveryRate: 1.1,
  moraleRecoveryRate: 0.8,
};

export interface SettlementSimulationInput {
  readonly tick: Tick;
  readonly season: Season;
  readonly settlements: readonly SettlementSnapshot[];
  readonly profiles: readonly SettlementProfile[];
  readonly famineSettlements?: readonly SettlementId[];
  readonly warSettlements?: readonly SettlementId[];
  readonly safeDestinations?: readonly SettlementId[];
}

export interface SettlementSimulationOutput {
  readonly settlements: readonly SettlementSnapshot[];
  readonly migration: readonly MigrationTransfer[];
  readonly births: number;
  readonly deaths: number;
  readonly digest: number;
}

function allocatePopulation(total: number, policy: SettlementSimulationPolicy): PopulationState {
  const safeTotal = Math.max(0, Math.floor(total));
  const children = Math.floor(safeTotal * policy.childShare);
  const elders = Math.floor(safeTotal * policy.elderShare);
  const soldiers = Math.floor(safeTotal * policy.soldierShare);
  const specialists = Math.floor(safeTotal * policy.specialistShare);
  const farmers = Math.floor(Math.max(0, safeTotal - children - elders) * 0.31);
  const availableWorkers = Math.max(0, safeTotal - children - elders);
  const workers = Math.max(0, availableWorkers - soldiers - specialists);
  return { total: safeTotal, workers, soldiers, farmers, specialists, children, elders, morale: 65, health: 72, migrationPressure: 0 };
}

function redistribute(population: PopulationState, total: number): PopulationState {
  const nextTotal = Math.max(0, Math.floor(total));
  const ratio = population.total <= 0 ? 0 : nextTotal / population.total;
  return {
    ...population,
    total: nextTotal,
    workers: Math.max(0, Math.floor(population.workers * ratio)),
    soldiers: Math.max(0, Math.floor(population.soldiers * ratio)),
    farmers: Math.max(0, Math.floor(population.farmers * ratio)),
    specialists: Math.max(0, Math.floor(population.specialists * ratio)),
    children: Math.max(0, Math.floor(population.children * ratio)),
    elders: Math.max(0, Math.floor(population.elders * ratio)),
  };
}

function pressure(settlement: SettlementSnapshot): number {
  const foodReserve = settlement.economy.stocks.food / Math.max(1, settlement.population.total * 0.025);
  const waterReserve = settlement.economy.stocks.water / Math.max(1, settlement.population.total * 0.018);
  const safety = settlement.security / 100;
  const morale = settlement.population.morale / 100;
  const health = settlement.population.health / 100;
  const scarcity = Math.max(0, 1 - Math.min(1, foodReserve / 12)) * 0.45 + Math.max(0, 1 - Math.min(1, waterReserve / 8)) * 0.2;
  return Math.min(100, Math.max(0, scarcity * 100 + (1 - safety) * 25 + (1 - morale) * 20 + (1 - health) * 10));
}

function scoreDestination(source: SettlementSnapshot, destination: SettlementSnapshot): number {
  const resource = destination.economy.stocks.food - source.economy.stocks.food * 0.8;
  const safety = destination.security - source.security;
  const prosperity = destination.prosperity - source.prosperity;
  const distancePenalty = Math.hypot(destination.profile.position.x - source.profile.position.x, destination.profile.position.z - source.profile.position.z) / 10000;
  return resource * 0.5 + safety * 0.4 + prosperity * 0.25 - distancePenalty;
}

export class SettlementSimulationV2 {
  readonly #policy: SettlementSimulationPolicy;
  #lastOutput: SettlementSimulationOutput | undefined;

  constructor(policy: Partial<SettlementSimulationPolicy> = {}) {
    this.#policy = { ...DEFAULT_SETTLEMENT_POLICY, ...policy };
  }

  step(input: SettlementSimulationInput): SettlementSimulationOutput {
    const profiles = new Map(input.profiles.map((profile) => [profile.id, profile]));
    const famine = new Set(input.famineSettlements ?? []);
    const war = new Set(input.warSettlements ?? []);
    const working = input.settlements.map((settlement) => ({ ...settlement, population: { ...settlement.population } }));
    let births = 0;
    let deaths = 0;

    const simulated = working.map((settlement) => {
      const profile = profiles.get(settlement.profile.id) ?? settlement.profile;
      const seasonalFactor = climateMultiplier(profile.climate, input.season);
      const annualGrowth = this.#policy.naturalGrowthPerYear * seasonalFactor;
      const perTickGrowth = annualGrowth / 360;
      let total = settlement.population.total;
      if (total <= 0) total = allocatePopulation(this.#policy.minimumPopulation, this.#policy).total;
      const expectedBirths = Math.max(0, total * perTickGrowth);
      const birthCount = Math.floor(expectedBirths);
      const crisisMortality = famine.has(settlement.profile.id) ? 0.005 : 0;
      const warMortality = war.has(settlement.profile.id) ? this.#policy.warLossMultiplier / 360 : 0;
      const expectedDeaths = Math.floor(total * (crisisMortality + warMortality) / 30);
      births += birthCount;
      deaths += expectedDeaths;
      total = Math.max(this.#policy.minimumPopulation, total + birthCount - expectedDeaths);
      let population = redistribute(settlement.population, total);
      const currentPressure = pressure(settlement);
      const recoveryHealth = famine.has(settlement.profile.id) ? -0.35 : this.#policy.healthRecoveryRate * 0.02;
      const recoveryMorale = war.has(settlement.profile.id) ? -0.3 : this.#policy.moraleRecoveryRate * 0.02;
      population = {
        ...population,
        health: Math.min(100, Math.max(0, population.health + recoveryHealth)),
        morale: Math.min(100, Math.max(0, population.morale + recoveryMorale)),
        migrationPressure: Math.min(100, Math.max(0, population.migrationPressure + (currentPressure - population.migrationPressure) * 0.08)),
      };
      return { ...settlement, population };
    });

    const byId = new Map(simulated.map((settlement) => [settlement.profile.id, settlement]));
    const candidates = [...simulated]
      .filter((settlement) => settlement.population.migrationPressure >= this.#policy.migrationThreshold)
      .sort((a, b) => String(a.profile.id).localeCompare(String(b.profile.id)));
    const migrations: MigrationTransfer[] = [];
    const allowedDestinations = new Set(input.safeDestinations ?? simulated.map((settlement) => settlement.profile.id));
    for (const source of candidates) {
      if (migrations.length >= 64) break;
      let destination = simulated
        .filter((candidate) => candidate.profile.id !== source.profile.id && allowedDestinations.has(candidate.profile.id))
        .filter((candidate) => candidate.security >= 45 && candidate.prosperity >= source.prosperity * 0.75)
        .sort((a, b) => scoreDestination(source, b) - scoreDestination(source, a) || String(a.profile.id).localeCompare(String(b.profile.id)))[0];
      if (!destination) destination = simulated.find((candidate) => candidate.profile.id !== source.profile.id && allowedDestinations.has(candidate.profile.id));
      if (!destination) continue;
      const amount = Math.min(Math.floor(source.population.total * this.#policy.migrationFraction), Math.max(0, source.population.total - this.#policy.minimumPopulation));
      if (amount <= 0) continue;
      const sourceRecord = byId.get(source.profile.id);
      const destinationRecord = byId.get(destination.profile.id);
      if (!sourceRecord || !destinationRecord) continue;
      sourceRecord.population = redistribute(sourceRecord.population, sourceRecord.population.total - amount);
      sourceRecord.population = { ...sourceRecord.population, migrationPressure: Math.max(0, sourceRecord.population.migrationPressure - 18) };
      destinationRecord.population = redistribute(destinationRecord.population, destinationRecord.population.total + amount);
      destinationRecord.population = { ...destinationRecord.population, morale: Math.min(100, destinationRecord.population.morale + Math.min(2, amount / 20)) };
      const reason = famine.has(source.profile.id) ? 'food' : war.has(source.profile.id) ? 'war' : sourceRecord.security < 45 ? 'safety' : sourceRecord.prosperity < 38 ? 'work' : 'climate';
      migrations.push({ from: source.profile.id, to: destination.profile.id, population: amount, reason });
    }

    let digest = Number(tickValue(Number(input.tick)));
    for (const settlement of simulated.sort((a, b) => String(a.profile.id).localeCompare(String(b.profile.id)))) {
      digest = mixHash(digest, hashString(String(settlement.profile.id)));
      digest = mixHash(digest, settlement.population.total);
      digest = mixHash(digest, Math.round(settlement.population.morale * 10));
      digest = mixHash(digest, Math.round(settlement.population.health * 10));
    }
    const output = { settlements: simulated, migration: migrations, births, deaths, digest: digest >>> 0 };
    this.#lastOutput = output;
    return { ...output, settlements: simulated.map((item) => ({ ...item, population: { ...item.population } })), migration: [...migrations] };
  }

  lastOutput(): SettlementSimulationOutput | undefined {
    return this.#lastOutput ? { ...this.#lastOutput, settlements: [...this.#lastOutput.settlements], migration: [...this.#lastOutput.migration] } : undefined;
  }

  policy(): SettlementSimulationPolicy { return { ...this.#policy }; }
}
