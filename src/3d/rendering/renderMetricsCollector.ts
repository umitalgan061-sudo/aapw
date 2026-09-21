// @ts-nocheck
/**
 * Bounded render telemetry collector.
 *
 * Captures frame timing, pass cost, draw/triangle counts, memory pressure and backend recovery
 * signals in a renderer-neutral format. It does not export over the network and does not require
 * browser-only APIs, so the same contract can run in headless CI.
 *
 * @module renderMetricsCollector
 */

const freeze = Object.freeze;
const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const clamp = (v, min, max) => Math.min(max, Math.max(min, finite(v, min)));

export const RENDER_METRICS_POLICY = freeze({
  id: 'render-metrics-2026-09-v1',
  maxFrames: 240,
  maxEvents: 128,
  maxSamples: 512,
});

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function sampleStats(values) {
  if (!values.length) return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { count: values.length, min, max, mean, p50: percentile(values, 0.5), p95: percentile(values, 0.95), p99: percentile(values, 0.99) };
}

export function createRenderMetricsCollector(options = {}) {
  const policy = freeze({ ...RENDER_METRICS_POLICY, ...(options.policy || {}) });
  const frames = [];
  const events = [];
  const samples = new Map();
  const counters = new Map();
  const gauges = new Map();
  let frame = 0;
  let disposed = false;

  function count(name, delta = 1) {
    if (disposed) return 0;
    const next = finite(counters.get(name)) + finite(delta, 1);
    counters.set(String(name).slice(0, 64), Math.max(0, next));
    return next;
  }

  function gauge(name, value) {
    if (disposed) return 0;
    const normalized = finite(value);
    gauges.set(String(name).slice(0, 64), normalized);
    return normalized;
  }

  function observe(name, value) {
    if (disposed) return 0;
    const key = String(name).slice(0, 64);
    const list = samples.get(key) || [];
    list.push(finite(value));
    while (list.length > policy.maxSamples) list.shift();
    samples.set(key, list);
    return list[list.length - 1];
  }

  function recordFrame(metrics = {}) {
    if (disposed) return null;
    frame += 1;
    const record = freeze({
      frame,
      timestampMs: Math.max(0, finite(metrics.timestampMs, frame * 16.67)),
      frameMs: Math.max(0, finite(metrics.frameMs)),
      cpuMs: Math.max(0, finite(metrics.cpuMs)),
      gpuMs: Math.max(0, finite(metrics.gpuMs)),
      drawCalls: Math.max(0, finite(metrics.drawCalls)),
      triangles: Math.max(0, finite(metrics.triangles)),
      instances: Math.max(0, finite(metrics.instances)),
      renderScale: clamp(metrics.renderScale, 0.5, 1),
      backend: metrics.backend === 'webgpu' ? 'webgpu' : 'webgl2',
      tier: String(metrics.tier || 'balanced').slice(0, 32),
      recoveryState: String(metrics.recoveryState || 'healthy').slice(0, 32),
    });
    frames.push(record);
    while (frames.length > policy.maxFrames) frames.shift();
    observe('frameMs', record.frameMs);
    observe('gpuMs', record.gpuMs);
    observe('cpuMs', record.cpuMs);
    gauge('drawCalls', record.drawCalls);
    gauge('triangles', record.triangles);
    gauge('instances', record.instances);
    gauge('renderScale', record.renderScale);
    count(`backend.${record.backend}`);
    count(`tier.${record.tier}`);
    return record;
  }

  function event(name, data = {}, timestampMs = 0) {
    if (disposed) return null;
    const fields = {};
    for (const key of Object.keys(data).slice(0, 12)) {
      const value = data[key];
      if (typeof value === 'string') fields[String(key).slice(0, 48)] = value.slice(0, 96);
      else if (typeof value === 'number' && Number.isFinite(value)) fields[String(key).slice(0, 48)] = value;
      else if (typeof value === 'boolean') fields[String(key).slice(0, 48)] = value;
    }
    const record = freeze({ sequence: events.length, name: String(name || 'render.event').slice(0, 64), timestampMs: Math.max(0, finite(timestampMs)), fields: freeze(fields) });
    events.push(record);
    while (events.length > policy.maxEvents) events.shift();
    return record;
  }

  function snapshot() {
    const histogramSummary = {};
    for (const [name, values] of samples) histogramSummary[name] = freeze(sampleStats(values));
    return freeze({ policy, disposed, frame, counters: freeze(Object.fromEntries(counters)), gauges: freeze(Object.fromEntries(gauges)), samples: freeze(histogramSummary), recentFrames: freeze(frames.slice(-policy.maxFrames)), events: freeze(events.slice(-policy.maxEvents)) });
  }

  function reset() {
    frames.length = 0;
    events.length = 0;
    samples.clear();
    counters.clear();
    gauges.clear();
    frame = 0;
  }

  function dispose() { disposed = true; reset(); }
  return freeze({ count, gauge, observe, recordFrame, event, snapshot, reset, dispose, get frame() { return frame; }, get disposed() { return disposed; } });
}
