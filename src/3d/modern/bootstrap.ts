import type { ModernRuntime, QualityTier, RuntimeOptions } from './types';
import { ModernGameRuntime, detectDeviceCapabilities } from './runtime';

export interface ModernBootstrapOptions extends Omit<RuntimeOptions, 'seed'> { readonly seed?: number; readonly canvas?: HTMLCanvasElement | OffscreenCanvas; readonly exposeGlobal?: boolean; }

export const createModernRuntime = (options: ModernBootstrapOptions = {}): ModernRuntime => {
  const capabilities = detectDeviceCapabilities();
  const runtimeOptions: RuntimeOptions = {
    seed: options.seed ?? 0x57455354,
    ...(options.quality ? { quality: options.quality as QualityTier } : {}),
    ...(options.byteBudget !== undefined ? { byteBudget: options.byteBudget } : {}),
    ...(options.schedulerBudgetMs !== undefined ? { schedulerBudgetMs: options.schedulerBudgetMs } : {}),
    ...(options.enableWorkers !== undefined ? { enableWorkers: options.enableWorkers } : {}),
    ...(options.enablePersistence !== undefined ? { enablePersistence: options.enablePersistence } : {}),
    ...(options.enableAdaptiveQuality !== undefined ? { enableAdaptiveQuality: options.enableAdaptiveQuality } : {}),
  };
  const runtime = new ModernGameRuntime(runtimeOptions, { environment: { capabilities, now: () => performance.now(), canvas: options.canvas } });
  if (options.exposeGlobal && typeof window !== 'undefined') (window as Window & { aapwModernRuntime?: ModernRuntime }).aapwModernRuntime = runtime;
  return runtime;
};

export const bootModernRuntime = async (options: ModernBootstrapOptions = {}): Promise<ModernRuntime> => { const runtime = createModernRuntime(options); await runtime.start(); return runtime; };
