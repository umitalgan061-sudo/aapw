
import type { AssetNode, AssetPlanItem, AssetState, AssetStats, Priority } from './types.ts';
import { finite, stableHash } from './types.ts';

export interface AssetDeclaration {
  readonly id: string;
  readonly url: string;
  readonly bytes?: number;
  readonly priority?: Priority;
  readonly dependencies?: readonly string[];
  readonly tags?: readonly string[];
  readonly critical?: boolean;
}

export interface AssetOptions {
  readonly maxBytes?: number;
  readonly maxNodes?: number;
  readonly maxDependencies?: number;
}

const PRIORITY_SCORE: Readonly<Record<Priority, number>> = Object.freeze({
  critical: 1000,
  high: 700,
  normal: 400,
  low: 200,
  background: 50,
});

export class AssetGraphR41 {
  readonly maxBytes: number;
  readonly maxNodes: number;
  readonly maxDependencies: number;
  #nodes = new Map<string, AssetNode>();

  constructor(options: AssetOptions = {}) {
    this.maxBytes = Math.max(1024 * 1024, Math.trunc(options.maxBytes ?? 512 * 1024 * 1024));
    this.maxNodes = Math.max(64, Math.trunc(options.maxNodes ?? 8192));
    this.maxDependencies = Math.max(1, Math.trunc(options.maxDependencies ?? 64));
  }

  declare(input: AssetDeclaration, tick = 0): AssetNode {
    const id = sanitizeId(input.id);
    if (!id) throw new Error('R41 asset id is required');
    const previous = this.#nodes.get(id);
    const dependencies = uniqueIds(input.dependencies ?? previous?.dependencies ?? []).slice(0, this.maxDependencies);
    if (dependencies.includes(id)) throw new Error('R41 asset cannot depend on itself');

    const next: AssetNode = Object.freeze({
      id,
      url: sanitizeUrl(input.url),
      state: previous?.state ?? 'declared',
      bytes: Math.max(0, Math.trunc(finite(input.bytes, previous?.bytes ?? 0))),
      priority: input.priority ?? previous?.priority ?? 'normal',
      dependencies: Object.freeze(dependencies),
      tags: Object.freeze(uniqueStrings(input.tags ?? previous?.tags ?? [], 64, 64)),
      refs: previous?.refs ?? 0,
      attempts: previous?.attempts ?? 0,
      lastUsedTick: Math.trunc(tick),
      critical: input.critical ?? previous?.critical ?? false,
      revision: (previous?.revision ?? 0) + 1,
    });

    this.#nodes.set(id, next);
    this.evictLeastValuable(tick, Math.max(0, this.#nodes.size - this.maxNodes));
    return next;
  }

  get(id: string): AssetNode | null {
    return this.#nodes.get(sanitizeId(id)) ?? null;
  }

  retain(id: string, tick = 0): AssetNode | null {
    const node = this.get(id);
    if (!node) return null;
    const next = Object.freeze({ ...node, refs: node.refs + 1, lastUsedTick: Math.trunc(tick) });
    this.#nodes.set(node.id, next);
    return next;
  }

  release(id: string, tick = 0): AssetNode | null {
    const node = this.get(id);
    if (!node) return null;
    const next = Object.freeze({ ...node, refs: Math.max(0, node.refs - 1), lastUsedTick: Math.trunc(tick) });
    this.#nodes.set(node.id, next);
    return next;
  }

  transition(id: string, state: AssetState, tick = 0): AssetNode | null {
    const node = this.get(id);
    if (!node) return null;
    if (!allowedTransition(node.state, state)) throw new Error('illegal R41 asset state transition');
    const next = Object.freeze({
      ...node,
      state,
      attempts: state === 'loading' ? node.attempts + 1 : node.attempts,
      lastUsedTick: Math.trunc(tick),
      revision: node.revision + 1,
    });
    this.#nodes.set(node.id, next);
    return next;
  }

  setBytes(id: string, bytes: number, tick = 0): AssetNode | null {
    const node = this.get(id);
    if (!node) return null;
    const next = Object.freeze({
      ...node,
      bytes: Math.max(0, Math.trunc(finite(bytes))),
      lastUsedTick: Math.trunc(tick),
      revision: node.revision + 1,
    });
    this.#nodes.set(node.id, next);
    return next;
  }

  dependenciesReady(id: string): boolean {
    const node = this.get(id);
    if (!node) return false;
    return node.dependencies.every(dependency => this.#nodes.get(dependency)?.state === 'ready');
  }

  plan(requested: readonly string[], tick = 0): readonly AssetPlanItem[] {
    const visited = new Set<string>();
    const result: AssetPlanItem[] = [];
    const visiting = new Set<string>();

    const visit = (rawId: string, depth: number): void => {
      const id = sanitizeId(rawId);
      if (visited.has(id)) return;
      const node = this.#nodes.get(id);
      if (!node) return;
      if (visiting.has(id)) throw new Error('R41 cyclic asset dependency');
      visiting.add(id);
      for (const dependency of node.dependencies) visit(dependency, depth + 1);
      visiting.delete(id);
      visited.add(id);

      if (node.state !== 'ready' && node.state !== 'loading') {
        result.push(Object.freeze({
          id: node.id,
          depth,
          priority: node.priority,
          bytes: node.bytes,
          dependenciesReady: this.dependenciesReady(node.id),
        }));
      }
    };

    for (const id of requested) visit(id, 0);

    return Object.freeze(result.sort((a, b) => {
      const priority = PRIORITY_SCORE[b.priority] - PRIORITY_SCORE[a.priority];
      if (priority !== 0) return priority;
      if (a.depth !== b.depth) return b.depth - a.depth;
      if (a.bytes !== b.bytes) return a.bytes - b.bytes;
      return a.id.localeCompare(b.id);
    }));
  }

  admitReady(tick = 0): readonly AssetNode[] {
    this.rebalance(tick);
    return Object.freeze([...this.#nodes.values()].filter(node => node.state === 'ready').sort((a, b) => b.bytes - a.bytes));
  }

  evictLeastValuable(tick = 0, count = 1): readonly AssetNode[] {
    const candidates = [...this.#nodes.values()]
      .filter(node => !node.critical && node.refs === 0 && node.state !== 'loading')
      .sort((a, b) => this.value(a, tick) - this.value(b, tick));

    const result: AssetNode[] = [];
    for (const node of candidates.slice(0, Math.max(0, Math.trunc(count)))) {
      const next = Object.freeze({ ...node, state: 'evicted' as const, revision: node.revision + 1, lastUsedTick: Math.trunc(tick) });
      this.#nodes.set(node.id, next);
      result.push(next);
    }
    return Object.freeze(result);
  }

  removeEvicted(): number {
    let count = 0;
    for (const [id, node] of this.#nodes.entries()) {
      if (node.state === 'evicted') {
        this.#nodes.delete(id);
        count += 1;
      }
    }
    return count;
  }

  nodes(): readonly AssetNode[] {
    return Object.freeze([...this.#nodes.values()].sort((a, b) => a.id.localeCompare(b.id)));
  }

  stats(): AssetStats {
    let ready = 0;
    let loading = 0;
    let failed = 0;
    let residentBytes = 0;

    for (const node of this.#nodes.values()) {
      if (node.state === 'ready') {
        ready += 1;
        residentBytes += node.bytes;
      } else if (node.state === 'loading') loading += 1;
      else if (node.state === 'failed') failed += 1;
    }

    return Object.freeze({
      nodes: this.#nodes.size,
      ready,
      loading,
      failed,
      residentBytes,
      capacityBytes: this.maxBytes,
      utilization: this.maxBytes > 0 ? residentBytes / this.maxBytes : 0,
      digest: stableHash(this.nodes()),
    });
  }

  digest(): number { return this.stats().digest; }

  #touch(id: string, tick: number): void {
    const node = this.#nodes.get(id);
    if (node) this.#nodes.set(id, Object.freeze({ ...node, lastUsedTick: Math.trunc(tick) }));
  }

  private value(node: AssetNode, tick: number): number {
    const age = Math.max(0, tick - node.lastUsedTick);
    return PRIORITY_SCORE[node.priority] + 500 / (1 + age) + Math.min(8, node.refs * 2) * 100 - node.dependencies.length;
  }

  private rebalance(tick: number): void {
    let bytes = this.stats().residentBytes;
    if (bytes <= this.maxBytes) return;
    const victims = [...this.#nodes.values()]
      .filter(node => node.state === 'ready' && !node.critical && node.refs === 0)
      .sort((a, b) => this.value(a, tick) - this.value(b, tick));
    for (const victim of victims) {
      if (bytes <= this.maxBytes) break;
      bytes -= victim.bytes;
      this.#nodes.set(victim.id, Object.freeze({ ...victim, state: 'evicted', revision: victim.revision + 1 }));
    }
  }
}

function allowedTransition(from: AssetState, to: AssetState): boolean {
  if (from === to) return true;
  if (from === 'declared') return to === 'queued' || to === 'loading' || to === 'evicted';
  if (from === 'queued') return to === 'loading' || to === 'failed' || to === 'evicted';
  if (from === 'loading') return to === 'ready' || to === 'failed' || to === 'evicted';
  if (from === 'ready') return to === 'loading' || to === 'evicted';
  if (from === 'failed') return to === 'queued' || to === 'evicted';
  if (from === 'evicted') return to === 'declared' || to === 'queued';
  return false;
}

function sanitizeId(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 128) : '';
}

function sanitizeUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value, 'https://invalid.local');
    if (!['http:', 'https:', 'blob:', 'data:'].includes(url.protocol) && !value.startsWith('/')) return '';
    return value.slice(0, 1024);
  } catch {
    return '';
  }
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values.map(sanitizeId).filter(Boolean))];
}

function uniqueStrings(values: readonly string[], maxLength: number, maxCount: number): string[] {
  return [...new Set(values.filter(value => typeof value === 'string').map(value => value.trim().slice(0, maxLength)).filter(Boolean))].slice(0, maxCount);
}
