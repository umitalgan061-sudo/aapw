/**
 * Capability-first rendering backend selection for the browser 3D client.
 *
 * WebGPU is intentionally an optional accelerator rather than a hard requirement: current browser
 * compatibility is not universal, while the existing Three.js/WebGL renderer is the reliable floor.
 * This module owns capability discovery, deterministic policy selection, and diagnostics only. It does
 * not create a renderer and therefore cannot steal scene/asset ownership from sceneManager.js.
 * @module renderBackendCapability
 */

interface NavigatorCapabilities {
  readonly gpu?: { readonly requestAdapter?: unknown };
  readonly hardwareConcurrency?: number;
  readonly deviceMemory?: number;
}

export type RenderBackendId = 'webgpu' | 'webgl2' | 'webgl' | 'none';
export type RenderTier = 'ultra' | 'high' | 'balanced' | 'compatibility' | 'unsupported';

export interface RenderCapabilities {
  readonly webgpu: boolean;
  readonly webgl2: boolean;
  readonly webgl: boolean;
  readonly cpuCores: number;
  readonly memoryGiB: number;
  readonly coarsePointer: boolean;
  readonly pixelRatio: number;
  readonly secureContext: boolean;
  readonly offscreenCanvas: boolean;
  readonly worker: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly crossOriginIsolated: boolean;
}

export interface RenderBackendPolicy {
  readonly preferWebGPU: boolean;
  readonly requireWebGPUForUltra: boolean;
  readonly allowWebGPUWorker: boolean;
  readonly minimumDevicePixelRatio: number;
  readonly maxDevicePixelRatio: number;
}

export interface RenderBackendSelection {
  readonly backend: RenderBackendId;
  readonly tier: RenderTier;
  readonly hardwareScore: number;
}

export interface RenderProfile {
  readonly backend: RenderBackendId;
  readonly tier: RenderTier;
  readonly pixelRatioCap: number;
  readonly shadowMap: number;
  readonly waterSegments: number;
  readonly vegetationMultiplier: number;
  readonly enableExpensivePostFX: boolean;
  readonly enableTemporalHistory: boolean;
  readonly enableWorkerRendering: boolean;
}

interface CapabilityWindow {
  readonly devicePixelRatio?: number;
  readonly matchMedia?: Window['matchMedia'];
}

const DEFAULT_POLICY = Object.freeze({
  preferWebGPU: true,
  requireWebGPUForUltra: false,
  allowWebGPUWorker: true,
  minimumDevicePixelRatio: 1,
  maxDevicePixelRatio: 2,
});

const BACKENDS: Readonly<{ WEBGPU: 'webgpu'; WEBGL2: 'webgl2'; WEBGL: 'webgl'; NONE: 'none' }> = Object.freeze({
  WEBGPU: 'webgpu',
  WEBGL2: 'webgl2',
  WEBGL: 'webgl',
  NONE: 'none',
});

function finite(value: unknown, fallback = 0): number {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function readCoarsePointer({ windowObject = globalThis.window }: { readonly windowObject?: CapabilityWindow } = {}): boolean {
  try {
    return Boolean(windowObject?.matchMedia?.('(pointer: coarse)')?.matches);
  } catch {
    return false;
  }
}

function safeDevicePixelRatio({ windowObject = globalThis.window }: { readonly windowObject?: CapabilityWindow } = {}): number {
  try {
    return Math.max(1, finite(windowObject?.devicePixelRatio, 1));
  } catch {
    return 1;
  }
}

function detectWebGPU({ navigatorObject = globalThis.navigator }: { readonly navigatorObject?: NavigatorCapabilities } = {}): boolean {
  return Boolean(navigatorObject?.gpu?.requestAdapter);
}

function detectWebGLContext({ documentObject = globalThis.document, kind = 'webgl2' }: { readonly documentObject?: Document; readonly kind?: 'webgl2' | 'webgl' } = {}): boolean {
  try {
    const canvas = documentObject?.createElement?.('canvas');
    if (!canvas?.getContext) return false;
    const context = canvas.getContext(kind, { failIfMajorPerformanceCaveat: false }) as WebGLRenderingContext | WebGL2RenderingContext | null;
    if (!context) return false;
    const loseContext = context.getExtension?.('WEBGL_lose_context');
    loseContext?.loseContext?.();
    return true;
  } catch {
    return false;
  }
}

export function detectRenderCapabilities({
  navigatorObject = globalThis.navigator,
  documentObject = globalThis.document,
  windowObject = globalThis.window,
}: {
  readonly navigatorObject?: NavigatorCapabilities;
  readonly documentObject?: Document;
  readonly windowObject?: CapabilityWindow;
}: {
  readonly navigatorObject?: NavigatorCapabilities;
  readonly documentObject?: Document;
  readonly windowObject?: CapabilityWindow;
} = {}): RenderCapabilities {
  const webgpu = detectWebGPU({ navigatorObject });
  const webgl2 = detectWebGLContext({ documentObject, kind: 'webgl2' });
  const webgl = webgl2 || detectWebGLContext({ documentObject, kind: 'webgl' });
  const cpuCores = Math.max(1, Math.round(finite(navigatorObject?.hardwareConcurrency, 1)));
  const memoryGiB = finite(navigatorObject?.deviceMemory, 0);
  const coarsePointer = readCoarsePointer({ windowObject });
  const pixelRatio = safeDevicePixelRatio({ windowObject });
  const secureContext = Boolean(globalThis.isSecureContext ?? true);
  return Object.freeze({
    webgpu,
    webgl2,
    webgl,
    cpuCores,
    memoryGiB,
    coarsePointer,
    pixelRatio,
    secureContext,
    offscreenCanvas: typeof globalThis.OffscreenCanvas === 'function',
    worker: typeof globalThis.Worker === 'function',
    sharedArrayBuffer: typeof globalThis.SharedArrayBuffer === 'function',
    crossOriginIsolated: Boolean(globalThis.crossOriginIsolated),
  });
}

function scoreHardware(capabilities: RenderCapabilities): number {
  const cpuScore = Math.min(1, capabilities.cpuCores / 8);
  const memoryScore = capabilities.memoryGiB > 0 ? Math.min(1, capabilities.memoryGiB / 8) : cpuScore;
  const gpuScore = capabilities.webgpu ? 1 : capabilities.webgl2 ? 0.72 : capabilities.webgl ? 0.45 : 0;
  const desktopBonus = capabilities.coarsePointer ? 0 : 0.06;
  return Math.min(1, gpuScore * 0.62 + cpuScore * 0.2 + memoryScore * 0.12 + desktopBonus);
}

export function selectRenderBackend(capabilities: RenderCapabilities, policy: Partial<RenderBackendPolicy> = DEFAULT_POLICY): RenderBackendSelection {
  const merged: RenderBackendPolicy = { ...DEFAULT_POLICY, ...policy };
  const hardwareScore = scoreHardware(capabilities);
  const canUseWebGPU = capabilities.webgpu && capabilities.secureContext;
  let backend: RenderBackendId = BACKENDS.NONE;
  let tier: RenderTier = 'unsupported';
  if (canUseWebGPU && merged.preferWebGPU) {
    backend = BACKENDS.WEBGPU;
    tier = hardwareScore >= 0.78 ? 'ultra' : hardwareScore >= 0.56 ? 'high' : 'balanced';
  } else if (capabilities.webgl2) {
    backend = BACKENDS.WEBGL2;
    tier = hardwareScore >= 0.56 ? 'high' : hardwareScore >= 0.35 ? 'balanced' : 'compatibility';
  } else if (capabilities.webgl) {
    backend = BACKENDS.WEBGL;
    tier = 'compatibility';
  }
  if (merged.requireWebGPUForUltra && tier === 'ultra' && backend !== BACKENDS.WEBGPU) tier = 'high';
  return Object.freeze({ backend, tier, hardwareScore: Number(hardwareScore.toFixed(4)) });
}

export function buildRenderProfile(capabilities: RenderCapabilities, selection: RenderBackendSelection, policy: Partial<RenderBackendPolicy> = DEFAULT_POLICY): RenderProfile {
  const merged = { ...DEFAULT_POLICY, ...policy };
  const baseRatio = Math.min(merged.maxDevicePixelRatio, Math.max(merged.minimumDevicePixelRatio, capabilities.pixelRatio));
  const mobilePenalty = capabilities.coarsePointer ? 0.75 : 1;
  const tierScale = selection.tier === 'ultra' ? 1 : selection.tier === 'high' ? 0.92 : selection.tier === 'balanced' ? 0.82 : 0.66;
  const pixelRatioCap = Number((baseRatio * mobilePenalty * tierScale).toFixed(3));
  return Object.freeze({
    backend: selection.backend,
    tier: selection.tier,
    pixelRatioCap: Math.max(0.75, pixelRatioCap),
    shadowMap: selection.tier === 'ultra' ? 4096 : selection.tier === 'high' ? 2048 : 1024,
    waterSegments: selection.tier === 'ultra' ? 96 : selection.tier === 'high' ? 72 : selection.tier === 'balanced' ? 48 : 24,
    vegetationMultiplier: selection.tier === 'ultra' ? 1 : selection.tier === 'high' ? 0.84 : selection.tier === 'balanced' ? 0.68 : 0.45,
    enableExpensivePostFX: selection.tier === 'ultra' || selection.tier === 'high',
    enableTemporalHistory: selection.backend === BACKENDS.WEBGPU && selection.tier !== 'compatibility',
    enableWorkerRendering: Boolean(
      merged.allowWebGPUWorker && selection.backend === BACKENDS.WEBGPU && capabilities.worker && capabilities.offscreenCanvas,
    ),
  });
}

export function createRenderBackendReport({ capabilities, selection, profile }: { readonly capabilities: RenderCapabilities; readonly selection: RenderBackendSelection; readonly profile: RenderProfile }) {
  const unsupported = [];
  if (!capabilities.webgpu) unsupported.push('webgpu');
  if (!capabilities.webgl2) unsupported.push('webgl2');
  if (!capabilities.offscreenCanvas) unsupported.push('offscreencanvas');
  if (!capabilities.sharedArrayBuffer || !capabilities.crossOriginIsolated) unsupported.push('shared-memory');
  return Object.freeze({
    version: 1,
    backend: selection.backend,
    tier: selection.tier,
    hardwareScore: selection.hardwareScore,
    profile,
    capabilities,
    unsupported,
    generatedAt: 'runtime',
  });
}

export function resolveRenderBackend({ capabilities = detectRenderCapabilities(), policy = DEFAULT_POLICY }: { readonly capabilities?: RenderCapabilities; readonly policy?: Partial<RenderBackendPolicy> } = {}) {
  const selection = selectRenderBackend(capabilities, policy);
  const profile = buildRenderProfile(capabilities, selection, policy);
  return createRenderBackendReport({ capabilities, selection, profile });
}

export { BACKENDS, DEFAULT_POLICY };