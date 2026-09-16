/**
 * Renderer-independent presentation proxy for AAPW v3.
 *
 * Gameplay emits immutable presentation commands instead of owning Three.js objects. The renderer
 * may consume the command stream directly, batch commands by material/layer, or ignore lower-priority
 * effects under a performance budget. This keeps simulation deterministic and rendering replaceable.
 */

export type PresentationKindV3 = 'transform' | 'visibility' | 'animation' | 'effect' | 'audio' | 'ui';
export type PresentationLayerV3 = 'world' | 'character' | 'fx' | 'audio' | 'hud' | 'debug';

export interface PresentationTransformV3 { x: number; y: number; z: number; yaw: number; pitch: number; scale: number; }
export interface PresentationCommandV3 {
  readonly sequence: number;
  readonly entityId: number;
  readonly kind: PresentationKindV3;
  readonly layer: PresentationLayerV3;
  readonly priority: number;
  readonly payload: Readonly<Record<string, string | number | boolean | PresentationTransformV3 | null>>;
}

export interface PresentationBatchV3 {
  readonly frameTick: number;
  readonly commands: readonly PresentationCommandV3[];
  readonly dropped: number;
}

export interface RenderProxyMetricsV3 {
  frames: number;
  emitted: number;
  consumed: number;
  dropped: number;
  queueHighWater: number;
}

const layers: readonly PresentationLayerV3[] = ['world', 'character', 'fx', 'audio', 'hud', 'debug'];
const kinds: readonly PresentationKindV3[] = ['transform', 'visibility', 'animation', 'effect', 'audio', 'ui'];
const validLayer = new Set(layers);
const validKind = new Set(kinds);
const finite = (value: number): boolean => Number.isFinite(value);

export class RenderProxyV3 {
  readonly maxQueue: number;
  #queue: PresentationCommandV3[] = [];
  #sequence = 0;
  #metrics: RenderProxyMetricsV3 = { frames: 0, emitted: 0, consumed: 0, dropped: 0, queueHighWater: 0 };

  constructor(maxQueue = 4096) { this.maxQueue = Math.max(64, Math.floor(maxQueue)); }

  emit(command: Omit<PresentationCommandV3, 'sequence'>): PresentationCommandV3 {
    this.#validate(command);
    const normalized = Object.freeze({ sequence: ++this.#sequence, ...command, payload: structuredClone(command.payload) });
    this.#queue.push(normalized);
    this.#metrics.emitted += 1;
    this.#metrics.queueHighWater = Math.max(this.#metrics.queueHighWater, this.#queue.length);
    this.#trimIfNeeded();
    return normalized;
  }

  emitTransform(entityId: number, transform: PresentationTransformV3, priority = 5, layer: PresentationLayerV3 = 'character'): PresentationCommandV3 {
    return this.emit({ entityId, kind: 'transform', layer, priority, payload: { transform } });
  }

  emitVisibility(entityId: number, visible: boolean, priority = 4, layer: PresentationLayerV3 = 'world'): PresentationCommandV3 {
    return this.emit({ entityId, kind: 'visibility', layer, priority, payload: { visible } });
  }

  emitAnimation(entityId: number, clip: string, weight = 1, priority = 6): PresentationCommandV3 {
    return this.emit({ entityId, kind: 'animation', layer: 'character', priority, payload: { clip, weight } });
  }

  emitEffect(entityId: number, effect: string, strength = 1, priority = 3): PresentationCommandV3 {
    return this.emit({ entityId, kind: 'effect', layer: 'fx', priority, payload: { effect, strength } });
  }

  drain(frameTick: number, budget = this.maxQueue): PresentationBatchV3 {
    if (!Number.isInteger(frameTick) || frameTick < 0) throw new RangeError('Invalid render frame tick');
    const count = Math.max(0, Math.min(this.#queue.length, Math.floor(budget)));
    const commands = this.#queue.splice(0, count);
    this.#metrics.frames += 1;
    this.#metrics.consumed += commands.length;
    return Object.freeze({ frameTick, commands: Object.freeze(commands), dropped: 0 });
  }

  peek(): readonly PresentationCommandV3[] { return Object.freeze(this.#queue.slice()); }
  metrics(): RenderProxyMetricsV3 { return { ...this.#metrics }; }
  clear(): void { this.#metrics.dropped += this.#queue.length; this.#queue.length = 0; }

  #trimIfNeeded(): void {
    if (this.#queue.length <= this.maxQueue) return;
    const over = this.#queue.length - this.maxQueue;
    const ranked = [...this.#queue].sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
    const drop = new Set(ranked.slice(0, over).map((command) => command.sequence));
    this.#queue = this.#queue.filter((command) => !drop.has(command.sequence));
    this.#metrics.dropped += over;
  }

  #validate(command: Omit<PresentationCommandV3, 'sequence'>): void {
    if (!Number.isInteger(command.entityId) || command.entityId < 0) throw new RangeError('Invalid presentation entity id');
    if (!validKind.has(command.kind)) throw new Error('Invalid presentation kind');
    if (!validLayer.has(command.layer)) throw new Error('Invalid presentation layer');
    if (!finite(command.priority)) throw new RangeError('Invalid presentation priority');
    for (const [key, value] of Object.entries(command.payload)) {
      if (!key || key.length > 64) throw new Error('Invalid presentation payload key');
      if (typeof value === 'number' && !finite(value)) throw new Error('Invalid presentation payload number');
    }
  }
}
