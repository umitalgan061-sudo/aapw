import { PlatformProfileV7, RenderBudgetV7, RuntimeHealthV7, RuntimeModeV7, RuntimeBudgetsV7, clampV7 } from './types.ts';

export type RenderFeatureV7 =
  | 'shadows' | 'ssao' | 'reflections' | 'fog' | 'vegetation' | 'particles'
  | 'decals' | 'water' | 'postfx' | 'animation' | 'terrainDetail';

export interface RenderProfileV7 {
  readonly mode: RuntimeModeV7;
  readonly scale: number;
  readonly pixelRatioCap: number;
  readonly shadowMap: 256 | 512 | 1024 | 2048 | 4096;
  readonly maxDrawCalls: number;
  readonly maxTriangles: number;
  readonly textureBudgetBytes: number;
  readonly features: Readonly<Record<RenderFeatureV7, boolean>>;
  readonly lodDistances: readonly [number, number, number, number];
}

const allFeatures = (enabled: Partial<Record<RenderFeatureV7, boolean>> = {}): Readonly<Record<RenderFeatureV7, boolean>> => Object.freeze({
  shadows: true, ssao: true, reflections: true, fog: true, vegetation: true, particles: true,
  decals: true, water: true, postfx: true, animation: true, terrainDetail: true, ...enabled,
});

export function resolveRenderProfileV7(profile: PlatformProfileV7): RenderProfileV7 {
  const constrained = profile.mode === 'constrained' || profile.saveData;
  const mobile = profile.mode === 'balanced' || profile.deviceMemoryGb !== null && profile.deviceMemoryGb <= 4;
  const mode = profile.mode;
  const scale = constrained ? 0.7 : mobile ? 0.84 : 1;
  const pixelRatioCap = constrained ? 1.25 : mobile ? 1.5 : profile.webgpu ? 2.5 : 2;
  const shadowMap = constrained ? 256 : mobile ? 512 : profile.webgpu ? 2048 : 1024;
  return Object.freeze({
    mode, scale, pixelRatioCap, shadowMap,
    maxDrawCalls: constrained ? 350 : mobile ? 700 : profile.webgpu ? 2200 : 1500,
    maxTriangles: constrained ? 350_000 : mobile ? 900_000 : profile.webgpu ? 6_000_000 : 3_000_000,
    textureBudgetBytes: constrained ? 32 * 1024 * 1024 : mobile ? 96 * 1024 * 1024 : profile.webgpu ? 384 * 1024 * 1024 : 192 * 1024 * 1024,
    features: allFeatures(constrained
      ? { shadows: true, ssao: false, reflections: false, particles: false, decals: false, postfx: false, terrainDetail: false }
      : mobile
        ? { ssao: false, reflections: false, particles: true, decals: false }
        : {}),
    lodDistances: constrained ? [24, 48, 90, 160] : mobile ? [32, 72, 128, 220] : [48, 110, 220, 420],
  });
}

export interface RenderDecisionV7 {
  readonly profile: RenderProfileV7;
  readonly effectiveScale: number;
  readonly effectivePixelRatio: number;
  readonly disabled: readonly RenderFeatureV7[];
  readonly pressure: number;
}

export class AdaptiveRenderPolicyV7 {
  #profile: RenderProfileV7;
  #scaleBias = 1;
  #pressureHistory: number[] = [];

  constructor(profile: RenderProfileV7) { this.#profile = profile; }

  get profile(): RenderProfileV7 { return this.#profile; }

  decide(budget: RenderBudgetV7, health: RuntimeHealthV7 | null = null): RenderDecisionV7 {
    const framePressure = budget.frameMs / 16.67;
    const drawPressure = budget.drawCalls / Math.max(1, this.#profile.maxDrawCalls);
    const trianglePressure = budget.triangles / Math.max(1, this.#profile.maxTriangles);
    const memoryPressure = Math.max(
      budget.textureBytes / Math.max(1, this.#profile.textureBudgetBytes),
      budget.gpuMemoryBytes / Math.max(1, this.#profile.textureBudgetBytes * 1.5),
    );
    const healthPressure = health ? Math.max(0, 1 - health.score / 100) : 0;
    const pressure = Math.max(framePressure, drawPressure, trianglePressure, memoryPressure, healthPressure);
    this.#pressureHistory.push(pressure);
    while (this.#pressureHistory.length > 30) this.#pressureHistory.shift();

    const recent = this.#pressureHistory.slice(-6);
    const average = recent.reduce((sum, value) => sum + value, 0) / Math.max(1, recent.length);
    if (average > 1.08) this.#scaleBias = Math.max(0.65, this.#scaleBias - 0.04);
    else if (average < 0.78) this.#scaleBias = Math.min(1, this.#scaleBias + 0.02);

    const disabled: RenderFeatureV7[] = [];
    if (average > 1.35) disabled.push('reflections', 'ssao', 'particles');
    if (average > 1.15) disabled.push('decals', 'terrainDetail');
    if (average > 1.05) disabled.push('postfx');
    for (const feature of Object.keys(this.#profile.features) as RenderFeatureV7[]) if (!this.#profile.features[feature] && !disabled.includes(feature)) disabled.push(feature);

    return Object.freeze({
      profile: this.#profile,
      effectiveScale: clampV7(this.#profile.scale * this.#scaleBias, 0.5, 1),
      effectivePixelRatio: clampV7(this.#profile.pixelRatioCap * this.#scaleBias, 1, this.#profile.pixelRatioCap),
      disabled: Object.freeze([...new Set(disabled)]),
      pressure: Number(pressure.toFixed(4)),
    });
  }

  reset(): void { this.#scaleBias = 1; this.#pressureHistory.length = 0; }
}

export function budgetDefaultsV7(profile: RenderProfileV7): RuntimeBudgetsV7 {
  return Object.freeze({
    render: Object.freeze({
      frameMs: 16.67, drawCalls: profile.maxDrawCalls, triangles: profile.maxTriangles,
      textureBytes: profile.textureBudgetBytes, gpuMemoryBytes: Math.floor(profile.textureBudgetBytes * 1.5),
    }),
    simulation: Object.freeze({ tickMs: 4, actorUpdates: 1000, pathQueries: 120, physicsQueries: 300 }),
    network: Object.freeze({ maxBytesPerSecond: 64 * 1024, maxPacketBytes: 1200, maxSnapshotsPerSecond: 30, maxCommandsPerSecond: 120 }),
    schedulerMs: 2.5,
  });
}
