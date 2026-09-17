import { checksumV7, distanceSqV7, type EntityIdV7, frameV7, type FrameV7, type QualityTierV7, tickV7, type TickV7, type TransformV7, type RenderItemV7, type RenderPacketV7, type RenderViewV7 } from './runtimeContractsV7';

export interface RenderCandidateV7 {
  readonly entity: EntityIdV7;
  readonly transform: TransformV7;
  readonly materialKey: string;
  readonly geometryKey: string;
  readonly layer: number;
  readonly enabled: boolean;
  readonly castShadow?: boolean;
  readonly transparent?: boolean;
}

export interface RenderCompilerOptionsV7 {
  readonly maxItems?: number;
  readonly maxBatches?: number;
  readonly now?: () => number;
}

export interface RenderCompilerStatsV7 {
  readonly submitted: number;
  readonly visible: number;
  readonly culled: number;
  readonly instanced: number;
  readonly batches: number;
  readonly overflowed: number;
}

function qualityDistance(tier: QualityTierV7): number {
  switch (tier) {
    case 'minimal': return 90;
    case 'low': return 150;
    case 'medium': return 260;
    case 'high': return 420;
    case 'ultra': return 640;
  }
}

function stableTransform(transform: TransformV7): TransformV7 {
  return Object.freeze({
    position: Object.freeze({ ...transform.position }),
    rotation: Object.freeze({ ...transform.rotation }),
    scale: Object.freeze({ ...transform.scale }),
  });
}

export class RenderCompilerV7 {
  readonly maxItems: number;
  readonly maxBatches: number;
  #now: () => number;
  #stats: RenderCompilerStatsV7 = { submitted: 0, visible: 0, culled: 0, instanced: 0, batches: 0, overflowed: 0 };

  constructor(options: RenderCompilerOptionsV7 = {}) {
    this.maxItems = Math.max(16, Math.trunc(options.maxItems ?? 4000));
    this.maxBatches = Math.max(1, Math.trunc(options.maxBatches ?? 512));
    this.#now = options.now ?? (() => Date.now());
  }

  compile(frame: number, tick: number, tier: QualityTierV7, view: RenderViewV7, candidates: readonly RenderCandidateV7[]): RenderPacketV7 {
    const maxDistance = Math.max(view.far, qualityDistance(tier));
    const maxDistanceSq = maxDistance * maxDistance;
    this.#stats = { submitted: candidates.length, visible: 0, culled: 0, instanced: 0, batches: 0, overflowed: 0 };
    const visible: RenderItemV7[] = [];
    for (const candidate of candidates) {
      if (!candidate.enabled) { this.#stats.culled += 1; continue; }
      const distanceSq = distanceSqV7(candidate.transform.position, view.position);
      if (distanceSq > maxDistanceSq || distanceSq > view.far * view.far) { this.#stats.culled += 1; continue; }
      visible.push(Object.freeze({
        entity: candidate.entity,
        transform: stableTransform(candidate.transform),
        materialKey: candidate.materialKey,
        geometryKey: candidate.geometryKey,
        layer: Math.trunc(candidate.layer),
        visible: true,
        distance: Math.sqrt(distanceSq),
      }));
    }
    visible.sort((a, b) => a.layer - b.layer || a.distance - b.distance || Number(a.entity) - Number(b.entity));
    let limited = visible;
    if (limited.length > this.maxItems) {
      this.#stats.overflowed = limited.length - this.maxItems;
      limited = limited.slice(0, this.maxItems);
      this.#stats.culled += this.#stats.overflowed;
    }
    const groupCounts = new Map<string, number>();
    for (const item of limited) {
      const key = `${item.layer}|${item.geometryKey}|${item.materialKey}`;
      groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
    }
    let batches = [...groupCounts.entries()].sort(([a], [b]) => a.localeCompare(b));
    if (batches.length > this.maxBatches) batches = batches.slice(0, this.maxBatches);
    const instanced = [...groupCounts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
    this.#stats = { ...this.#stats, visible: limited.length, instanced, batches: batches.length };
    const normalized = Object.freeze(limited.slice());
    return Object.freeze({
      frame: frameV7(frame),
      tick: tickV7(tick),
      tier,
      items: normalized,
      culled: this.#stats.culled,
      instanced,
      batches: batches.length,
      checksum: checksumV7({ frame, tick, tier, items: normalized, batches: batches.map(([key]) => key) }),
    });
  }

  stats(): RenderCompilerStatsV7 { return Object.freeze({ ...this.#stats }); }
  static packetBytes(packet: RenderPacketV7): number { return new TextEncoder().encode(JSON.stringify(packet)).byteLength; }
  static isCoherent(packet: RenderPacketV7): boolean {
    return packet.frame >= 0 && packet.tick >= 0 && packet.items.length >= 0 && packet.batches >= 0 && packet.culled >= 0 && checksumV7({ frame: Number(packet.frame), tick: Number(packet.tick), tier: packet.tier, items: packet.items, batches: new Array(packet.batches).fill(null) }) !== '';
  }

  now(): number { return this.#now(); }
}

export function chooseLodV7(distance: number, tier: QualityTierV7): 0 | 1 | 2 | 3 {
  const multiplier = tier === 'minimal' ? 0.7 : tier === 'low' ? 0.85 : tier === 'medium' ? 1 : tier === 'high' ? 1.25 : 1.5;
  const d = distance / multiplier;
  if (d <= 30) return 0;
  if (d <= 90) return 1;
  if (d <= 220) return 2;
  return 3;
}
