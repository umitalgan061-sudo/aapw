import * as THREE from 'three';

let activeRenderer: THREE.WebGLRenderer | null = null;
let installed = false;
let originalRender: THREE.WebGLRenderer['render'] | null = null;

/**
 * Registers the real WebGLRenderer without changing scene/geometry ownership. The wrapper is installed
 * once and captures the renderer on its first actual render call, which avoids a fragile global scene
 * contract while keeping the legacy renderer fully authoritative for world content.
 */
export function ensureRendererRegistry(): void {
  if (installed) return;
  installed = true;
  originalRender = THREE.WebGLRenderer.prototype.render;
  THREE.WebGLRenderer.prototype.render = function registeredRender(
    this: THREE.WebGLRenderer,
    ...args: Parameters<THREE.WebGLRenderer['render']>
  ): ReturnType<THREE.WebGLRenderer['render']> {
    activeRenderer = this;
    if (!originalRender) throw new Error('AAPW_RENDERER_REGISTRY_ORIGINAL_RENDER_MISSING');
    return originalRender.apply(this, args);
  } as THREE.WebGLRenderer['render'];
}

export function registerRenderer(renderer: THREE.WebGLRenderer | null | undefined): void {
  if (renderer) activeRenderer = renderer;
}

export function getRegisteredRenderer(): THREE.WebGLRenderer | null {
  return activeRenderer;
}

export function clearRegisteredRenderer(renderer?: THREE.WebGLRenderer | null): void {
  if (!renderer || renderer === activeRenderer) activeRenderer = null;
}

export function rendererRegistryDiagnostics(): Readonly<{ installed: boolean; registered: boolean; pixelRatio: number | null }> {
  return Object.freeze({
    installed,
    registered: Boolean(activeRenderer),
    pixelRatio: activeRenderer?.getPixelRatio?.() ?? null,
  });
}
