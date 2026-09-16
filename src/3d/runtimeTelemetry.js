/**
 * Low-allocation runtime telemetry ring buffer.
 *
 * Telemetry is intentionally renderer-agnostic. It samples frame, simulation, streaming and memory
 * signals, computes bounded rolling summaries, and exposes a compact snapshot for the debug panel or
 * a future diagnostics upload. No PII, URL, or user input is recorded here.
 * @module runtimeTelemetry
 */

const DEFAULTS = Object.freeze({ capacity: 180, sampleEveryFrames: 6, maxEvents: 48 });
function n(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, n(v, lo))); }
function avg(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = clamp(q, 0, 1) * (sorted.length - 1);
  const low = Math.floor(position), high = Math.ceil(position);
  return low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export function createRuntimeTelemetry(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const samples = [];
  const events = [];
  let frame = 0;
  let elapsedMs = 0;
  let droppedSamples = 0;
  let disposed = false;

  function pushSample(sample) {
    samples.push(Object.freeze(sample));
    while (samples.length > Math.max(8, Math.trunc(config.capacity))) {
      samples.shift();
      droppedSamples += 1;
    }
  }
  function addEvent(type, payload = {}) {
    events.push(Object.freeze({ frame, type: String(type), ...payload }));
    while (events.length > Math.max(4, Math.trunc(config.maxEvents))) events.shift();
  }
  function capture({ frameMs, simulationMs = 0, streamingMs = 0, renderCalls = 0, triangles = 0, residentChunks = 0, faunaActive = 0, assetQueue = 0, memoryMb = 0 } = {}) {
    if (disposed) throw new Error('RUNTIME_TELEMETRY_DISPOSED');
    frame += 1;
    const duration = Math.max(0, n(frameMs));
    elapsedMs += duration;
    if (frame % Math.max(1, Math.trunc(config.sampleEveryFrames)) !== 0) return null;
    const sample = {
      frame,
      frameMs: Number(duration.toFixed(3)),
      fps: Number((1000 / Math.max(0.1, duration)).toFixed(2)),
      simulationMs: Number(Math.max(0, n(simulationMs)).toFixed(3)),
      streamingMs: Number(Math.max(0, n(streamingMs)).toFixed(3)),
      renderCalls: Math.max(0, Math.trunc(n(renderCalls))),
      triangles: Math.max(0, Math.trunc(n(triangles))),
      residentChunks: Math.max(0, Math.trunc(n(residentChunks))),
      faunaActive: Math.max(0, Math.trunc(n(faunaActive))),
      assetQueue: Math.max(0, Math.trunc(n(assetQueue))),
      memoryMb: Math.max(0, n(memoryMb)),
    };
    pushSample(sample);
    return sample;
  }
  return {
    frame,
    capture,
    event: addEvent,
    snapshot() {
      if (disposed) throw new Error('RUNTIME_TELEMETRY_DISPOSED');
      const frameValues = samples.map((sample) => sample.frameMs);
      const fpsValues = samples.map((sample) => sample.fps);
      const renderValues = samples.map((sample) => sample.renderCalls);
      const memoryValues = samples.map((sample) => sample.memoryMb).filter((value) => value > 0);
      return Object.freeze({
        version: 1,
        frame,
        elapsedMs: Number(elapsedMs.toFixed(1)),
        sampleCount: samples.length,
        droppedSamples,
        frameMs: Object.freeze({ avg: Number(avg(frameValues).toFixed(3)), p50: Number(quantile(frameValues, 0.5).toFixed(3)), p95: Number(quantile(frameValues, 0.95).toFixed(3)), p99: Number(quantile(frameValues, 0.99).toFixed(3)) }),
        fps: Object.freeze({ avg: Number(avg(fpsValues).toFixed(2)), p5: Number(quantile(fpsValues, 0.05).toFixed(2)), p50: Number(quantile(fpsValues, 0.5).toFixed(2)) }),
        renderCalls: Object.freeze({ avg: Number(avg(renderValues).toFixed(2)), p95: Number(quantile(renderValues, 0.95).toFixed(2)) }),
        memoryMb: memoryValues.length ? Number(quantile(memoryValues, 0.5).toFixed(2)) : null,
        recent: Object.freeze(samples.slice(-12)),
        events: Object.freeze(events.slice(-12)),
      });
    },
    reset() { samples.length = 0; events.length = 0; frame = 0; elapsedMs = 0; droppedSamples = 0; },
    dispose() { disposed = true; samples.length = 0; events.length = 0; },
  };
}

export function createPerformanceMarkReader({ performanceObject = globalThis.performance } = {}) {
  const starts = new Map();
  return {
    begin(label) {
      if (!label || !performanceObject?.now) return;
      starts.set(String(label), performanceObject.now());
    },
    end(label) {
      const key = String(label);
      const start = starts.get(key);
      if (!Number.isFinite(start) || !performanceObject?.now) return null;
      starts.delete(key);
      return Number(Math.max(0, performanceObject.now() - start).toFixed(3));
    },
    clear() { starts.clear(); },
  };
}
