import {
  type QualityTierV4,
  type RenderPacketV4,
  type RenderItemV4,
  type RenderViewV4,
  type BudgetUsageV4,
  type EntityIdV4,
  clampV4,
  qualityRankV4,
  tierFromRankV4,
  defaultBudgetV4,
} from './runtimeContractsV4';

export type RenderPassV5 = 'depth' | 'shadow' | 'opaque' | 'transparent' | 'water' | 'terrain' | 'particles' | 'post' | 'ui' | 'debug';

export interface RenderNodeV5 {
  readonly id: string;
  readonly pass: RenderPassV5;
  readonly priority: number;
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  readonly maxItems: number;
  readonly enabled?: (quality: QualityTierV4) => boolean;
}

export interface RenderGraphPlanV5 {
  readonly order: readonly string[];
  readonly passes: readonly RenderPassV5[];
  readonly cycles: readonly (readonly string[])[];
  readonly attachments: readonly string[];
}

export interface RenderGraphFrameV5 {
  readonly packet: RenderPacketV4;
  readonly visibleByPass: Readonly<Record<RenderPassV5, readonly RenderItemV4[]>>;
  readonly culled: number;
  readonly submitted: number;
  readonly quality: QualityTierV4;
}

export interface RenderGraphMetricsV5 {
  readonly nodes: number;
  readonly frames: number;
  readonly culled: number;
  readonly submitted: number;
  readonly graphRebuilds: number;
  readonly invalidPlans: number;
}

export interface RenderGraphOptionsV5 {
  readonly maxNodes?: number;
  readonly maxItemsPerPass?: number;
}

const passRank: Record<RenderPassV5, number> = { depth: 100, shadow: 95, terrain: 90, opaque: 80, water: 70, transparent: 60, particles: 50, post: 40, ui: 30, debug: 10 };
const passList: readonly RenderPassV5[] = ['depth', 'shadow', 'terrain', 'opaque', 'water', 'transparent', 'particles', 'post', 'ui', 'debug'];

export class RenderGraphV5 {
  readonly maxNodes: number;
  readonly maxItemsPerPass: number;
  #nodes = new Map<string, RenderNodeV5>();
  #plan: RenderGraphPlanV5 = { order: [], passes: [], cycles: [], attachments: [] };
  #quality: QualityTierV4 = 'high';
  #frames = 0;
  #culled = 0;
  #submitted = 0;
  #graphRebuilds = 0;
  #invalidPlans = 0;
  #pixelBudget = defaultBudgetV4('high');

  constructor(options: RenderGraphOptionsV5 = {}) {
    this.maxNodes = Math.max(8, Math.trunc(options.maxNodes ?? 128));
    this.maxItemsPerPass = Math.max(16, Math.trunc(options.maxItemsPerPass ?? 2000));
    this.installDefaults();
  }

  setQuality(quality: QualityTierV4): void {
    this.#quality = quality;
    this.#pixelBudget = defaultBudgetV4(quality);
  }

  quality(): QualityTierV4 { return this.#quality; }

  register(node: RenderNodeV5): void {
    if (!node.id.trim()) throw new Error('Render node id is required');
    if (!this.#nodes.has(node.id) && this.#nodes.size >= this.maxNodes) throw new Error('Render graph node capacity reached');
    this.#nodes.set(node.id, Object.freeze({ ...node, priority: Math.trunc(node.priority), maxItems: Math.max(1, Math.trunc(node.maxItems || this.maxItemsPerPass)), reads: Object.freeze([...node.reads]), writes: Object.freeze([...node.writes]) }));
    this.rebuild();
  }

  unregister(id: string): boolean {
    const removed = this.#nodes.delete(id);
    if (removed) this.rebuild();
    return removed;
  }

  rebuild(): RenderGraphPlanV5 {
    const remaining = new Map(this.#nodes);
    const order: string[] = [];
    const cycles: string[][] = [];
    while (remaining.size) {
      const ready = [...remaining.values()].filter((node) => {
        const dependencies = [...this.#nodes.values()].filter((candidate) => candidate.writes.some((write) => node.reads.includes(write)) && candidate.id !== node.id).map((candidate) => candidate.id);
        return dependencies.every((dependency) => !remaining.has(dependency));
      });
      if (!ready.length) {
        const fallback = [...remaining.values()].sort((a, b) => b.priority - a.priority || passRank[b.pass] - passRank[a.pass] || a.id.localeCompare(b.id))[0]!;
        cycles.push([fallback.id]);
        order.push(fallback.id);
        remaining.delete(fallback.id);
        continue;
      }
      ready.sort((a, b) => b.priority - a.priority || passRank[b.pass] - passRank[a.pass] || a.id.localeCompare(b.id));
      for (const node of ready) { order.push(node.id); remaining.delete(node.id); }
    }
    const active = order.map((id) => this.#nodes.get(id)!).filter((node) => !node.enabled || node.enabled(this.#quality));
    const attachments = [...new Set(active.flatMap((node) => [...node.reads, ...node.writes]))].sort();
    const passes = [...new Set(active.map((node) => node.pass))].sort((a, b) => passList.indexOf(a) - passList.indexOf(b));
    this.#plan = Object.freeze({ order: Object.freeze(active.map((node) => node.id)), passes: Object.freeze(passes), cycles: Object.freeze(cycles.map((cycle) => Object.freeze(cycle))), attachments: Object.freeze(attachments) });
    if (cycles.length) this.#invalidPlans += 1;
    this.#graphRebuilds += 1;
    return this.#plan;
  }

  plan(): RenderGraphPlanV5 { return this.#plan; }

  build(packet: RenderPacketV4, view: RenderViewV4, usage: BudgetUsageV4): RenderGraphFrameV5 {
    this.#frames += 1;
    const byPass = Object.fromEntries(passList.map((pass) => [pass, []])) as Record<RenderPassV5, RenderItemV4[]>;
    let culled = 0;
    for (const item of packet.items) {
      const pass = this.classify(item, view);
      const items = byPass[pass];
      if (items.length >= this.maxItemsPerPass || items.length >= Math.max(1, Math.trunc(this.#pixelBudget.drawCalls / Math.max(1, this.#plan.passes.length)))) {
        culled += 1;
        continue;
      }
      items.push(item);
    }
    for (const pass of passList) byPass[pass].sort((a, b) => b.priority - a.priority || a.distance - b.distance || a.entity - b.entity);
    this.#culled += culled;
    this.#submitted += packet.items.length - culled;
    void usage;
    return Object.freeze({ packet, visibleByPass: Object.freeze(Object.fromEntries(passList.map((pass) => [pass, Object.freeze(byPass[pass])])) as Record<RenderPassV5, readonly RenderItemV4[]>), culled, submitted: packet.items.length - culled, quality: this.#quality });
  }

  evaluatePressure(frameMs: number, gpuMs: number, drawCalls: number, triangles: number): QualityTierV4 {
    const budget = this.#pixelBudget;
    const pressure = Math.max(frameMs / 16.67, gpuMs / Math.max(0.1, budget.gpuMs), drawCalls / Math.max(1, budget.drawCalls), triangles / Math.max(1, budget.triangles));
    const rank = qualityRankV4(this.#quality);
    const next = pressure >= 1.15 ? tierFromRankV4(rank - 1) : pressure <= 0.3 ? tierFromRankV4(rank + 1) : this.#quality;
    if (next !== this.#quality) this.setQuality(next);
    return this.#quality;
  }

  metrics(): RenderGraphMetricsV5 { return Object.freeze({ nodes: this.#nodes.size, frames: this.#frames, culled: this.#culled, submitted: this.#submitted, graphRebuilds: this.#graphRebuilds, invalidPlans: this.#invalidPlans }); }

  nodeCount(): number { return this.#nodes.size; }

  #classifyDistance(distance: number): RenderPassV5 { return distance > 1000 ? 'terrain' : distance > 500 ? 'opaque' : 'opaque'; }

  classify(item: RenderItemV4, view: RenderViewV4): RenderPassV5 {
    if (item.transparent) return 'transparent';
    if (item.materialKey.toLowerCase().includes('water')) return 'water';
    if (item.geometryKey.toLowerCase().includes('terrain')) return 'terrain';
    if (item.materialKey.toLowerCase().includes('particle')) return 'particles';
    return this.#classifyDistance(Math.abs(item.distance - view.near));
  }

  installDefaults(): void {
    const add = (id: string, pass: RenderPassV5, priority: number, reads: readonly string[], writes: readonly string[]) => this.#nodes.set(id, { id, pass, priority, reads, writes, maxItems: this.maxItemsPerPass });
    add('depth', 'depth', 100, [], ['depth']);
    add('shadow', 'shadow', 95, ['depth'], ['shadow']);
    add('terrain', 'terrain', 90, ['depth'], ['color']);
    add('opaque', 'opaque', 80, ['depth', 'shadow'], ['color']);
    add('water', 'water', 70, ['depth', 'color'], ['color']);
    add('transparent', 'transparent', 60, ['depth', 'color'], ['color']);
    add('particles', 'particles', 50, ['depth', 'color'], ['color']);
    add('post', 'post', 40, ['color'], ['postColor']);
    add('ui', 'ui', 30, ['postColor'], ['screen']);
    add('debug', 'debug', 10, ['screen'], ['screen']);
    this.rebuild();
  }

  reset(): void { this.#nodes.clear(); this.#plan = { order: [], passes: [], cycles: [], attachments: [] }; this.#quality = 'high'; this.#frames = 0; this.#culled = 0; this.#submitted = 0; this.#graphRebuilds = 0; this.#invalidPlans = 0; this.installDefaults(); }
}

export function renderGraphEntityV5(id: number): EntityIdV4 { return id as EntityIdV4; }
