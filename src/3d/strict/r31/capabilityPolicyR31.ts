export interface RuntimeCapabilitiesR31 {
  readonly webgl2: boolean;
  readonly offscreenCanvas: boolean;
  readonly serviceWorker: boolean;
  readonly hardwareConcurrency: number;
  readonly deviceMemoryGb: number | null;
  readonly maxTextureSize: number;
  readonly coarsePointer: boolean;
}

export interface QualityDecisionR31 {
  readonly tier: 'low' | 'medium' | 'high' | 'ultra';
  readonly renderScale: number;
  readonly particleBudget: number;
  readonly shadowDistance: number;
  readonly entityBudget: number;
  readonly rationale: readonly string[];
}

export function detectCapabilitiesR31(): RuntimeCapabilitiesR31 {
  const gl = typeof document !== 'undefined' ? document.createElement('canvas').getContext('webgl2') : null;
  return Object.freeze({
    webgl2: Boolean(gl),
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    hardwareConcurrency: Math.max(1, Math.floor(globalThis.navigator?.hardwareConcurrency ?? 4)),
    deviceMemoryGb: 'deviceMemory' in (globalThis.navigator ?? {})
      ? Number((globalThis.navigator as Navigator & { deviceMemory?: number }).deviceMemory) || null
      : null,
    maxTextureSize: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) as number : 2048,
    coarsePointer: typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)').matches : false,
  });
}

export function chooseQualityTierR31(capabilities: RuntimeCapabilitiesR31, forced?: QualityDecisionR31['tier']): QualityDecisionR31 {
  const rationale: string[] = [];
  let tier: QualityDecisionR31['tier'] = 'high';
  if (!capabilities.webgl2) {
    tier = 'low';
    rationale.push('WebGL2 unavailable');
  } else if (capabilities.coarsePointer || capabilities.hardwareConcurrency <= 2) {
    tier = 'medium';
    rationale.push('mobile/input constrained device');
  } else if ((capabilities.deviceMemoryGb ?? 8) >= 16 && capabilities.hardwareConcurrency >= 12 && capabilities.maxTextureSize >= 8192) {
    tier = 'ultra';
    rationale.push('high-end capability envelope');
  } else {
    rationale.push('standard desktop capability envelope');
  }

  if (forced) {
    tier = forced;
    rationale.push('explicit quality override');
  }

  const table: Record<QualityDecisionR31['tier'], Omit<QualityDecisionR31, 'tier' | 'rationale'>> = {
    low: { renderScale: 0.65, particleBudget: 500, shadowDistance: 250, entityBudget: 300 },
    medium: { renderScale: 0.8, particleBudget: 1000, shadowDistance: 500, entityBudget: 600 },
    high: { renderScale: 1, particleBudget: 2500, shadowDistance: 1200, entityBudget: 1200 },
    ultra: { renderScale: 1.15, particleBudget: 6000, shadowDistance: 2400, entityBudget: 2400 },
  };
  return Object.freeze({ tier, ...table[tier], rationale: Object.freeze(rationale) });
}
