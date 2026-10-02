import type { CapabilityKind, QualityTier } from './contracts';
import { SafeBrowserHost } from './browserHost';
import { evaluateCapabilities, type CapabilitySet } from './capabilityPolicy';

export type PlatformMode =
  | 'desktop'
  | 'tablet'
  | 'mobile'
  | 'constrained'
  | 'headless';

export interface PlatformProfile {
  readonly mode: PlatformMode;
  readonly graphics: 'webgpu' | 'webgl2' | 'headless';
  readonly workers: number;
  readonly textureBudgetBytes: number;
  readonly assetConcurrency: number;
  readonly quality: QualityTier;
  readonly reducedMotion: boolean;
  readonly saveData: boolean;
  readonly usable: boolean;
  readonly missing: readonly CapabilityKind[];
}

export class RuntimePlatformAdapter {
  readonly host: SafeBrowserHost;

  constructor(host = new SafeBrowserHost()) {
    this.host = host;
  }

  profile(requested: QualityTier = 'high'): PlatformProfile {
    const capabilities = this.host.capabilities();
    const memory = capabilities.deviceMemoryGb ?? 8;
    const constrained =
      capabilities.saveData || memory < 4;
    const mobile =
      capabilities.hardwareConcurrency <= 4;
    const mode: PlatformMode = constrained
      ? 'constrained'
      : mobile
        ? 'mobile'
        : capabilities.touchPoints > 0
          ? 'tablet'
          : 'desktop';

    const graphics = capabilities.available.has('webgpu')
      ? 'webgpu'
      : capabilities.available.has('webgl2')
        ? 'webgl2'
        : 'headless';

    const quality = constrained
      ? 'minimal'
      : mode === 'mobile' && requested === 'cinematic'
        ? 'balanced'
        : requested;

    const workers = Math.max(
      1,
      Math.min(8, capabilities.hardwareConcurrency - 1),
    );

    const textureBudgetBytes =
      constrained
        ? 128 * 1024 * 1024
        : memory >= 12
          ? 1024 * 1024 * 1024
          : memory >= 8
            ? 768 * 1024 * 1024
            : 384 * 1024 * 1024;

    const assetConcurrency =
      constrained
        ? 2
        : mode === 'mobile'
          ? 4
          : 8;

    const required: CapabilityKind[] =
      graphics === 'headless'
        ? []
        : ['worker'];

    const capabilitySet: CapabilitySet = {
      values: capabilities.available,
    };

    const capability =
      evaluateCapabilities(
        capabilitySet,
        required,
      );

    return Object.freeze({
      mode,
      graphics,
      workers,
      textureBudgetBytes,
      assetConcurrency,
      quality,
      reducedMotion:
        capabilities.reducedMotion,
      saveData: capabilities.saveData,
      usable: capability.usable,
      missing: capability.missing,
    });
  }
}
