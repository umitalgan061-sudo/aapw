export interface QualityInputs {
  readonly level: 0 | 1 | 2 | 3 | 4;
  readonly frameMs: number;
  readonly memoryMb: number;
  readonly drawCalls: number;
  readonly visibleCount: number;
  readonly coarsePointer: boolean;
  readonly webgpu: boolean;
}

export interface QualityPolicy {
  readonly pixelRatioCap: number;
  readonly shadowMapSize: number;
  readonly vegetationDensity: number;
  readonly maxVisible: number;
  readonly postFx: boolean;
  readonly terrainSegments: number;
  readonly workerConcurrency: number;
}

const PROFILES: Readonly<Record<0 | 1 | 2 | 3 | 4, Omit<QualityPolicy, 'maxVisible'>>> = {
  0: { pixelRatioCap: 1, shadowMapSize: 512, vegetationDensity: 0.2, postFx: false, terrainSegments: 32, workerConcurrency: 1 },
  1: { pixelRatioCap: 1.25, shadowMapSize: 1024, vegetationDensity: 0.35, postFx: false, terrainSegments: 48, workerConcurrency: 2 },
  2: { pixelRatioCap: 1.5, shadowMapSize: 1536, vegetationDensity: 0.55, postFx: true, terrainSegments: 64, workerConcurrency: 3 },
  3: { pixelRatioCap: 2, shadowMapSize: 2048, vegetationDensity: 0.75, postFx: true, terrainSegments: 96, workerConcurrency: 4 },
  4: { pixelRatioCap: 2.5, shadowMapSize: 4096, vegetationDensity: 1, postFx: true, terrainSegments: 128, workerConcurrency: 6 },
};

export function resolveQualityPolicy(input: QualityInputs): QualityPolicy {
  const level = input.coarsePointer ? Math.min(2, input.level) as 0 | 1 | 2 | 3 | 4 : input.level;
  const base = PROFILES[level];
  const pressure = input.frameMs > 25 || input.memoryMb > 1400 || input.drawCalls > 5000;
  const efficiency = input.frameMs < 11 && input.memoryMb < 700 && input.visibleCount < 900 && !input.coarsePointer;
  const pixelRatioCap = pressure ? Math.max(1, base.pixelRatioCap - 0.5) : efficiency ? Math.min(2.5, base.pixelRatioCap + 0.25) : base.pixelRatioCap;
  const maxVisible = Math.max(128, Math.floor((level + 1) * 512 * (pressure ? 0.7 : 1)));
  return {
    ...base,
    pixelRatioCap,
    maxVisible,
    workerConcurrency: input.webgpu ? base.workerConcurrency : Math.min(3, base.workerConcurrency),
  };
}

export function qualityFeatureEnabled(level: number, feature: 'postFx' | 'denseVegetation' | 'highShadows'): boolean {
  switch (feature) {
    case 'postFx': return level >= 2;
    case 'denseVegetation': return level >= 3;
    case 'highShadows': return level >= 3;
    default: return false;
  }
}
