import { clamp, hashString, mixHash } from '../types.ts';
import type { Tick } from '../types.ts';
import {
  type ClimateBand,
  type Season,
  seasonForTick,
  type SettlementProfile,
} from './livingWorldTypes.ts';

export interface ClimateRegion {
  readonly id: string;
  readonly center: { readonly x: number; readonly z: number };
  readonly radiusMeters: number;
  readonly climate: ClimateBand;
  readonly baselineTemperature: number;
  readonly baselineMoisture: number;
  readonly oceanInfluence: number;
}

export interface ClimateSnapshot {
  readonly tick: Tick;
  readonly season: Season;
  readonly globalTemperature: number;
  readonly globalMoisture: number;
  readonly stormPressure: number;
  readonly droughtPressure: number;
  readonly regions: readonly ClimateRegionSnapshot[];
  readonly digest: number;
}

export interface ClimateRegionSnapshot {
  readonly id: string;
  readonly temperature: number;
  readonly moisture: number;
  readonly stormPressure: number;
  readonly droughtPressure: number;
  readonly heatStress: number;
  readonly coldStress: number;
}

export interface ClimateModelPolicy {
  readonly annualTemperatureWave: number;
  readonly oceanDamping: number;
  readonly droughtPersistence: number;
  readonly stormVariance: number;
  readonly regionalInfluence: number;
}

export const DEFAULT_CLIMATE_POLICY: ClimateModelPolicy = {
  annualTemperatureWave: 0.42,
  oceanDamping: 0.62,
  droughtPersistence: 0.6,
  stormVariance: 0.22,
  regionalInfluence: 0.75,
};

function seasonOffset(season: Season): number {
  return season === 'winter' ? -1 : season === 'spring' ? -0.08 : season === 'summer' ? 1 : 0.18;
}

function climateMoistureBase(climate: ClimateBand): number {
  return climate === 'polar' ? 0.62 : climate === 'cold' ? 0.55 : climate === 'temperate' ? 0.58 : climate === 'dry' ? 0.28 : 0.42;
}

function regionFactor(region: ClimateRegion, settlement?: SettlementProfile): number {
  if (!settlement) return 1;
  const distance = Math.hypot(region.center.x - settlement.position.x, region.center.z - settlement.position.z);
  return clamp(1 - distance / Math.max(1, region.radiusMeters), 0, 1);
}

export class WorldClimateModelV2 {
  readonly #seed: number;
  readonly #policy: ClimateModelPolicy;
  #last: ClimateSnapshot | undefined;

  constructor(seed: number, policy: Partial<ClimateModelPolicy> = {}) {
    this.#seed = seed | 0;
    this.#policy = { ...DEFAULT_CLIMATE_POLICY, ...policy };
  }

  sample(tick: Tick, regions: readonly ClimateRegion[], settlements: readonly SettlementProfile[] = []): ClimateSnapshot {
    const season = seasonForTick(Number(tick));
    const annual = Math.sin((Number(tick) / (60 * 60 * 24 * 120)) * Math.PI * 2) * this.#policy.annualTemperatureWave;
    const seasonBias = seasonOffset(season);
    const regionSnapshots = regions.map((region) => {
      const deterministicNoise = ((hashString(`${this.#seed}:${region.id}:${Number(tick)}`) % 100000) / 100000 - 0.5) * this.#policy.stormVariance;
      const settlementInfluence = settlements.reduce((sum, settlement) => sum + regionFactor(region, settlement) * (settlement.profile.coastal ? this.#policy.oceanDamping : 0), 0) / Math.max(1, settlements.length);
      const ocean = region.oceanInfluence * settlementInfluence;
      const temperature = region.baselineTemperature + annual + seasonBias * 0.6 + deterministicNoise * 0.3 - ocean * seasonBias * 0.12;
      const moisture = clamp(region.baselineMoisture + (season === 'winter' ? 0.05 : season === 'summer' ? -0.06 : 0) + ocean * 0.08 + deterministicNoise * 0.04, 0, 1);
      const stormPressure = clamp(0.3 + moisture * 0.45 + Math.abs(deterministicNoise) * 0.35 + (season === 'autumn' ? 0.12 : 0), 0, 1);
      const droughtPressure = clamp((1 - moisture) * 0.62 + Math.max(0, temperature - 0.55) * 0.5 + this.#policy.droughtPersistence * 0.08, 0, 1);
      return { id: region.id, temperature, moisture, stormPressure, droughtPressure, heatStress: clamp(temperature - 0.65, 0, 1), coldStress: clamp(-temperature - 0.55, 0, 1) };
    });
    const globalTemperature = regionSnapshots.length ? regionSnapshots.reduce((sum, region) => sum + region.temperature, 0) / regionSnapshots.length : seasonBias;
    const globalMoisture = regionSnapshots.length ? regionSnapshots.reduce((sum, region) => sum + region.moisture, 0) / regionSnapshots.length : 0.5;
    const stormPressure = regionSnapshots.length ? regionSnapshots.reduce((sum, region) => sum + region.stormPressure, 0) / regionSnapshots.length : 0.2;
    const droughtPressure = regionSnapshots.length ? regionSnapshots.reduce((sum, region) => sum + region.droughtPressure, 0) / regionSnapshots.length : 0.2;
    let digest = this.#seed ^ Number(tick);
    for (const region of regionSnapshots.sort((a, b) => a.id.localeCompare(b.id))) {
      digest = mixHash(digest, hashString(region.id));
      digest = mixHash(digest, Math.round(region.temperature * 10000));
      digest = mixHash(digest, Math.round(region.moisture * 10000));
    }
    const snapshot = { tick, season, globalTemperature, globalMoisture, stormPressure, droughtPressure, regions: regionSnapshots, digest: digest >>> 0 };
    this.#last = snapshot;
    return { ...snapshot, regions: regionSnapshots.map((region) => ({ ...region })) };
  }

  last(): ClimateSnapshot | undefined {
    return this.#last ? { ...this.#last, regions: this.#last.regions.map((region) => ({ ...region })) } : undefined;
  }

  policy(): ClimateModelPolicy { return { ...this.#policy }; }
}
