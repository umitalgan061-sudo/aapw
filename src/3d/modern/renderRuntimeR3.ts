import type { RenderCapabilities, Transform } from './types.ts';
import type { RenderPort, RenderStats } from './portsR3.ts';

export interface RenderObjectR3 {
  readonly id: string;
  readonly transform: Transform;
  readonly bounds: { readonly radius: number };
  readonly materialKey: string;
  readonly visible: boolean;
  readonly layer: number;
}

export interface RenderPacketR3 {
  readonly frame: number;
  readonly camera: { readonly x: number; readonly y: number; readonly z: number; readonly far: number };
  readonly objects: readonly RenderObjectR3[];
  readonly environmentVersion: number;
}

export interface RenderRuntimeOptions {
  readonly maxVisibleObjects?: number;
  readonly maxDrawCalls?: number;
  readonly maxTriangles?: number;
  readonly objectBudgetPerFrame?: number;
}

export interface RenderRuntimeSnapshot {
  readonly frame: number;
  readonly submittedObjects: number;
  readonly visibleObjects: number;
  readonly culledObjects: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly backend: RenderStats['backend'];
  readonly lastFrameMs: number;
  readonly qualityScale: number;
}

const DEFAULTS = {
  maxVisibleObjects: 2500,
  maxDrawCalls: 1200,
  maxTriangles: 4_000_000,
  objectBudgetPerFrame: 6000,
} as const;

function distanceSquared(a: RenderPacketR3['camera'], object: RenderObjectR3): number {
  const dx = object.transform.position.x - a.x;
  const dy = object.transform.position.y - a.y;
  const dz = object.transform.position.z - a.z;
  return dx * dx + dy * dy + dz * dz;
}

function estimateTriangles(object: RenderObjectR3): number {
  if (object.layer <= 0) return 120;
  if (object.layer === 1) return 360;
  return 900;
}

function compareRenderObjects(a: RenderObjectR3, b: RenderObjectR3, camera: RenderPacketR3['camera']): number {
  if (a.visible !== b.visible) return a.visible ? -1 : 1;
  const layer = a.layer - b.layer;
  if (layer !== 0) return layer;
  return distanceSquared(a as never, b) - distanceSquared(a as never, b);
}

export class RenderRuntimeR3 implements RenderPort<RenderPacketR3> {
  readonly #options: Required<RenderRuntimeOptions>;
  readonly #capabilities: RenderCapabilities;
  #lastPacket: RenderPacketR3 | null = null;
  #lastFrameMs = 0;
  #frame = 0;
  #visibleObjects = 0;
  #culledObjects = 0;
  #drawCalls = 0;
  #triangles = 0;
  #qualityScale = 1;
  #environmentVersion = 0;
  #width = 1;
  #height = 1;
  #dpr = 1;

  constructor(capabilities: RenderCapabilities, options: RenderRuntimeOptions = {}) {
    this.#capabilities = capabilities;
    this.#options = {
      maxVisibleObjects: Math.max(32, Math.floor(options.maxVisibleObjects ?? DEFAULTS.maxVisibleObjects)),
      maxDrawCalls: Math.max(16, Math.floor(options.maxDrawCalls ?? DEFAULTS.maxDrawCalls)),
      maxTriangles: Math.max(10_000, Math.floor(options.maxTriangles ?? DEFAULTS.maxTriangles)),
      objectBudgetPerFrame: Math.max(128, Math.floor(options.objectBudgetPerFrame ?? DEFAULTS.objectBudgetPerFrame)),
    };
  }

  submit(packet: RenderPacketR3): void {
    this.#frame = packet.frame;
    this.#environmentVersion = packet.environmentVersion;
    const start = performance.now();
    const budgeted = packet.objects.slice(0, this.#options.objectBudgetPerFrame);
    const visible = budgeted
      .filter((object) => object.visible)
      .sort((a, b) => compareRenderObjects(a, b, packet.camera));
    const selected: RenderObjectR3[] = [];
    let triangles = 0;
    let drawCalls = 0;
    for (const object of visible) {
      if (selected.length >= Math.floor(this.#options.maxVisibleObjects * this.#qualityScale)) break;
      const objectTriangles = estimateTriangles(object);
      const proposedTriangles = triangles + objectTriangles;
      const proposedDrawCalls = drawCalls + 1;
      if (proposedTriangles > this.#options.maxTriangles || proposedDrawCalls > Math.floor(this.#options.maxDrawCalls * this.#qualityScale)) continue;
      selected.push(object);
      triangles = proposedTriangles;
      drawCalls = proposedDrawCalls;
    }
    this.#lastPacket = packet;
    this.#visibleObjects = selected.length;
    this.#culledObjects = Math.max(0, packet.objects.length - selected.length);
    this.#drawCalls = drawCalls;
    this.#triangles = triangles;
    this.#lastFrameMs = Math.max(0, performance.now() - start);
    this.#adaptQuality(this.#lastFrameMs);
  }

  resize(width: number, height: number, dpr: number): void {
    this.#width = Math.max(1, Math.floor(width));
    this.#height = Math.max(1, Math.floor(height));
    this.#dpr = Math.min(3, Math.max(0.5, Number.isFinite(dpr) ? dpr : 1));
  }

  async recover(): Promise<{ readonly ok: true; readonly value: void } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean } }> {
    if (this.#capabilities.backend === 'headless') return { ok: true, value: undefined };
    this.#qualityScale = Math.max(0.5, this.#qualityScale * 0.8);
    this.#lastPacket = null;
    return { ok: true, value: undefined };
  }

  setEnvironmentVersion(version: number): void {
    this.#environmentVersion = Math.max(0, Math.floor(version));
  }

  qualityScale(): number {
    return this.#qualityScale;
  }

  stats(): RenderStats {
    return {
      backend: this.#capabilities.backend === 'canvas2d' ? 'headless' : this.#capabilities.backend,
      drawCalls: this.#drawCalls,
      triangles: this.#triangles,
      frameMs: this.#lastFrameMs,
      gpuMs: null,
      memoryBytes: this.#estimateMemory(),
    };
  }

  snapshot(): RenderRuntimeSnapshot {
    return {
      frame: this.#frame,
      submittedObjects: this.#lastPacket?.objects.length ?? 0,
      visibleObjects: this.#visibleObjects,
      culledObjects: this.#culledObjects,
      drawCalls: this.#drawCalls,
      triangles: this.#triangles,
      backend: this.stats().backend,
      lastFrameMs: this.#lastFrameMs,
      qualityScale: this.#qualityScale,
    };
  }

  #adaptQuality(frameMs: number): void {
    const target = 16.67;
    if (frameMs > target * 1.5) this.#qualityScale = Math.max(0.5, this.#qualityScale - 0.08);
    else if (frameMs < target * 0.65) this.#qualityScale = Math.min(1, this.#qualityScale + 0.025);
  }

  #estimateMemory(): number {
    const objectBytes = (this.#lastPacket?.objects.length ?? 0) * 192;
    return objectBytes + this.#width * this.#height * this.#dpr * 4;
  }
}

export function createHeadlessRenderCapabilities(): RenderCapabilities {
  return {
    backend: 'headless',
    webgpu: false,
    timestampQueries: false,
    floatTextures: false,
    depthTexture: true,
    instancing: true,
    compressedTextures: false,
    limits: {
      maxTextureDimension2D: 4096,
      maxUniformBufferBindingSize: 65536,
      maxSampledTexturesPerShaderStage: 16,
      maxColorAttachments: 4,
      maxBindGroups: 4,
    },
  };
}
