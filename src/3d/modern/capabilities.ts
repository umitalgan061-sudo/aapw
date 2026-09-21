import type { GpuLimits, RenderBackend, RenderCapabilities, QualityTier } from './types';

const FALLBACK_LIMITS: GpuLimits = {
  maxTextureDimension2D: 2048,
  maxUniformBufferBindingSize: 16_384,
  maxSampledTexturesPerShaderStage: 8,
  maxColorAttachments: 4,
  maxBindGroups: 4,
};

function numeric(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

export interface RenderCapabilityOptions {
  readonly canvas?: HTMLCanvasElement;
  /**
   * Hint from the concrete renderer factory. The hint prevents capability negotiation from
   * reporting an available WebGPU adapter when the scene is actually rendered through WebGL2.
   */
  readonly backendHint?: Extract<RenderBackend, 'webgpu' | 'webgl2' | 'headless'>;
}

/** Capability negotiation that reflects the backend actually selected by the renderer boundary. */
export async function negotiateRenderCapabilities(options: RenderCapabilityOptions = {}): Promise<RenderCapabilities> {
  const canvas = options.canvas;
  const backendHint = options.backendHint;

  if (backendHint !== 'webgl2' && backendHint !== 'headless') {
    const navigatorGpu = typeof navigator !== 'undefined' ? navigator.gpu : undefined;
    if (navigatorGpu) {
      try {
        const adapter = await navigatorGpu.requestAdapter({ powerPreference: 'high-performance' });
        if (adapter) {
          const device = await adapter.requestDevice();
          const limits = adapter.limits;
          device.destroy();
          return {
            backend: 'webgpu',
            webgpu: true,
            timestampQueries: adapter.features.has('timestamp-query'),
            floatTextures: adapter.features.has('float32-filterable'),
            depthTexture: true,
            instancing: true,
            compressedTextures: adapter.features.has('texture-compression-bc') || adapter.features.has('texture-compression-etc2'),
            limits: {
              maxTextureDimension2D: numeric(limits.maxTextureDimension2D, FALLBACK_LIMITS.maxTextureDimension2D),
              maxUniformBufferBindingSize: numeric(limits.maxUniformBufferBindingSize, FALLBACK_LIMITS.maxUniformBufferBindingSize),
              maxSampledTexturesPerShaderStage: numeric(limits.maxSampledTexturesPerShaderStage, FALLBACK_LIMITS.maxSampledTexturesPerShaderStage),
              maxColorAttachments: numeric(limits.maxColorAttachments, FALLBACK_LIMITS.maxColorAttachments),
              maxBindGroups: numeric(limits.maxBindGroups, FALLBACK_LIMITS.maxBindGroups),
            },
          };
        }
      } catch {
        // A denied or reset WebGPU adapter is a valid runtime condition. Continue to WebGL2.
      }
    }
  }

  if (backendHint === 'headless') {
    return {
      backend: 'headless',
      webgpu: false,
      timestampQueries: false,
      floatTextures: false,
      depthTexture: false,
      instancing: false,
      compressedTextures: false,
      limits: FALLBACK_LIMITS,
    };
  }

  const context = canvas?.getContext('webgl2', { antialias: true, powerPreference: 'high-performance' });
  if (context) {
    const maxTextureDimension2D = numeric(context.getParameter(context.MAX_TEXTURE_SIZE), FALLBACK_LIMITS.maxTextureDimension2D);
    const maxColorAttachments = numeric(context.getParameter(context.MAX_COLOR_ATTACHMENTS), 4);
    return {
      backend: 'webgl2',
      webgpu: false,
      timestampQueries: Boolean(context.getExtension('EXT_disjoint_timer_query_webgl2')),
      floatTextures: Boolean(context.getExtension('EXT_color_buffer_float')),
      depthTexture: true,
      instancing: true,
      compressedTextures: Boolean(context.getExtension('WEBGL_compressed_texture_s3tc')),
      limits: { ...FALLBACK_LIMITS, maxTextureDimension2D, maxColorAttachments },
    };
  }

  return {
    backend: 'headless',
    webgpu: false,
    timestampQueries: false,
    floatTextures: false,
    depthTexture: false,
    instancing: false,
    compressedTextures: false,
    limits: FALLBACK_LIMITS,
  };
}

export function recommendQuality(capabilities: RenderCapabilities): QualityTier {
  if (capabilities.backend === 'webgpu' && capabilities.limits.maxTextureDimension2D >= 8192) return 'ultra';
  if (capabilities.backend === 'webgpu') return 'high';
  if (capabilities.backend === 'webgl2' && capabilities.limits.maxTextureDimension2D >= 4096) return 'balanced';
  return 'minimal';
}

export interface QualityDecision {
  readonly tier: QualityTier;
  readonly renderScale: number;
  readonly shadows: 'off' | 'low' | 'high';
  readonly effects: readonly string[];
  readonly reason: string;
}

export function qualityDecision(tier: QualityTier, pressure: number): QualityDecision {
  const bounded = Math.min(1, Math.max(0, pressure));
  const baseScale = tier === 'ultra' ? 1 : tier === 'high' ? 0.9 : tier === 'balanced' ? 0.78 : 0.66;
  const renderScale = Math.max(0.55, baseScale - Math.max(0, bounded - 0.35) * 0.25);
  const shadows = tier === 'ultra' ? 'high' : tier === 'minimal' ? 'off' : 'low';
  const effects = tier === 'ultra'
    ? ['taa', 'ssao', 'bloom', 'fog', 'lut']
    : tier === 'high'
      ? ['taa', 'ssao', 'bloom', 'fog']
      : tier === 'balanced'
        ? ['fxaa', 'fog']
        : ['fog'];
  return { tier, renderScale, shadows, effects, reason: `pressure=${bounded.toFixed(3)}` };
}
