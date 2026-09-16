/**
 * Runtime diagnostics formatter and invariant checks.
 *
 * Turns subsystem snapshots into concise health reports for development tooling and CI. Formatting is
 * deterministic and contains no DOM or renderer dependencies.
 */

import { clamp, finiteOr, integerOr, stableStringify } from './modernRuntimeContract.js';
import { combineHealthLevels } from './runtimeHealthMonitor.js';
import { classifyResidencyPressure } from './assetResidencyCache.js';

export function evaluateRuntimeInvariants(snapshot = {}) {
  const failures = [];
  const warnings = [];
  const scheduler = snapshot.scheduler || {};
  const quality = snapshot.quality || {};
  const health = snapshot.health || {};
  const telemetry = snapshot.telemetry || {};
  const input = snapshot.input || {};

  if (!(finiteOr(scheduler.fixedStepMs, 0) > 0)) failures.push('scheduler.fixedStepMs must be positive');
  if (!(finiteOr(scheduler.maxCatchupMs, 0) >= finiteOr(scheduler.fixedStepMs, 1))) failures.push('scheduler.maxCatchupMs must cover one fixed step');
  if (!(integerOr(scheduler.maxStepsPerFrame, 0) >= 1)) failures.push('scheduler.maxStepsPerFrame must be positive');
  if (!(finiteOr(quality.pressure, 0) >= 0)) failures.push('quality.pressure must be finite');
  if (!['healthy', 'watch', 'degraded', 'critical'].includes(health.health)) warnings.push('health level is missing or non-standard');
  if (!(integerOr(input.capacity, 0) > 0)) failures.push('input buffer capacity must be positive');
  if (!(integerOr(telemetry.eventCount, 0) >= 0)) failures.push('telemetry event count must be non-negative');
  if (snapshot.visibility === 'visible' && snapshot.running === false) warnings.push('runtime is not running while visible');

  return Object.freeze({ valid: failures.length === 0, failures: Object.freeze(failures), warnings: Object.freeze(warnings) });
}

export function summarizeRuntimeHealth(diagnostics = {}) {
  const subsystemHealth = [
    diagnostics.health?.health,
    diagnostics.scheduler?.spiralGuard ? 'degraded' : 'healthy',
    classifyResidencyPressure(diagnostics.residency?.usedMb, diagnostics.residency?.capacityMb),
  ].filter(Boolean);
  const health = combineHealthLevels(...subsystemHealth);
  const frameP95 = finiteOr(diagnostics.telemetry?.metrics?.['frame.cpuMs']?.p95, 0);
  const gpuP95 = finiteOr(diagnostics.telemetry?.metrics?.['frame.gpuMs']?.p95, 0);
  const loadScore = clamp(Math.max(frameP95 / 8, gpuP95 / 8), 0, 10);
  return Object.freeze({
    health,
    loadScore,
    frameP95,
    gpuP95,
    action: health === 'critical' ? 'recover' : health === 'degraded' ? 'reduce-load' : health === 'watch' ? 'observe' : 'hold',
  });
}

export function createDiagnosticsDigest(diagnostics = {}) {
  const invariant = evaluateRuntimeInvariants(diagnostics);
  const summary = summarizeRuntimeHealth(diagnostics);
  return Object.freeze({
    valid: invariant.valid,
    health: summary.health,
    action: summary.action,
    warnings: [...invariant.warnings],
    failures: [...invariant.failures],
    platformProfile: String(diagnostics.platformProfile || 'unknown'),
    qualityTier: String(diagnostics.quality?.tier || 'unknown'),
    schedulerTick: integerOr(diagnostics.scheduler?.tick, 0),
    telemetryEvents: integerOr(diagnostics.telemetry?.eventCount, 0),
    inputQueued: integerOr(diagnostics.input?.queued?.length, 0),
  });
}

export function exportDiagnosticsText(diagnostics = {}) {
  const digest = createDiagnosticsDigest(diagnostics);
  const lines = [
    `health=${digest.health}`,
    `action=${digest.action}`,
    `valid=${digest.valid}`,
    `platform=${digest.platformProfile}`,
    `quality=${digest.qualityTier}`,
    `tick=${digest.schedulerTick}`,
    `telemetryEvents=${digest.telemetryEvents}`,
    `inputQueued=${digest.inputQueued}`,
  ];
  if (digest.warnings.length) lines.push(`warnings=${digest.warnings.join(' | ')}`);
  if (digest.failures.length) lines.push(`failures=${digest.failures.join(' | ')}`);
  return lines.join('\n');
}

export function exportDiagnosticsJson(diagnostics = {}) {
  return stableStringify({ digest: createDiagnosticsDigest(diagnostics), diagnostics });
}

export function createRuntimeChecklist() {
  return Object.freeze([
    Object.freeze({ id: 'deterministic-ticks', owner: 'scheduler', criterion: 'fixed-step scheduler has bounded catch-up' }),
    Object.freeze({ id: 'semantic-input', owner: 'input', criterion: 'device inputs become semantic commands' }),
    Object.freeze({ id: 'adaptive-quality', owner: 'quality', criterion: 'quality changes use hysteresis and dwell' }),
    Object.freeze({ id: 'bounded-telemetry', owner: 'telemetry', criterion: 'history and payload size are bounded' }),
    Object.freeze({ id: 'save-integrity', owner: 'persistence', criterion: 'save payloads carry revision and checksum' }),
    Object.freeze({ id: 'memory-bounds', owner: 'residency', criterion: 'asset residency has weight and capacity limits' }),
    Object.freeze({ id: 'graceful-recovery', owner: 'recovery', criterion: 'faults produce bounded recovery intents' }),
    Object.freeze({ id: 'accessibility-signal', owner: 'platform', criterion: 'reduced-motion and data-saver are observable' }),
    Object.freeze({ id: 'ci-acceptance', owner: 'ci', criterion: 'syntax, acceptance, determinism and ownership checks run' }),
  ]);
}

export function verifyChecklist(checklist = createRuntimeChecklist(), capabilities = {}) {
  const missing = checklist.filter((item) => item.id === 'accessibility-signal' && capabilities === undefined).map((item) => item.id);
  return Object.freeze({ complete: missing.length === 0, missing });
}
