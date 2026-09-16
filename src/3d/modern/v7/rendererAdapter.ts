import { clamp, digest, stableSort, type Disposable, type V7Result } from './primitives.js';

export type RenderResourceKind = 'buffer' | 'texture' | 'sampler' | 'pipeline' | 'bindGroup';
export interface RenderResource { readonly id: string; readonly kind: RenderResourceKind; readonly bytes: number; readonly generation: number; readonly resident: boolean; readonly label: string; }
export interface DrawPacket { readonly id: string; readonly pipeline: string; readonly material: string; readonly mesh: string; readonly instances: number; readonly distance: number; readonly transparent: boolean; readonly priority: number; }
export interface RenderPass { readonly name: string; readonly reads: readonly string[]; readonly writes: readonly string[]; readonly packets: readonly DrawPacket[]; readonly estimatedDraws: number; readonly estimatedTriangles: number; }
export interface RenderGraph { readonly passes: readonly RenderPass[]; readonly resources: readonly RenderResource[]; readonly digest: string; }
export interface DeviceProfile { readonly backend: 'webgpu' | 'webgl2' | 'headless'; readonly maxTextureSize: number; readonly maxBufferBytes: number; readonly supportsInstancing: boolean; readonly supportsFloatTextures: boolean; readonly supportsMultiview: boolean; readonly maxBindGroups: number; }
export interface RendererStats { readonly resources: number; readonly residentBytes: number; readonly passes: number; readonly draws: number; readonly triangles: number; readonly culled: number; }

const HEADLESS: DeviceProfile = Object.freeze({ backend: 'headless', maxTextureSize: 4096, maxBufferBytes: 128 * 1024 * 1024, supportsInstancing: true, supportsFloatTextures: true, supportsMultiview: false, maxBindGroups: 4 });

export class RenderGraphCompiler implements Disposable {
  #resources = new Map<string, RenderResource>(); #passes = new Map<string, RenderPass>(); #disposed = false;
  #culled = 0;
  constructor(readonly device: DeviceProfile = HEADLESS) {}
  registerResource(input: Omit<RenderResource, 'generation' | 'resident'>): V7Result<RenderResource> {
    if (this.#disposed) return { ok: false, code: 'RENDER_DISPOSED', message: 'Renderer is disposed', retryable: false };
    if (!input.id || input.bytes < 0 || input.bytes > this.device.maxBufferBytes) return { ok: false, code: 'RESOURCE_INVALID', message: 'Invalid render resource', retryable: false };
    const existing = this.#resources.get(input.id); const resource = Object.freeze({ ...input, generation: (existing?.generation ?? 0) + 1, resident: true }); this.#resources.set(input.id, resource); return { ok: true, value: resource };
  }
  releaseResource(id: string): boolean { return this.#resources.delete(id); }
  addPass(pass: RenderPass): boolean {
    if (this.#disposed || !pass.name || this.#passes.has(pass.name)) return false;
    const reads = Object.freeze([...new Set(pass.reads)]); const writes = Object.freeze([...new Set(pass.writes)]); const packets = Object.freeze(stableSort(pass.packets, (a, b) => a.transparent === b.transparent ? b.priority - a.priority || a.distance - b.distance || a.id.localeCompare(b.id) : Number(a.transparent) - Number(b.transparent)));
    this.#passes.set(pass.name, Object.freeze({ ...pass, reads, writes, packets })); return true;
  }
  compile(): RenderGraph {
    if (this.#disposed) return Object.freeze({ passes: [], resources: [], digest: 'disposed' });
    const names = this.#orderedPasses(); const passes: RenderPass[] = []; const produced = new Set<string>();
    for (const name of names) {
      const pass = this.#passes.get(name)!; const packets: DrawPacket[] = [];
      for (const packet of pass.packets) {
        const mesh = this.#resources.get(packet.mesh); const material = this.#resources.get(packet.material); if (!mesh || !material || !mesh.resident || !material.resident) { this.#culled += 1; continue; }
        const instances = this.device.supportsInstancing ? clamp(Math.trunc(packet.instances), 1, 4096) : 1; packets.push(Object.freeze({ ...packet, instances }));
      }
      for (const resource of pass.writes) produced.add(resource);
      passes.push(Object.freeze({ ...pass, packets: Object.freeze(packets), estimatedDraws: packets.reduce((sum, packet) => sum + packet.instances, 0), estimatedTriangles: packets.reduce((sum, packet) => sum + packet.instances * 2, 0) }));
    }
    return Object.freeze({ passes: Object.freeze(passes), resources: Object.freeze(stableSort([...this.#resources.values()], (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))), digest: digest(names, passes, [...produced]) });
  }
  execute(graph = this.compile()): RendererStats { const draws = graph.passes.reduce((sum, pass) => sum + pass.estimatedDraws, 0); const triangles = graph.passes.reduce((sum, pass) => sum + pass.estimatedTriangles, 0); return Object.freeze({ resources: graph.resources.length, residentBytes: graph.resources.filter((resource) => resource.resident).reduce((sum, resource) => sum + resource.bytes, 0), passes: graph.passes.length, draws, triangles, culled: this.#culled }); }
  dispose(): void { this.#disposed = true; this.#resources.clear(); this.#passes.clear(); }
  #orderedPasses(): readonly string[] { const all = [...this.#passes.values()]; return stableSort(all, (a, b) => a.name.localeCompare(b.name)).map((pass) => pass.name); }
}

export function chooseDeviceProfile(): DeviceProfile {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) return Object.freeze({ ...HEADLESS, backend: 'webgpu' });
  if (typeof document !== 'undefined' && Boolean(document.createElement('canvas').getContext('webgl2'))) return Object.freeze({ ...HEADLESS, backend: 'webgl2' });
  return HEADLESS;
}
