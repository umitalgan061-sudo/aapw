import type { CapabilitySnapshot } from './types.js';
import { clamp } from './deterministic.js';

export type PlatformTier = 'low' | 'balanced' | 'high' | 'ultra';
export interface PlatformProfile extends CapabilitySnapshot { readonly tier: PlatformTier; readonly pixelRatioCap: number; readonly workerCount: number; readonly supportsParallelSimulation: boolean; readonly supportsOffscreenRendering: boolean; readonly notes: readonly string[]; }

export const probeCapabilities = (scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): CapabilitySnapshot => {
  const navigatorValue = (scope.navigator ?? {}) as Navigator & { deviceMemory?: number; gpu?: unknown };
  const crossOrigin = Boolean(scope.crossOriginIsolated);
  const webgl2 = canCreateContext('webgl2', scope);
  const webgpu = Boolean(navigatorValue.gpu) && typeof (navigatorValue.gpu as { requestAdapter?: unknown }).requestAdapter === 'function';
  const offscreen = typeof scope.OffscreenCanvas === 'function';
  const worker = typeof scope.Worker === 'function';
  const sab = typeof scope.SharedArrayBuffer === 'function';
  const touch = typeof scope.ontouchstart !== 'undefined' || Number(navigatorValue.maxTouchPoints ?? 0) > 0;
  const gamepad = typeof navigatorValue.getGamepads === 'function';
  return Object.freeze({
    webgl2,
    webgpu,
    offscreenCanvas: offscreen,
    sharedArrayBuffer: sab,
    crossOriginIsolated: crossOrigin,
    gamepad,
    touch,
    worker,
    deviceMemoryGb: finitePositive(navigatorValue.deviceMemory, 0),
    hardwareConcurrency: Math.max(1, Math.trunc(navigatorValue.hardwareConcurrency ?? 1)),
  });
};

export const buildPlatformProfile = (capabilities: CapabilitySnapshot): PlatformProfile => {
  const memory = capabilities.deviceMemoryGb;
  const cores = capabilities.hardwareConcurrency;
  const tier: PlatformTier = capabilities.webgpu && memory >= 8 && cores >= 8 ? 'ultra' : capabilities.webgpu && memory >= 4 && cores >= 4 ? 'high' : memory >= 2 && cores >= 4 ? 'balanced' : 'low';
  const ratio: Record<PlatformTier, number> = { low: 1, balanced: 1.25, high: 1.75, ultra: 2.25 };
  const notes: string[] = [];
  if (!capabilities.webgpu) notes.push('webgpu-unavailable');
  if (!capabilities.sharedArrayBuffer || !capabilities.crossOriginIsolated) notes.push('shared-memory-unavailable');
  if (!capabilities.offscreenCanvas) notes.push('offscreen-unavailable');
  return Object.freeze({ ...capabilities, tier, pixelRatioCap: ratio[tier], workerCount: Math.max(1, Math.min(12, cores - 1)), supportsParallelSimulation: capabilities.sharedArrayBuffer && capabilities.crossOriginIsolated && cores >= 4, supportsOffscreenRendering: capabilities.offscreenCanvas && capabilities.worker, notes: Object.freeze(notes) });
};

export const choosePreferredBackend = (profile: PlatformProfile): 'webgpu' | 'webgl2' | 'none' => {
  if (profile.webgpu) return 'webgpu';
  if (profile.webgl2) return 'webgl2';
  return 'none';
};

export const capabilityScore = (profile: PlatformProfile): number => clamp((profile.webgpu ? 0.35 : 0) + (profile.webgl2 ? 0.2 : 0) + (profile.offscreenCanvas ? 0.1 : 0) + (profile.supportsParallelSimulation ? 0.15 : 0) + Math.min(0.2, profile.deviceMemoryGb / 40 + profile.hardwareConcurrency / 80), 0, 1);

const finitePositive = (value: number | undefined, fallback: number): number => Number.isFinite(value) && (value ?? 0) > 0 ? Number(value) : fallback;
const canCreateContext = (kind: 'webgl2' | 'webgl', scope: Record<string, unknown>): boolean => {
  const documentValue = scope.document as { createElement?: (name: string) => { getContext?: (type: string) => unknown } } | undefined;
  if (!documentValue?.createElement) return false;
  try { return Boolean(documentValue.createElement('canvas').getContext?.(kind)); } catch { return false; }
};
