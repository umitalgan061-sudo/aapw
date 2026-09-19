import type * as THREE_NS from 'three';

let activeRenderer: THREE_NS.WebGLRenderer | null = null;
let installed = false;

/**
 * Initializes the explicit renderer registry boundary. The live world renderer is registered by
 * sceneManager immediately after construction; no global Three.js prototype patching is performed.
 */
export function ensureRendererRegistry(): void {
  installed = true;
}

export function registerRenderer(renderer: THREE_NS.WebGLRenderer | null | undefined): void {
  if (renderer) activeRenderer = renderer;
}

export function getRegisteredRenderer(): THREE_NS.WebGLRenderer | null {
  return activeRenderer;
}

export function clearRegisteredRenderer(renderer?: THREE_NS.WebGLRenderer | null): void {
  if (!renderer || renderer === activeRenderer) activeRenderer = null;
}

export function rendererRegistryDiagnostics(): Readonly<{ installed: boolean; registered: boolean; pixelRatio: number | null }> {
  return Object.freeze({
    installed,
    registered: Boolean(activeRenderer),
    pixelRatio: activeRenderer?.getPixelRatio?.() ?? null,
  });
}
