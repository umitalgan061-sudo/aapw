/**
 * Optional next-generation renderer adapter.
 *
 * The adapter deliberately owns no scene or gameplay state. It resolves Three.js' current WebGPURenderer
 * entry point when requested, otherwise creates the existing WebGL2 renderer. WebGPU initialization is
 * asynchronous, so callers must await create(). The fallback path keeps the game's current bootstrap
 * contract intact while allowing an incremental migration toward WebGPU/TSL.
 * @module nextGenRendererAdapter
 */

const BACKENDS = Object.freeze({ WEBGPU: 'webgpu', WEBGL2: 'webgl2' });

function num(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, num(value, low)));
}
function normalizeCanvas(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('renderer canvas is required');
  return canvas;
}
function normalizeSize(width, height) {
  return { width: Math.max(1, Math.round(num(width, 1))), height: Math.max(1, Math.round(num(height, 1))) };
}

async function loadThree(mode, moduleLoader = (specifier) => import(specifier)) {
  if (mode === BACKENDS.WEBGPU) {
    return moduleLoader('three/webgpu');
  }
  return moduleLoader('three');
}

function shouldTryWebGPU({ requestedBackend, webgpuAvailable }) {
  return requestedBackend === BACKENDS.WEBGPU && webgpuAvailable === true;
}

export function chooseRendererBackend({ requestedBackend = BACKENDS.WEBGPU, webgpuAvailable = false } = {}) {
  return shouldTryWebGPU({ requestedBackend, webgpuAvailable }) ? BACKENDS.WEBGPU : BACKENDS.WEBGL2;
}

export async function createNextGenRenderer({
  canvas,
  width,
  height,
  pixelRatio = 1,
  requestedBackend = BACKENDS.WEBGPU,
  webgpuAvailable = false,
  antialias = true,
  alpha = false,
  moduleLoader,
  rendererOptions = {},
} = {}) {
  const targetCanvas = normalizeCanvas(canvas);
  const size = normalizeSize(width ?? targetCanvas.clientWidth, height ?? targetCanvas.clientHeight);
  const backend = chooseRendererBackend({ requestedBackend, webgpuAvailable });

  if (backend === BACKENDS.WEBGPU) {
    try {
      const THREE = await loadThree(BACKENDS.WEBGPU, moduleLoader);
      if (typeof THREE.WebGPURenderer !== 'function') throw new Error('THREE_WEBGPU_RENDERER_UNAVAILABLE');
      const renderer = new THREE.WebGPURenderer({
        canvas: targetCanvas,
        antialias,
        alpha,
        ...rendererOptions,
      });
      renderer.setPixelRatio?.(Math.max(0.5, num(pixelRatio, 1)));
      renderer.setSize?.(size.width, size.height, false);
      if (typeof renderer.init === 'function') await renderer.init();
      return Object.freeze({ backend: BACKENDS.WEBGPU, renderer, three: THREE, initialized: true, fallback: false });
    } catch (error) {
      if (requestedBackend !== BACKENDS.WEBGPU) throw error;
    }
  }

  const THREE = await loadThree(BACKENDS.WEBGL2, moduleLoader);
  if (typeof THREE.WebGLRenderer !== 'function') throw new Error('THREE_WEBGL_RENDERER_UNAVAILABLE');
  const renderer = new THREE.WebGLRenderer({
    canvas: targetCanvas,
    antialias,
    alpha,
    ...rendererOptions,
  });
  renderer.setPixelRatio?.(Math.max(0.5, num(pixelRatio, 1)));
  renderer.setSize?.(size.width, size.height, false);
  return Object.freeze({ backend: BACKENDS.WEBGL2, renderer, three: THREE, initialized: true, fallback: backend === BACKENDS.WEBGPU });
}

export function resizeRendererAdapter(adapter, { width, height, pixelRatio = null } = {}) {
  if (!adapter?.renderer) return false;
  const size = normalizeSize(width, height);
  if (Number.isFinite(Number(pixelRatio))) adapter.renderer.setPixelRatio?.(Math.max(0.5, num(pixelRatio, 1)));
  adapter.renderer.setSize?.(size.width, size.height, false);
  return true;
}

export function setRendererOutputPolicy(adapter, { colorSpace = 'srgb', toneMapping = null, exposure = 1 } = {}) {
  const renderer = adapter?.renderer;
  if (!renderer) return false;
  if ('outputColorSpace' in renderer && renderer.three?.SRGBColorSpace) renderer.outputColorSpace = renderer.three.SRGBColorSpace;
  if (toneMapping != null && 'toneMapping' in renderer) renderer.toneMapping = toneMapping;
  if ('toneMappingExposure' in renderer) renderer.toneMappingExposure = clamp(exposure, 0.25, 4);
  return colorSpace !== 'srgb' ? false : true;
}

export function disposeRendererAdapter(adapter) {
  try {
    adapter?.renderer?.dispose?.();
  } finally {
    return true;
  }
}

export { BACKENDS };
