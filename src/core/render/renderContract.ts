import { clamp, freeze, normalizeVec3, type RenderIntent, type Vec3 } from '../domain/contracts.ts';

export type RendererBackend = 'webgpu' | 'webgl2' | 'canvas2d' | 'dom';
export type RenderPassName = 'shadow' | 'depth' | 'opaque' | 'transparent' | 'particles' | 'post' | 'ui' | 'debug';

export interface RenderCapabilities {
  readonly backend: RendererBackend;
  readonly maxTextureSize: number;
  readonly maxTextureUnits: number;
  readonly floatTextures: boolean;
  readonly instancing: boolean;
  readonly compute: boolean;
  readonly timestampQueries: boolean;
  readonly msaa: boolean;
  readonly devicePixelRatio: number;
}

export interface CameraState {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
  readonly fov: number;
  readonly near: number;
  readonly far: number;
  readonly aspect: number;
}

export interface RenderQuality {
  readonly resolutionScale: number;
  readonly shadows: boolean;
  readonly shadowCascades: number;
  readonly postFx: boolean;
  readonly bloom: boolean;
  readonly volumetrics: boolean;
  readonly foliageDensity: number;
  readonly geometryLodBias: number;
  readonly textureLodBias: number;
  readonly antialias: boolean;
}

export interface RenderFramePacket {
  readonly frame: number;
  readonly revision: number;
  readonly dt: number;
  readonly camera: CameraState;
  readonly quality: RenderQuality;
  readonly visible: readonly string[];
  readonly passes: readonly RenderPassName[];
  readonly clear: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
}

export interface RenderStats {
  readonly frame: number;
  readonly cpuMs: number;
  readonly gpuMs: number | null;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly textures: number;
  readonly pipelines: number;
  readonly memoryMb: number | null;
}

export interface RenderResourceHandle {
  readonly id: string;
  readonly kind: 'texture' | 'buffer' | 'pipeline' | 'material' | 'target';
  readonly bytes: number;
}

export interface RenderPass {
  readonly name: RenderPassName;
  readonly reads: readonly RenderResourceHandle[];
  readonly writes: readonly RenderResourceHandle[];
  readonly execute: (context: RenderExecutionContext) => void;
}

export interface RenderExecutionContext {
  readonly packet: RenderFramePacket;
  readonly backend: RendererBackend;
  readonly stats: RenderStatsBuilder;
}

export interface RenderStatsBuilder {
  addDrawCall(triangles?: number): void;
  addTexture(): void;
  addPipeline(): void;
  addMemory(bytes: number): void;
  snapshot(): RenderStats;
}

export const normalizeCamera = (camera: Partial<CameraState> = {}): CameraState => freeze({
  position: normalizeVec3(camera.position),
  target: normalizeVec3(camera.target),
  up: normalizeVec3(camera.up ?? { x: 0, y: 1, z: 0 }),
  fov: clamp(Number(camera.fov ?? 60), 30, 110),
  near: Math.max(0.001, Number(camera.near ?? 0.1)),
  far: Math.max(1, Number(camera.far ?? 5000)),
  aspect: Math.max(0.1, Number(camera.aspect ?? 1)),
});

export const normalizeRenderQuality = (quality: Partial<RenderQuality> = {}): RenderQuality => freeze({
  resolutionScale: clamp(Number(quality.resolutionScale ?? 1), 0.25, 1),
  shadows: quality.shadows ?? true,
  shadowCascades: Math.floor(clamp(Number(quality.shadowCascades ?? 3), 0, 4)),
  postFx: quality.postFx ?? true,
  bloom: quality.bloom ?? true,
  volumetrics: quality.volumetrics ?? true,
  foliageDensity: clamp(Number(quality.foliageDensity ?? 1), 0, 1),
  geometryLodBias: clamp(Number(quality.geometryLodBias ?? 0), -1, 2),
  textureLodBias: clamp(Number(quality.textureLodBias ?? 0), -2, 3),
  antialias: quality.antialias ?? true,
});

export const createFramePacket = (frame: number, revision: number, dt: number, intent: RenderIntent, visible: readonly string[] = []): RenderFramePacket => freeze({
  frame: Math.max(0, Math.floor(frame)),
  revision: Math.max(0, Math.floor(revision)),
  dt: clamp(dt, 0, 0.25),
  camera: normalizeCamera({ ...intent.camera }),
  quality: normalizeRenderQuality(intent.quality),
  visible: [...new Set(visible)].slice(0, 20_000),
  passes: ['shadow', 'depth', 'opaque', 'transparent', 'particles', 'post', 'ui'],
  clear: freeze({ r: 0.02, g: 0.025, b: 0.035, a: 1 }),
});

export class BoundedRenderStats implements RenderStatsBuilder {
  #frame = 0;
  #cpuMs = 0;
  #gpuMs: number | null = null;
  #drawCalls = 0;
  #triangles = 0;
  #textures = 0;
  #pipelines = 0;
  #memoryMb: number | null = null;
  #startedAt = 0;

  begin(frame: number): void {
    this.#frame = frame;
    this.#startedAt = typeof performance !== 'undefined' ? performance.now() : 0;
  }

  end(gpuMs: number | null = null): RenderStats {
    const now = typeof performance !== 'undefined' ? performance.now() : this.#startedAt;
    this.#cpuMs = Math.max(0, now - this.#startedAt);
    this.#gpuMs = gpuMs !== null && Number.isFinite(gpuMs) ? Math.max(0, gpuMs) : null;
    return this.snapshot();
  }

  addDrawCall(triangles = 0): void {
    this.#drawCalls = Math.min(100_000, this.#drawCalls + 1);
    this.#triangles = Math.min(500_000_000, this.#triangles + Math.max(0, Math.floor(triangles)));
  }
  addTexture(): void { this.#textures = Math.min(50_000, this.#textures + 1); }
  addPipeline(): void { this.#pipelines = Math.min(10_000, this.#pipelines + 1); }
  addMemory(bytes: number): void { this.#memoryMb = Math.max(0, (this.#memoryMb ?? 0) + Math.max(0, bytes) / 1048576); }
  snapshot(): RenderStats { return freeze({ frame: this.#frame, cpuMs: this.#cpuMs, gpuMs: this.#gpuMs, drawCalls: this.#drawCalls, triangles: this.#triangles, textures: this.#textures, pipelines: this.#pipelines, memoryMb: this.#memoryMb === null ? null : Number(this.#memoryMb.toFixed(2)) }); }
}

export interface RenderResourceLifetime {
  readonly resource: RenderResourceHandle;
  readonly firstPass: number;
  readonly lastPass: number;
}

export interface AliasGroup {
  readonly id: number;
  readonly resources: readonly RenderResourceHandle[];
  readonly peakBytes: number;
}

export const planResourceAliases = (lifetimes: readonly RenderResourceLifetime[]): readonly AliasGroup[] => {
  const groups: AliasGroup[] = [];
  const sorted = [...lifetimes].sort((a, b) => a.firstPass - b.firstPass || a.lastPass - b.lastPass || a.resource.id.localeCompare(b.resource.id));
  for (const lifetime of sorted) {
    const candidate = groups.find((group) => group.resources.every((resource) => {
      const other = sorted.find((item) => item.resource.id === resource.id);
      return !other || other.lastPass < lifetime.firstPass || lifetime.lastPass < other.firstPass;
    }));
    if (candidate) {
      const resources = [...candidate.resources, lifetime.resource];
      const peakBytes = Math.max(candidate.peakBytes, lifetime.resource.bytes);
      const next = freeze({ id: candidate.id, resources, peakBytes });
      groups[groups.indexOf(candidate)] = next;
    } else {
      groups.push(freeze({ id: groups.length, resources: [lifetime.resource], peakBytes: lifetime.resource.bytes }));
    }
  }
  return groups;
};

export const chooseBackend = (capabilities: Partial<RenderCapabilities>): RendererBackend => {
  if (capabilities.backend === 'webgpu' && capabilities.compute !== false) return 'webgpu';
  if (capabilities.backend === 'webgl2' || capabilities.instancing) return 'webgl2';
  if (typeof document !== 'undefined') return 'canvas2d';
  return 'dom';
};

export class RenderOrchestrator {
  readonly #passes = new Map<RenderPassName, RenderPass>();
  readonly #stats = new BoundedRenderStats();
  #backend: RendererBackend;

  constructor(backend: RendererBackend = 'dom') { this.#backend = backend; }
  setBackend(backend: RendererBackend): void { this.#backend = backend; }
  get backend(): RendererBackend { return this.#backend; }
  registerPass(pass: RenderPass): () => void {
    if (this.#passes.has(pass.name)) throw new Error(`Duplicate render pass ${pass.name}`);
    this.#passes.set(pass.name, pass);
    return () => this.#passes.delete(pass.name);
  }
  render(packet: RenderFramePacket): RenderStats {
    this.#stats.begin(packet.frame);
    const context: RenderExecutionContext = freeze({ packet, backend: this.#backend, stats: this.#stats });
    for (const passName of packet.passes) {
      const pass = this.#passes.get(passName);
      if (!pass) continue;
      try { pass.execute(context); } catch { /* one broken presentation pass must not stop the world */ }
    }
    return this.#stats.end();
  }
}
