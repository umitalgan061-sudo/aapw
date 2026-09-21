// @ts-nocheck
/**
 * Bounded observability facade for world-stimulus orchestration.
 *
 * Telemetry is intentionally transport-neutral. It keeps deterministic counters and bounded
 * event samples; the application decides where to export them. No analytics SDK or network client
 * is constructed here.
 */

const freeze = Object.freeze;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));

export const LIVING_WORLD_STIMULUS_TELEMETRY_POLICY = freeze({
  id: 'living-world-stimulus-telemetry-2026-09-v1',
  maxEvents: 128,
  maxEventFields: 16,
  maxStringLength: 96,
  maxHistogramSamples: 256,
});

function safeValue(value) {
  if (typeof value === 'string') return value.slice(0, LIVING_WORLD_STIMULUS_TELEMETRY_POLICY.maxStringLength);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean') return value;
  return null;
}

function sanitizeFields(fields = {}) {
  const result = {};
  for (const key of Object.keys(fields).slice(0, LIVING_WORLD_STIMULUS_TELEMETRY_POLICY.maxEventFields)) {
    const value = safeValue(fields[key]);
    if (value !== null) result[String(key).slice(0, 48)] = value;
  }
  return freeze(result);
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

export function createLivingWorldStimulusTelemetry(options = {}) {
  const policy = freeze({ ...LIVING_WORLD_STIMULUS_TELEMETRY_POLICY, ...(options.policy || {}) });
  const counters = new Map();
  const gauges = new Map();
  const histograms = new Map();
  const events = [];
  let sequence = 0;
  let disposed = false;

  function count(name, delta = 1) {
    if (disposed) return 0;
    const value = Math.max(0, finite(counters.get(name), 0) + finite(delta, 1));
    counters.set(name, value);
    return value;
  }

  function gauge(name, value) {
    if (disposed) return 0;
    const normalized = finite(value, 0);
    gauges.set(name, normalized);
    return normalized;
  }

  function observe(name, value) {
    if (disposed) return 0;
    const list = histograms.get(name) || [];
    list.push(finite(value, 0));
    while (list.length > policy.maxHistogramSamples) list.shift();
    histograms.set(name, list);
    return list[list.length - 1];
  }

  function event(name, fields = {}, timestampSeconds = 0) {
    if (disposed) return null;
    const item = freeze({
      sequence: sequence++, name: String(name || 'unknown').slice(0, 64), timestampSeconds: Math.max(0, finite(timestampSeconds)), fields: sanitizeFields(fields),
    });
    events.push(item);
    while (events.length > policy.maxEvents) events.shift();
    return item;
  }

  function recordTick(frame) {
    if (!frame) return;
    count('ticks');
    count('decisions', frame.decisions?.length || 0);
    gauge('rememberedSignals', frame.memory?.size || 0);
    gauge('decisionBudgetUtilization', clamp((frame.decisions?.length || 0) / Math.max(1, options.maxPlansPerTick || 12), 0, 1));
    observe('decisionsPerTick', frame.decisions?.length || 0);
    for (const decision of frame.decisions || []) {
      count(`intent.${decision.decision.intent}`);
      observe('intentConfidence', decision.decision.confidence);
    }
  }

  function snapshot() {
    const histogramSummary = {};
    for (const [name, values] of histograms) {
      histogramSummary[name] = freeze({ count: values.length, p50: percentile(values, 0.5), p90: percentile(values, 0.9), p99: percentile(values, 0.99) });
    }
    return freeze({
      policy,
      disposed,
      sequence,
      counters: freeze(Object.fromEntries(counters)),
      gauges: freeze(Object.fromEntries(gauges)),
      histograms: freeze(histogramSummary),
      events: freeze(events.slice(-policy.maxEvents)),
    });
  }

  function reset() {
    counters.clear();
    gauges.clear();
    histograms.clear();
    events.length = 0;
    sequence = 0;
  }

  function dispose() {
    disposed = true;
    reset();
  }

  return freeze({ count, gauge, observe, event, recordTick, snapshot, reset, dispose, get disposed() { return disposed; } });
}
