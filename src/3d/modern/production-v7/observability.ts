import { MetricPointV7, RuntimeHealthV7, RuntimeModeV7, TickV7, clampV7, tickV7 } from './types.ts';

interface Counter { readonly name: string; readonly unit: string; value: number; }
export interface SpanV7 { readonly name: string; readonly startTick: TickV7; readonly endTick: TickV7; readonly durationMs: number; readonly ok: boolean; readonly attributes: Readonly<Record<string, string>>; }

export class RuntimeTelemetryV7 {
  readonly #capacity: number;
  readonly #metrics: MetricPointV7[] = [];
  readonly #counters = new Map<string, Counter>();
  readonly #spans: SpanV7[] = [];
  #sequence = 0;

  constructor(capacity = 4096) { this.#capacity = Math.max(64, Math.trunc(capacity)); }

  sample(tick: TickV7, name: string, value: number, unit = 'count', tags: Record<string, string> = {}): void {
    if (!name || !Number.isFinite(value)) return;
    this.#metrics.push(Object.freeze({ tick, name: name.slice(0, 96), value, unit: unit.slice(0, 24), tags: Object.freeze({ ...tags }) }));
    while (this.#metrics.length > this.#capacity) this.#metrics.shift();
  }

  increment(name: string, amount = 1, unit = 'count'): number {
    const counter = this.#counters.get(name) ?? { name, unit, value: 0 };
    counter.value += Number.isFinite(amount) ? amount : 0;
    this.#counters.set(name, counter);
    return counter.value;
  }

  span(name: string, startTick: TickV7, endTick: TickV7, durationMs: number, ok = true, attributes: Record<string, string> = {}): SpanV7 {
    const span = Object.freeze({ name, startTick, endTick, durationMs: Math.max(0, durationMs), ok, attributes: Object.freeze({ ...attributes }) });
    this.#spans.push(span);
    while (this.#spans.length > this.#capacity / 4) this.#spans.shift();
    return span;
  }

  metrics(name?: string): readonly MetricPointV7[] { return Object.freeze(this.#metrics.filter((m) => !name || m.name === name)); }
  counters(): readonly Counter[] { return Object.freeze([...this.#counters.values()].map((counter) => Object.freeze({ ...counter }))); }
  spans(): readonly SpanV7[] { return Object.freeze([...this.#spans]); }

  summarize(tick: TickV7): RuntimeHealthV7 {
    const recent = this.#metrics.filter((metric) => Number(metric.tick) >= Math.max(0, Number(tick) - 60));
    const find = (name: string): readonly number[] => recent.filter((metric) => metric.name === name).map((metric) => metric.value);
    const average = (values: readonly number[]): number => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const frameMs = average(find('frame.ms'));
    const simMs = average(find('simulation.ms'));
    const rtt = average(find('network.rtt.ms'));
    const heap = average(find('memory.heap.ratio'));
    const reasons: string[] = [];
    const recommendations: string[] = [];
    let score = 100;
    if (frameMs > 20) { score -= 18; reasons.push('frame-budget'); recommendations.push('reduce render scale or distant render LOD'); }
    else if (frameMs > 16.7) { score -= 8; reasons.push('frame-budget-soft'); }
    if (simMs > 4) { score -= 15; reasons.push('simulation-budget'); recommendations.push('defer low-priority simulation work'); }
    if (rtt > 150) { score -= 12; reasons.push('network-latency'); recommendations.push('lower replication frequency for distant actors'); }
    if (heap > 0.88) { score -= 20; reasons.push('memory-pressure'); recommendations.push('evict non-critical assets and stream smaller LODs'); }
    const mode: RuntimeModeV7 = score < 45 ? 'constrained' : score < 70 ? 'balanced' : 'full';
    return Object.freeze({ score: clampV7(score, 0, 100), mode, degraded: score < 80, reasons: Object.freeze(reasons), recommendations: Object.freeze([...new Set(recommendations)]) });
  }

  digest(): number {
    let hash = 2166136261;
    for (const metric of this.#metrics) {
      hash ^= metric.name.length ^ Math.trunc(metric.value * 1000) ^ Number(metric.tick);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }
}
