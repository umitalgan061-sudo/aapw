/** Renderer-agnostic GPU feature policy used by the future Three.js adapter. */

import type { QualityPreset } from './runtimeConfigV3';

export type GpuTier = 'unknown' | 'low' | 'mid' | 'high' | 'ultra';
export interface GpuCapabilities { maxTextureSize: number; maxSamples: number; webgl2: boolean; floatColorBuffer: boolean; instancing: boolean; anisotropy: number }
export interface RenderFeatureSet { shadows: boolean; softShadows: boolean; hdr: boolean; taa: boolean; ssr: boolean; volumetrics: boolean; instancing: boolean; anisotropy: number; pixelRatioCap: number; }

export function classifyGpu(capabilities: GpuCapabilities): GpuTier {
  if (!capabilities.webgl2) return 'low';
  if (capabilities.maxTextureSize >= 16384 && capabilities.maxSamples >= 8 && capabilities.floatColorBuffer && capabilities.anisotropy >= 16) return 'ultra';
  if (capabilities.maxTextureSize >= 8192 && capabilities.maxSamples >= 4 && capabilities.floatColorBuffer) return 'high';
  if (capabilities.maxTextureSize >= 4096 && capabilities.maxSamples >= 2) return 'mid';
  return 'low';
}

export function resolveRenderFeatures(quality: QualityPreset, gpu: GpuCapabilities, reducedMotion = false): RenderFeatureSet {
  const tier = classifyGpu(gpu);
  const highTier = tier === 'high' || tier === 'ultra';
  const ultraTier = tier === 'ultra';
  const qualityScale: Record<QualityPreset, number> = { cinematic: 1, high: 0.9, balanced: 0.78, performance: 0.68, battery: 0.55 };
  const scale = qualityScale[quality];
  return {
    shadows: tier !== 'low',
    softShadows: highTier && scale >= 0.78,
    hdr: gpu.floatColorBuffer && quality !== 'battery',
    taa: gpu.webgl2 && !reducedMotion && quality !== 'battery',
    ssr: ultraTier && quality === 'cinematic',
    volumetrics: ultraTier && quality === 'cinematic' && !reducedMotion,
    instancing: gpu.instancing,
    anisotropy: Math.max(1, Math.min(gpu.anisotropy, Math.round(1 + (gpu.anisotropy - 1) * scale))),
    pixelRatioCap: quality === 'cinematic' ? 2 : quality === 'high' ? 1.75 : quality === 'balanced' ? 1.5 : quality === 'performance' ? 1.25 : 1,
  };
}

export function validateRenderFeatures(features: RenderFeatureSet): string[] {
  const errors: string[] = [];
  if (features.anisotropy < 1) errors.push('anisotropy must be >= 1');
  if (features.pixelRatioCap <= 0 || features.pixelRatioCap > 2.5) errors.push('pixelRatioCap is outside supported range');
  if (features.ssr && !features.hdr) errors.push('SSR requires HDR');
  if (features.volumetrics && !features.shadows) errors.push('volumetrics require shadow-capable rendering');
  return errors;
}
