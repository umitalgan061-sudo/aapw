import type { PlatformProfileV7, RuntimeModeV7 } from './types.ts';


const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export function detectPlatformProfileV7(source: {
  readonly navigator?: Partial<Navigator> & { readonly deviceMemory?: number; readonly connection?: { readonly saveData?: boolean } };
  readonly window?: { readonly innerWidth?: number; readonly innerHeight?: number; readonly matchMedia?: (query: string) => { matches: boolean } };
  readonly webgpu?: boolean;
  readonly offscreenCanvas?: boolean;
} = {}): PlatformProfileV7 {
  const navigatorObject = source.navigator;
  const windowObject = source.window;
  const width = Math.max(1, Math.trunc(numberOr(windowObject?.innerWidth, 1280)));
  const height = Math.max(1, Math.trunc(numberOr(windowObject?.innerHeight, 720)));
  const hardwareConcurrency = Math.max(1, Math.trunc(numberOr(navigatorObject?.hardwareConcurrency, 4)));
  const memory = navigatorObject?.deviceMemory;
  const saveData = Boolean(navigatorObject?.connection?.saveData);
  const reducedMotion = Boolean(windowObject?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  const touchPoints = Math.max(0, Math.trunc(numberOr(navigatorObject?.maxTouchPoints, 0)));
  const constrained = saveData || hardwareConcurrency <= 2 || (memory !== undefined && memory <= 2);
  const mobile = touchPoints > 0 && Math.max(width, height) < 1100;
  const mode: RuntimeModeV7 = constrained ? 'constrained' : mobile ? 'balanced' : 'full';
  return Object.freeze({
    mode,
    hardwareConcurrency,
    deviceMemoryGb: memory !== undefined && Number.isFinite(memory) ? memory : null,
    webgpu: Boolean(source.webgpu),
    offscreenCanvas: Boolean(source.offscreenCanvas),
    reducedMotion,
    saveData,
  });
}

export function platformProfileForTestsV7(mode: RuntimeModeV7): PlatformProfileV7 {
  return Object.freeze({
    mode,
    hardwareConcurrency: mode === 'constrained' ? 2 : mode === 'balanced' ? 4 : 12,
    deviceMemoryGb: mode === 'constrained' ? 2 : mode === 'balanced' ? 4 : 16,
    webgpu: mode === 'full',
    offscreenCanvas: mode !== 'constrained',
    reducedMotion: false,
    saveData: mode === 'constrained',
  });
}
