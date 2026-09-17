import { hashString, mixHash, clamp } from '../types.ts';
import type { Tick } from '../types.ts';
import {
  type BiomeCell,
  type ClimateBand,
  type EcologyEvent,
  type Season,
  type SettlementSnapshot,
  type WildlifePopulation,
} from './livingWorldTypes.ts';

export interface EcologyPolicy {
  readonly regrowthRate: number;
  readonly wildlifeBirthRate: number;
  readonly wildlifeDeathRate: number;
  readonly depletionPenalty: number;
  readonly recoveryThreshold: number;
  readonly migrationThreshold: number;
  readonly disturbanceDecay: number;
  readonly maxSpecies: number;
  readonly maxCells: number;
}

export const DEFAULT_ECOLOGY_POLICY: EcologyPolicy = {
  regrowthRate: 0.018,
  wildlifeBirthRate: 0.014,
  wildlifeDeathRate: 0.008,
  depletionPenalty: 0.025,
  recoveryThreshold: 0.42,
  migrationThreshold: 0.72,
  disturbanceDecay: 0.012,
  maxSpecies: 24,
  maxCells: 1024,
};

export interface EcologyInput {
  readonly tick: Tick;
  readonly season: Season;
  readonly cells: readonly BiomeCell[];
  readonly wildlife: readonly WildlifePopulation[];
  readonly settlements: readonly SettlementSnapshot[];
  readonly species: readonly string[];
  readonly weatherPressure?: number;
}

export interface EcologyOutput {
  readonly cells: readonly BiomeCell[];
  readonly wildlife: readonly WildlifePopulation[];
  readonly events: readonly EcologyEvent[];
  readonly forestHealth: number;
  readonly biodiversity: number;
  readonly digest: number;
}

function seasonTemperature(season: Season): number {
  return season === 'winter' ? -0.25 : season === 'spring' ? 0.05 : season === 'summer' ? 0.28 : 0.02;
}

function climateCapacity(climate: ClimateBand): number {
  return climate === 'temperate' ? 1 : climate === 'cold' ? 0.82 : climate === 'polar' ? 0.55 : climate === 'dry' ? 0.68 : 0.8;
}

function normalizeCell(cell: BiomeCell): BiomeCell {
  return {
    ...cell,
    fertility: clamp(cell.fertility, 0, 1),
    moisture: clamp(cell.moisture, 0, 1),
    temperature: Number.isFinite(cell.temperature) ? cell.temperature : 0,
    carryingCapacity: Math.max(0, cell.carryingCapacity),
    wildlifeCapacity: Math.max(0, cell.wildlifeCapacity),
    disturbance: clamp(cell.disturbance, 0, 1),
  };
}

function settlementPressure(cell: BiomeCell, settlements: readonly SettlementSnapshot[]): number {
  let pressure = 0;
  for (const settlement of settlements) {
    const dx = settlement.profile.position.x / 1000 - cell.center.x;
    const dz = settlement.profile.position.z / 1000 - cell.center.y;
    const distance = Math.hypot(dx, dz);
    if (distance < 3) pressure += 0.15;
    else if (distance < 8) pressure += 0.05;
  }
  return Math.min(1, pressure);
}

function habitatMultiplier(cell: BiomeCell, season: Season): number {
  const temp = 1 - Math.min(1, Math.abs(cell.temperature + seasonTemperature(season)) * 0.85);
  const moisture = 0.45 + cell.moisture * 0.55;
  const fertility = 0.5 + cell.fertility * 0.5;
  const capacity = climateCapacity(cell.climate);
  const disturbance = 1 - cell.disturbance * 0.75;
  return clamp(temp * moisture * fertility * capacity * disturbance, 0.05, 1.2);
}

function normalizePopulation(population: WildlifePopulation): WildlifePopulation {
  return {
    ...population,
    population: Math.max(0, Math.floor(population.population)),
    health: clamp(population.health, 0, 100),
    foodPressure: clamp(population.foodPressure, 0, 1),
    migrationBias: { ...population.migrationBias },
  };
}

function updateWildlife(population: WildlifePopulation, cell: BiomeCell, season: Season, policy: EcologyPolicy): { next: WildlifePopulation; event?: EcologyEvent } {
  const habitat = habitatMultiplier(cell, season);
  const capacity = Math.max(1, Math.floor(cell.wildlifeCapacity * habitat));
  const normalized = normalizePopulation(population);
  const density = normalized.population / capacity;
  const birthFactor = policy.wildlifeBirthRate * Math.max(0, 1 - density) * Math.max(0.25, habitat);
  const deathFactor = policy.wildlifeDeathRate + (density > 1 ? (density - 1) * 0.04 : 0) + normalized.foodPressure * 0.018;
  const births = Math.floor(normalized.population * birthFactor);
  const deaths = Math.floor(normalized.population * deathFactor);
  const nextPopulation = Math.max(0, normalized.population + births - deaths);
  const health = clamp(normalized.health + (habitat - 0.6) * 2 - normalized.foodPressure * 3, 0, 100);
  let event: EcologyEvent | undefined;
  if (nextPopulation === 0 && normalized.population > 0) event = { type: 'dieoff', cellKey: cell.key, species: normalized.species, amount: normalized.population, reason: 'habitat capacity collapsed' };
  else if (nextPopulation > normalized.population * 1.15) event = { type: 'recovery', cellKey: cell.key, species: normalized.species, amount: nextPopulation - normalized.population, reason: 'habitat recovery and low density' };
  else if (density > 1.35) event = { type: 'migration', cellKey: cell.key, species: normalized.species, amount: Math.floor((density - 1) * normalized.population * policy.migrationThreshold), reason: 'population exceeded habitat carrying capacity' };
  return { next: { ...normalized, population: nextPopulation, health, foodPressure: clamp(1 - habitat, 0, 1), migrationBias: { x: cell.moisture < 0.35 ? 1 : -1, y: cell.fertility < 0.4 ? 1 : -1 } }, event };
}

export class EcologySimulationV2 {
  readonly #policy: EcologyPolicy;
  #lastOutput: EcologyOutput | undefined;

  constructor(policy: Partial<EcologyPolicy> = {}) {
    this.#policy = { ...DEFAULT_ECOLOGY_POLICY, ...policy };
  }

  step(input: EcologyInput): EcologyOutput {
    const cells = input.cells.slice(0, this.#policy.maxCells).map(normalizeCell);
    const cellMap = new Map(cells.map((cell) => [cell.key, cell]));
    const events: EcologyEvent[] = [];
    const nextCells = cells.map((cell) => {
      const settlement = settlementPressure(cell, input.settlements);
      const seasonal = seasonTemperature(input.season);
      const weather = clamp(input.weatherPressure ?? 0, 0, 1);
      const disturbance = clamp(cell.disturbance + settlement + weather * 0.08 - this.#policy.disturbanceDecay, 0, 1);
      const moistureDelta = input.season === 'summer' ? -0.006 - weather * 0.01 : input.season === 'winter' ? -0.002 : 0.004;
      const fertilityDelta = this.#policy.regrowthRate * (0.6 - disturbance) - this.#policy.depletionPenalty * disturbance;
      const moisture = clamp(cell.moisture + moistureDelta, 0, 1);
      const fertility = clamp(cell.fertility + fertilityDelta, 0, 1);
      if (fertility > cell.fertility + 0.03) events.push({ type: 'regrowth', cellKey: cell.key, amount: fertility - cell.fertility, reason: 'natural recovery' });
      if (fertility < cell.fertility - 0.03) events.push({ type: 'depletion', cellKey: cell.key, amount: cell.fertility - fertility, reason: disturbance and extraction pressure' });
      return { ...cell, moisture, fertility, temperature: clamp(cell.temperature + seasonal * 0.035, -1, 1), disturbance };
    });

    const grouped = new Map<string, WildlifePopulation[]>();
    for (const animal of input.wildlife.slice(0, this.#policy.maxSpecies * this.#policy.maxCells)) {
      const list = grouped.get(animal.cellKey) ?? [];
      list.push(animal);
      grouped.set(animal.cellKey, list);
    }
    const nextWildlife: WildlifePopulation[] = [];
    for (const [cellKey, animals] of grouped) {
      const cell = cellMap.get(cellKey);
      if (!cell) continue;
      for (const animal of animals) {
        const result = updateWildlife(animal, cell, input.season, this.#policy);
        nextWildlife.push(result.next);
        if (result.event) events.push(result.event);
      }
    }

    const speciesSet = new Set(input.species.slice(0, this.#policy.maxSpecies));
    const cellCountBySpecies = new Map<string, number>();
    for (const animal of nextWildlife) {
      if (animal.population <= 0) continue;
      speciesSet.add(animal.species);
      cellCountBySpecies.set(animal.species, (cellCountBySpecies.get(animal.species) ?? 0) + 1);
    }
    const biodiversity = Math.min(100, speciesSet.size / Math.max(1, this.#policy.maxSpecies) * 100);
    const forestCells = nextCells.filter((cell) => cell.climate === 'temperate' || cell.climate === 'cold');
    const forestHealth = forestCells.length === 0 ? 0 : forestCells.reduce((sum, cell) => sum + cell.fertility * (1 - cell.disturbance), 0) / forestCells.length * 100;
    let digest = Number(input.tick) ^ hashString(input.season);
    for (const cell of nextCells.sort((a, b) => a.key.localeCompare(b.key))) {
      digest = mixHash(digest, hashString(cell.key));
      digest = mixHash(digest, Math.round(cell.fertility * 10000));
      digest = mixHash(digest, Math.round(cell.disturbance * 10000));
    }
    for (const animal of nextWildlife.sort((a, b) => `${a.species}:${a.cellKey}`.localeCompare(`${b.species}:${b.cellKey}`))) digest = mixHash(digest, animal.population);
    const output = { cells: nextCells, wildlife: nextWildlife, events, forestHealth, biodiversity, digest: digest >>> 0 };
    this.#lastOutput = output;
    return { ...output, cells: nextCells.map((cell) => ({ ...cell })), wildlife: nextWildlife.map((animal) => ({ ...animal, migrationBias: { ...animal.migrationBias } })), events: [...events] };
  }

  lastOutput(): EcologyOutput | undefined {
    return this.#lastOutput ? { ...this.#lastOutput, cells: [...this.#lastOutput.cells], wildlife: [...this.#lastOutput.wildlife], events: [...this.#lastOutput.events] } : undefined;
  }

  policy(): EcologyPolicy { return { ...this.#policy }; }
}
