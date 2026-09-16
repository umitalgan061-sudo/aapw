import type { Tick } from './coreTypes.ts';

export interface CoverageSample {
  readonly tick: Tick;
  readonly backend: 'webgpu' | 'webgl2' | 'headless';
  readonly quality: 'safe' | 'low' | 'medium' | 'high' | 'ultra';
  readonly pressure: 'idle' | 'nominal' | 'elevated' | 'critical';
  readonly typedFrame: boolean;
}

export interface CoverageSummary {
  readonly total: number;
  readonly typed: number;
  readonly backends: Readonly<Record<CoverageSample['backend'], number>>;
  readonly qualities: Readonly<Record<CoverageSample['quality'], number>>;
  readonly pressures: Readonly<Record<CoverageSample['pressure'], number>>;
  readonly latestTick: Tick;
}

const BACKENDS: readonly CoverageSample['backend'][] = ['webgpu', 'webgl2', 'headless'];
const QUALITIES: readonly CoverageSample['quality'][] = ['safe', 'low', 'medium', 'high', 'ultra'];
const PRESSURES: readonly CoverageSample['pressure'][] = ['idle', 'nominal', 'elevated', 'critical'];

export class RuntimeCoverageLedger {
  #samples: CoverageSample[] = [];

  record(sample: CoverageSample): CoverageSample {
    const normalized = Object.freeze({ ...sample, tick: Math.max(0, Math.trunc(sample.tick)) });
    this.#samples.push(normalized);
    if (this.#samples.length > 1024) this.#samples.splice(0, this.#samples.length - 1024);
    return normalized;
  }

  merge(samples: readonly CoverageSample[]): void {
    for (const sample of samples) this.record(sample);
  }

  summary(): CoverageSummary {
    const backends = Object.fromEntries(BACKENDS.map((backend) => [backend, 0])) as Record<CoverageSample['backend'], number>;
    const qualities = Object.fromEntries(QUALITIES.map((quality) => [quality, 0])) as Record<CoverageSample['quality'], number>;
    const pressures = Object.fromEntries(PRESSURES.map((pressure) => [pressure, 0])) as Record<CoverageSample['pressure'], number>;
    let typed = 0;
    let latestTick = 0;
    for (const sample of this.#samples) {
      backends[sample.backend] += 1;
      qualities[sample.quality] += 1;
      pressures[sample.pressure] += 1;
      if (sample.typedFrame) typed += 1;
      latestTick = Math.max(latestTick, sample.tick);
    }
    return Object.freeze({ total: this.#samples.length, typed, backends: Object.freeze(backends), qualities: Object.freeze(qualities), pressures: Object.freeze(pressures), latestTick });
  }

  export(): readonly CoverageSample[] { return Object.freeze(this.#samples.slice()); }
  clear(): void { this.#samples.length = 0; }
}
