import type { RuntimeFrameR31, RuntimePluginR31 } from './applicationTypesR31.ts';
import { DiagnosticsR31 } from './diagnosticsR31.ts';

export interface LegacyFrameObservationR31 {
  readonly frameMs: number;
  readonly rendererCalls: number;
  readonly rendererTriangles: number;
  readonly loadedChunks: number;
  readonly activeNpcs: number;
  readonly activeAnimals: number;
  readonly activeCreatures: number;
  readonly activeDragons: number;
  readonly paused: boolean;
}

export interface LegacyFrameSamplerR31 {
  readonly sample: () => LegacyFrameObservationR31;
}

export interface LegacyFrameObserverDiagnosticsR31 {
  readonly frames: number;
  readonly diagnostics: ReturnType<DiagnosticsR31['snapshot']>;
  readonly last: LegacyFrameObservationR31 | null;
}

export class LegacyFrameObserverR31 implements RuntimePluginR31 {
  readonly id = 'r31.legacy-frame-observer';
  readonly phase = 'diagnostics' as const;
  readonly priority = 'low' as const;
  readonly #sampler: LegacyFrameSamplerR31;
  readonly #diagnostics: DiagnosticsR31;
  #frames = 0;
  #last: LegacyFrameObservationR31 | null = null;

  constructor(sampler: LegacyFrameSamplerR31, maxSamples = 300) {
    this.#sampler = sampler;
    this.#diagnostics = new DiagnosticsR31(maxSamples);
  }

  update(frame: RuntimeFrameR31): void {
    const sample = this.#sampler.sample();
    this.#last = Object.freeze({ ...sample });
    this.#frames++;
    this.#diagnostics.record({
      timestampMs: frame.elapsedSeconds * 1000,
      frameMs: Math.max(0, sample.frameMs),
      simulationMs: frame.deltaSeconds * 1000,
      renderMs: Math.max(0, sample.rendererCalls > 0 ? sample.frameMs : 0),
      networkMs: 0,
      memoryBytes: null,
      droppedCommands: 0,
      droppedEvents: 0,
      errors: 0,
    });
  }

  diagnostics(): LegacyFrameObserverDiagnosticsR31 {
    return Object.freeze({
      frames: this.#frames,
      diagnostics: this.#diagnostics.snapshot(),
      last: this.#last,
    });
  }

  reset(): void {
    this.#frames = 0;
    this.#last = null;
    this.#diagnostics.clear();
  }
}
