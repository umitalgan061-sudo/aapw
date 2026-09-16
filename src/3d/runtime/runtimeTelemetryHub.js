/**
 * Bounded runtime telemetry hub.
 *
 * Provides structured metrics, event recording, percentile summaries and exportable snapshots.
 * Payloads are cloned and size-limited; timestamps come from the caller so replay/test runs remain
 * deterministic and the telemetry layer never owns wall-clock policy.
 */

import {
  clamp,
  finiteOr,
  integerOr,
  stableStringify,
  makeRingBuffer,
  resolveLogger,
} from './modernRuntimeContract.js';

const DEFAULT_HISTORY = 512;
const DEFAULT_MAX_PAYLOAD = 4096;
const METRIC_TYPES = Object.freeze(['counter', 'gauge', 'histogram']);

function sanitize(value, depth = 0, budget = { bytes: 0 }, maxBytes = DEFAULT_MAX_PAYLOAD) {
  if (depth > 5 || budget.bytes > maxBytes) return '[truncated]';
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    budget.bytes += String(value).length;
    return value;
  }
  if (typeof value === 'number') {
    const number = Number.isFinite(value) ? value : 0;
    budget.bytes += 16;
    return number;
  }
  if (Array.isArray(value)) {
    const output = [];
    for (const item of value.slice(0, 64)) output.push(sanitize(item, depth + 1, budget, maxBytes));
    return output;
  }
  if (typeof value === 'object') {
    const output = {};
    const entries = Object.entries(value).slice(0, 64);
    for (const [key, item] of entries) {
      output[String(key).slice(0, 96)] = sanitize(item, depth + 1, budget, maxBytes);
      if (budget.bytes > maxBytes) break;
    }
    return output;
  }
  return String(value).slice(0, 128);
}

function percentile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = clamp(q, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function createMetric(name, type) {
  if (!METRIC_TYPES.includes(type)) throw new TypeError(`Unsupported metric type: ${type}`);
  const metric = { name, type, value: 0, samples: [] };
  if (type === 'histogram') metric.samples.length = 0;
  return metric;
}

export function createRuntimeTelemetryHub(options = {}) {
  const history = makeRingBuffer(options.historySize || DEFAULT_HISTORY);
  const logger = resolveLogger(options.logger);
  const maxPayload = clamp(integerOr(options.maxPayloadBytes, DEFAULT_MAX_PAYLOAD), 512, 65536);
  const metrics = new Map();
  const subscribers = new Set();
  let sequence = 0;
  let droppedEvents = 0;
  let eventCount = 0;
  let session = String(options.sessionId || 'unknown');

  function emit(event) {
    const safeEvent = Object.freeze(sanitize({
      sequence: sequence++,
      sessionId: session,
      ...event,
    }, 0, { bytes: 0 }, maxPayload));
    history.push(safeEvent);
    eventCount += 1;
    for (const subscriber of subscribers) {
      try { subscriber(safeEvent); } catch (error) { logger.warn('Telemetry subscriber failed', error); }
    }
    return safeEvent;
  }

  function registerMetric(name, type = 'gauge') {
    const key = String(name || '').trim();
    if (!key) throw new TypeError('Metric name is required.');
    if (!metrics.has(key)) metrics.set(key, createMetric(key, type));
    return metrics.get(key);
  }

  function increment(name, value = 1) {
    const metric = registerMetric(name, 'counter');
    metric.value += finiteOr(value, 0);
    return metric.value;
  }

  function gauge(name, value) {
    const metric = registerMetric(name, 'gauge');
    metric.value = finiteOr(value, 0);
    return metric.value;
  }

  function observe(name, value) {
    const metric = registerMetric(name, 'histogram');
    const safeValue = Math.max(0, finiteOr(value, 0));
    metric.samples.push(safeValue);
    if (metric.samples.length > 1024) metric.samples.shift();
    metric.value = safeValue;
    return safeValue;
  }

  function event(type, payload = {}, timestampMs = 0) {
    return emit({ type: String(type || 'runtime.event'), timestampMs: Math.max(0, finiteOr(timestampMs, 0)), payload });
  }

  function frame(frameData = {}) {
    gauge('frame.deltaMs', frameData.deltaMs);
    gauge('frame.fps', frameData.fps);
    observe('frame.cpuMs', frameData.cpuMs);
    observe('frame.gpuMs', frameData.gpuMs);
    if (frameData.dropped) increment('frame.dropped', 1);
    return event('runtime.frame', frameData, frameData.timestampMs);
  }

  function quality(qualityData = {}, timestampMs = 0) {
    gauge('quality.scale', qualityData.scale);
    event('runtime.quality', qualityData, timestampMs);
  }

  function error(error, context = {}, timestampMs = 0) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown error');
    increment('errors.total', 1);
    logger.error(message, context);
    return event('runtime.error', { message, name: error?.name || 'Error', context }, timestampMs);
  }

  function subscribe(callback) {
    if (typeof callback !== 'function') return () => {};
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  }

  function setSession(id) { session = String(id || 'unknown'); }

  function snapshot() {
    const metricSnapshot = {};
    for (const [name, metric] of metrics.entries()) {
      if (metric.type === 'histogram') {
        metricSnapshot[name] = Object.freeze({
          type: metric.type,
          count: metric.samples.length,
          latest: metric.value,
          p50: percentile(metric.samples, 0.5),
          p90: percentile(metric.samples, 0.9),
          p95: percentile(metric.samples, 0.95),
          p99: percentile(metric.samples, 0.99),
        });
      } else {
        metricSnapshot[name] = Object.freeze({ type: metric.type, value: metric.value });
      }
    }
    return Object.freeze({
      sessionId: session,
      eventCount,
      droppedEvents,
      sequence,
      metrics: Object.freeze(metricSnapshot),
      history: history.toArray(),
    });
  }

  function recent(limit = 50) {
    const records = history.toArray();
    return records.slice(Math.max(0, records.length - clamp(integerOr(limit, 50), 1, records.length || 1)));
  }

  function exportJson() {
    return stableStringify(snapshot());
  }

  function reset() {
    history.clear();
    metrics.clear();
    sequence = 0;
    droppedEvents = 0;
    eventCount = 0;
  }

  return Object.freeze({
    registerMetric,
    increment,
    gauge,
    observe,
    event,
    frame,
    quality,
    error,
    subscribe,
    setSession,
    snapshot,
    recent,
    exportJson,
    reset,
    get droppedEvents() { return droppedEvents; },
    get eventCount() { return eventCount; },
  });
}

export function summarizeFrameHistory(samples = []) {
  const safe = samples.map((sample) => Math.max(0, finiteOr(sample, 0))).filter(Number.isFinite);
  if (!safe.length) return Object.freeze({ count: 0, p50: 0, p90: 0, p95: 0, p99: 0, worst: 0 });
  return Object.freeze({
    count: safe.length,
    p50: percentile(safe, 0.5),
    p90: percentile(safe, 0.9),
    p95: percentile(safe, 0.95),
    p99: percentile(safe, 0.99),
    worst: Math.max(...safe),
  });
}

export function classifyFrameBudget(deltaMs, budgetMs = 16.67) {
  const load = Math.max(0, finiteOr(deltaMs, 0)) / Math.max(1, finiteOr(budgetMs, 16.67));
  if (load <= 0.9) return 'healthy';
  if (load <= 1.05) return 'soft-budget';
  if (load <= 1.35) return 'over-budget';
  return 'critical';
}

export function createTelemetryBatcher(options = {}) {
  const limit = clamp(integerOr(options.batchSize, 32), 1, 256);
  const flushMs = clamp(finiteOr(options.flushMs, 1000), 16, 10000);
  let records = [];
  let lastFlushMs = 0;

  function push(record, nowMs = 0) {
    records.push(record);
    if (records.length >= limit || nowMs - lastFlushMs >= flushMs) return flush(nowMs);
    return null;
  }

  function flush(nowMs = lastFlushMs) {
    const output = records;
    records = [];
    lastFlushMs = Math.max(lastFlushMs, finiteOr(nowMs, lastFlushMs));
    return output;
  }

  return Object.freeze({ push, flush, get size() { return records.length; } });
}
