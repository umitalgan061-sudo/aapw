import { ModernGameRuntime, detectDeviceCapabilities } from './runtime';
import type { ModernRuntime, RuntimeOptions } from './types';

export interface ModernBootstrapOptions extends RuntimeOptions {
  readonly canvas?: HTMLCanvasElement | OffscreenCanvas;
  readonly exposeGlobal?: boolean;
}

/**
 * Safe entrypoint for the TypeScript runtime. Legacy pages can call this from a
 * tiny adapter without changing existing scene-manager imports.
 */
export const createModernRuntime = (options: ModernBootstrapOptions = {}): ModernRuntime => {
  const capabilities = detectDeviceCapabilities();
  const runtime = new ModernGameRuntime(
    { seed: options.seed ?? 0x57455354, quality: options.quality, byteBudget: options.byteBudget, schedulerBudgetMs: options.schedulerBudgetMs, enableWorkers: options.enableWorkers, enablePersistence: options.enablePersistence, enableAdaptiveQuality: options.enableAdaptiveQuality },
    { environment: { capabilities, canvas: options.canvas, now: () => performance.now() } },
  );
  if (options.exposeGlobal && typeof window !== 'undefined') {
    (window as Window & { aapwModernRuntime?: ModernRuntime }).aapwModernRuntime = runtime;
  }
  return runtime;
};

export const bootModernRuntime = async (options: ModernBootstrapOptions = {}): Promise<ModernRuntime> => {
  const runtime = createModernRuntime(options);
  await runtime.start();
  return runtime;
};
