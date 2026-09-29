import type {
  BackendKind,
  RenderCapabilities,
  RenderProfile,
} from './contracts.ts';

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function matchMedia(
  windowObject: Window | undefined,
  query: string,
): boolean {
  try {
    return Boolean(windowObject?.matchMedia?.(query)?.matches);
  } catch {
    return false;
  }
}

function detectWebGpu(navigatorObject: Navigator | undefined): boolean {
  try {
    return Boolean(navigatorObject && 'gpu' in navigatorObject);
  } catch {
    return false;
  }
}

function detectWebGl(
  documentObject: Document | undefined,
  kind: 'webgl2' | 'webgl',
): boolean {
  try {
    const canvas = documentObject?.createElement?.('canvas');
    return canvas?.getContext(kind) !== null;
  } catch {
    return false;
  }
}

export function detectR25Capabilities(
  options: {
    readonly navigatorObject?: Navigator;
    readonly documentObject?: Document;
    readonly windowObject?: Window;
    readonly maxTextureSize?: number;
    readonly maxSamples?: number;
  } = {},
): RenderCapabilities {
  const navigatorObject = options.navigatorObject ?? (
    typeof navigator === 'undefined' ? undefined : navigator
  );
  const documentObject = options.documentObject ?? (
    typeof document === 'undefined' ? undefined : document
  );
  const windowObject = options.windowObject ?? (
    typeof window === 'undefined' ? undefined : window
  );

  const webgpu = detectWebGpu(navigatorObject);
  const webgl2 = detectWebGl(documentObject, 'webgl2');
  const webgl = webgl2 || detectWebGl(documentObject, 'webgl');
  const secureContext = typeof globalThis.isSecureContext === 'boolean'
    ? globalThis.isSecureContext
    : true;

  const viewportWidth = Math.max(
    1,
    Math.round(finite(windowObject?.innerWidth, 1920)),
  );
  const viewportHeight = Math.max(
    1,
    Math.round(finite(windowObject?.innerHeight, 1080)),
  );

  const deviceMemory = (navigatorObject as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  } | undefined)?.deviceMemory;

  return Object.freeze({
    backend: webgpu ? 'webgpu' : webgl2 ? 'webgl2' : webgl ? 'webgl' : 'none',
    webgpu,
    webgl2,
    webgl,
    secureContext,
    offscreenCanvas: typeof OffscreenCanvas === 'function',
    sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
    crossOriginIsolated: Boolean(globalThis.crossOriginIsolated),
    maxTextureSize: Math.max(512, Math.trunc(options.maxTextureSize ?? 8192)),
    maxSamples: Math.max(1, Math.trunc(options.maxSamples ?? 8)),
    maxUniformBufferSize: 65536,
    deviceMemoryGb: Math.max(0, finite(deviceMemory, 0)),
    hardwareConcurrency: Math.max(
      1,
      Math.round(finite(navigatorObject?.hardwareConcurrency, 4)),
    ),
    pixelRatio: clamp(finite(windowObject?.devicePixelRatio, 1), 0.5, 4),
    viewportWidth,
    viewportHeight,
    prefersReducedMotion: matchMedia(windowObject, '(prefers-reduced-motion: reduce)'),
    saveData: Boolean(
      (navigatorObject as Navigator & {
        connection?: { saveData?: boolean };
      } | undefined)?.connection?.saveData,
    ),
    coarsePointer: matchMedia(windowObject, '(pointer: coarse)'),
  });
}

export interface BackendSelectionR25 {
  readonly backend: BackendKind;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly safeMode: boolean;
}

export function selectR25Backend(
  capabilities: RenderCapabilities,
  options: {
    readonly preferWebGpu?: boolean;
    readonly requireSecureContext?: boolean;
    readonly allowWebglFallback?: boolean;
    readonly force?: BackendKind;
  } = {},
): BackendSelectionR25 {
  const reasons: string[] = [];
  const force = options.force;

  if (force) {
    const available =
      force === 'webgpu'
        ? capabilities.webgpu && (!capabilities.secureContext || options.requireSecureContext === false)
        : force === 'webgl2'
          ? capabilities.webgl2
          : force === 'webgl'
            ? capabilities.webgl
            : force === 'none';

    if (available) {
      return Object.freeze({
        backend: force,
        score: force === 'webgpu' ? 1 : force === 'webgl2' ? 0.8 : force === 'webgl' ? 0.48 : 0,
        reasons: ['forced'],
        safeMode: force === 'none' || force === 'webgl',
      });
    }

    reasons.push(`forced-unavailable:${force}`);
  }

  const secureRequired = options.requireSecureContext !== false;
  const allowFallback = options.allowWebglFallback !== false;

  if (
    capabilities.webgpu &&
    (!secureRequired || capabilities.secureContext) &&
    options.preferWebGpu !== false
  ) {
    reasons.push('webgpu');
    if (capabilities.offscreenCanvas) reasons.push('offscreen-canvas');
    if (capabilities.crossOriginIsolated) reasons.push('cross-origin-isolated');
    return Object.freeze({
      backend: 'webgpu',
      score: 1,
      reasons,
      safeMode: false,
    });
  }

  if (capabilities.webgl2 && allowFallback) {
    reasons.push('webgl2-fallback');
    if (!capabilities.webgpu) reasons.push('no-webgpu');
    return Object.freeze({
      backend: 'webgl2',
      score: 0.82,
      reasons,
      safeMode: false,
    });
  }

  if (capabilities.webgl && allowFallback) {
    reasons.push('webgl-compatibility');
    return Object.freeze({
      backend: 'webgl',
      score: 0.46,
      reasons,
      safeMode: true,
    });
  }

  reasons.push('no-renderer');
  return Object.freeze({
    backend: 'none',
    score: 0,
    reasons,
    safeMode: true,
  });
}

function hardwareScore(capabilities: RenderCapabilities): number {
  const cpu = clamp(capabilities.hardwareConcurrency / 16, 0, 1);
  const memory = capabilities.deviceMemoryGb > 0
    ? clamp(capabilities.deviceMemoryGb / 16, 0, 1)
    : cpu;
  const gpu =
    capabilities.backend === 'webgpu'
      ? 1
      : capabilities.webgl2
        ? 0.72
        : capabilities.webgl
          ? 0.45
          : 0;

  const isolationBonus = capabilities.crossOriginIsolated ? 0.04 : 0;
  const deviceBonus = capabilities.coarsePointer ? 0 : 0.04;

  return clamp(
    gpu * 0.58 +
      cpu * 0.2 +
      memory * 0.12 +
      isolationBonus +
      deviceBonus,
    0,
    1,
  );
}

export function buildR25RenderProfile(
  capabilities: RenderCapabilities,
  selection: BackendSelectionR25,
): RenderProfile {
  const score = hardwareScore(capabilities);
  const tier =
    score >= 0.8 && selection.backend === 'webgpu'
      ? 'ultra'
      : score >= 0.62
        ? 'high'
        : score >= 0.44
          ? 'balanced'
          : score >= 0.24
            ? 'low'
            : 'safe';

  const mobileFactor = capabilities.coarsePointer ? 0.76 : 1;
  const saveDataFactor = capabilities.saveData ? 0.82 : 1;
  const reducedMotionFactor = capabilities.prefersReducedMotion ? 0.84 : 1;
  const backendFactor =
    selection.backend === 'webgpu'
      ? 1
      : selection.backend === 'webgl2'
        ? 0.88
        : selection.backend === 'webgl'
          ? 0.65
          : 0.5;

  const scale = mobileFactor * saveDataFactor * reducedMotionFactor * backendFactor;

  return Object.freeze({
    tier,
    backend: selection.backend,
    pixelRatio: Number(
      clamp(
        capabilities.pixelRatio * scale,
        0.65,
        capabilities.coarsePointer ? 1.5 : 2.5,
      ).toFixed(3),
    ),
    shadowResolution:
      tier === 'ultra' ? 4096 :
      tier === 'high' ? 2048 :
      tier === 'balanced' ? 1536 :
      tier === 'low' ? 1024 :
      512,
    drawDistanceMeters:
      tier === 'ultra' ? 9000 :
      tier === 'high' ? 7000 :
      tier === 'balanced' ? 5200 :
      tier === 'low' ? 3200 :
      1800,
    vegetationDensity:
      tier === 'ultra' ? 1 :
      tier === 'high' ? 0.88 :
      tier === 'balanced' ? 0.68 :
      tier === 'low' ? 0.46 :
      0.22,
    particleDensity:
      tier === 'ultra' ? 1 :
      tier === 'high' ? 0.82 :
      tier === 'balanced' ? 0.64 :
      tier === 'low' ? 0.42 :
      0.16,
    postFxQuality:
      tier === 'ultra' ? 1 :
      tier === 'high' ? 0.82 :
      tier === 'balanced' ? 0.56 :
      tier === 'low' ? 0.28 :
      0,
    temporalHistory:
      selection.backend === 'webgpu' &&
      tier !== 'safe' &&
      !capabilities.prefersReducedMotion,
    targetFps: capabilities.coarsePointer ? 60 : tier === 'ultra' ? 120 : 60,
    maxVisibleObjects:
      tier === 'ultra' ? 140000 :
      tier === 'high' ? 105000 :
      tier === 'balanced' ? 72000 :
      tier === 'low' ? 42000 :
      18000,
  });
}

export interface RendererBackendR25 {
  readonly backend: BackendKind;
  readonly renderer: unknown;
  readonly initialized: boolean;
  readonly fallback: boolean;
  readonly dispose: () => void | Promise<void>;
  readonly resize: (width: number, height: number, pixelRatio?: number) => void;
}

export interface RendererModuleR25 {
  readonly WebGLRenderer?: new (options: Record<string, unknown>) => {
    setPixelRatio?(ratio: number): void;
    setSize?(width: number, height: number, updateStyle?: boolean): void;
    dispose?(): void;
  };
  readonly WebGPURenderer?: new (options: Record<string, unknown>) => {
    setPixelRatio?(ratio: number): void;
    setSize?(width: number, height: number, updateStyle?: boolean): void;
    init?(): Promise<void>;
    dispose?(): void;
  };
  readonly SRGBColorSpace?: unknown;
}

export type RendererModuleLoaderR25 = (
  specifier: 'three' | 'three/webgpu',
) => Promise<RendererModuleR25>;

export async function createR25Renderer(
  options: {
    readonly canvas: HTMLCanvasElement;
    readonly profile: RenderProfile;
    readonly capabilities: RenderCapabilities;
    readonly moduleLoader?: RendererModuleLoaderR25;
    readonly antialias?: boolean;
    readonly alpha?: boolean;
  },
): Promise<RendererBackendR25> {
  const loader = options.moduleLoader ?? (async (specifier) => (
    (await import(specifier)) as unknown as RendererModuleR25
  ));
  const width = Math.max(1, options.capabilities.viewportWidth);
  const height = Math.max(1, options.capabilities.viewportHeight);
  const rendererOptions = {
    canvas: options.canvas,
    antialias: options.antialias !== false,
    alpha: options.alpha === true,
  };

  if (options.profile.backend === 'webgpu') {
    try {
      const THREE = await loader('three/webgpu');
      if (typeof THREE.WebGPURenderer !== 'function') {
        throw new Error('R25_WEBGPU_RENDERER_UNAVAILABLE');
      }
      const renderer = new THREE.WebGPURenderer(rendererOptions);
      renderer.setPixelRatio?.(options.profile.pixelRatio);
      renderer.setSize?.(width, height, false);
      await renderer.init?.();
      return Object.freeze({
        backend: 'webgpu',
        renderer,
        initialized: true,
        fallback: false,
        dispose: () => renderer.dispose?.(),
        resize: (w, h, ratio = options.profile.pixelRatio) => {
          renderer.setPixelRatio?.(Math.max(0.5, ratio));
          renderer.setSize?.(Math.max(1, Math.trunc(w)), Math.max(1, Math.trunc(h)), false);
        },
      });
    } catch (error) {
      if (!options.capabilities.webgl2) throw error;
    }
  }

  const THREE = await loader('three');
  if (typeof THREE.WebGLRenderer !== 'function') {
    throw new Error('R25_WEBGL_RENDERER_UNAVAILABLE');
  }

  const renderer = new THREE.WebGLRenderer(rendererOptions);
  renderer.setPixelRatio?.(options.profile.pixelRatio);
  renderer.setSize?.(width, height, false);

  return Object.freeze({
    backend: 'webgl2',
    renderer,
    initialized: true,
    fallback: options.profile.backend === 'webgpu',
    dispose: () => renderer.dispose?.(),
    resize: (w, h, ratio = options.profile.pixelRatio) => {
      renderer.setPixelRatio?.(Math.max(0.5, ratio));
      renderer.setSize?.(Math.max(1, Math.trunc(w)), Math.max(1, Math.trunc(h)), false);
    },
  });
}
