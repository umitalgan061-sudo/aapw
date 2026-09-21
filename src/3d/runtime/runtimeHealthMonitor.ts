// @ts-nocheck
/**
 * Runtime health monitor.
 *
 * Converts raw frame/simulation/renderer counters into bounded health signals, degradation levels
 * and recovery hints. It does not change quality or renderer state; that responsibility remains with
 * the composition layer.
 */

import { clamp, finiteOr, integerOr, makeRingBuffer } from './modernRuntimeContract.js';

export const HEALTH_LEVELS = Object.freeze(['healthy', 'watch', 'degraded', 'critical']);

function levelFromLoad(load) {
  if (load <= 0.9) return 'healthy';
  if (load <= 1.1) return 'watch';
  if (load <= 1.4) return 'degraded';
  return 'critical';
}

function maxLevel(a, b) {
  const order = HEALTH_LEVELS;
  return order[Math.max(order.indexOf(a), order.indexOf(b))];
}

function createCounterWindow(size = 120) {
  const buffer = makeRingBuffer(size);
  return {
    push(sample) { buffer.push(sample); },
    values() { return buffer.toArray(); },
    clear() { buffer.clear(); },
    get length() { return buffer.length; },
  };
}

export function createRuntimeHealthMonitor(options = {}) {
  const frameBudgetMs = clamp(finiteOr(options.frameBudgetMs, 16.67), 4, 100);
  const simulationBudgetMs = clamp(finiteOr(options.simulationBudgetMs, 7), 1, 80);
  const presentationBudgetMs = clamp(finiteOr(options.presentationBudgetMs, 5), 1, 80);
  const historySize = clamp(integerOr(options.historySize, 120), 30, 1000);
  const frames = createCounterWindow(historySize);
  const simulation = createCounterWindow(historySize);
  const presentation = createCounterWindow(historySize);
  let visibility = 'visible';
  let consecutiveBadFrames = 0;
  let consecutiveGoodFrames = 0;
  let lastHealth = 'healthy';
  let lastTimestampMs = 0;
  let stalls = 0;
  let recoveries = 0;
  let dropped = 0;

  function sample(input = {}) {
    const deltaMs = clamp(finiteOr(input.deltaMs, frameBudgetMs), 0, 500);
    const simMs = clamp(finiteOr(input.simulationMs, 0), 0, 500);
    const presentMs = clamp(finiteOr(input.presentationMs, 0), 0, 500);
    const load = Math.max(deltaMs / frameBudgetMs, simMs / simulationBudgetMs, presentMs / presentationBudgetMs);
    const level = levelFromLoad(load);
    frames.push(deltaMs);
    simulation.push(simMs);
    presentation.push(presentMs);
    if (deltaMs > frameBudgetMs * 2) stalls += 1;
    if (input.dropped) dropped += 1;
    if (level === 'healthy' || level === 'watch') {
      consecutiveGoodFrames += 1;
      consecutiveBadFrames = 0;
    } else {
      consecutiveBadFrames += 1;
      consecutiveGoodFrames = 0;
    }
    if (level !== lastHealth && level === 'healthy') recoveries += 1;
    lastHealth = level;
    lastTimestampMs = Math.max(lastTimestampMs, finiteOr(input.timestampMs, lastTimestampMs));

    return Object.freeze({
      level,
      load,
      frameMs: deltaMs,
      simulationMs: simMs,
      presentationMs: presentMs,
      consecutiveBadFrames,
      consecutiveGoodFrames,
      visibility,
    });
  }

  function setVisibility(next) {
    visibility = ['visible', 'hidden', 'prerender', 'unknown'].includes(next) ? next : 'unknown';
    return visibility;
  }

  function recommend() {
    if (visibility !== 'visible') return Object.freeze({ action: 'pause-or-throttle', reason: `visibility:${visibility}` });
    if (consecutiveBadFrames >= 12) return Object.freeze({ action: 'reduce-quality', reason: 'sustained-budget-pressure' });
    if (consecutiveBadFrames >= 4) return Object.freeze({ action: 'shed-effects', reason: 'budget-pressure' });
    if (consecutiveGoodFrames >= 180) return Object.freeze({ action: 'consider-recovery', reason: 'sustained-recovery' });
    return Object.freeze({ action: 'hold', reason: 'stable' });
  }

  function summary() {
    const frameValues = frames.values();
    const simValues = simulation.values();
    const presentValues = presentation.values();
    const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    return Object.freeze({
      health: lastHealth,
      visibility,
      stalls,
      dropped,
      recoveries,
      lastTimestampMs,
      frame: Object.freeze({ averageMs: average(frameValues), worstMs: Math.max(0, ...frameValues) }),
      simulation: Object.freeze({ averageMs: average(simValues), worstMs: Math.max(0, ...simValues) }),
      presentation: Object.freeze({ averageMs: average(presentValues), worstMs: Math.max(0, ...presentValues) }),
      recommendation: recommend(),
    });
  }

  function reset() {
    frames.clear();
    simulation.clear();
    presentation.clear();
    consecutiveBadFrames = 0;
    consecutiveGoodFrames = 0;
    lastHealth = 'healthy';
    lastTimestampMs = 0;
    stalls = 0;
    recoveries = 0;
    dropped = 0;
  }

  return Object.freeze({ sample, setVisibility, recommend, summary, reset, get health() { return lastHealth; } });
}

export function combineHealthLevels(...levels) {
  let result = 'healthy';
  for (const level of levels) result = maxLevel(result, HEALTH_LEVELS.includes(level) ? level : 'watch');
  return result;
}

export function buildHealthBudget(input = {}) {
  return Object.freeze({
    frameMs: clamp(finiteOr(input.frameMs, 16.67), 4, 100),
    simulationMs: clamp(finiteOr(input.simulationMs, 7), 1, 80),
    presentationMs: clamp(finiteOr(input.presentationMs, 5), 1, 80),
    networkMs: clamp(finiteOr(input.networkMs, 250), 20, 5000),
    storageMs: clamp(finiteOr(input.storageMs, 50), 5, 1000),
  });
}
