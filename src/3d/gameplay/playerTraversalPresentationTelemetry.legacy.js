/** Traversal presentation telemetry. Plain deterministic aggregation; no network or persistence ownership. */
import { PLAYER_TRAVERSAL_PRESENTATION_EVENTS, PLAYER_TRAVERSAL_PRESENTATION_STATES } from './playerTraversalPresentationPolicy.js';
import { deriveTraversalTimelineSummary } from './playerTraversalPresentationTimeline.js';

export const PLAYER_TRAVERSAL_PRESENTATION_TELEMETRY_VERSION = '2026-09-15-v1';

function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function clamp01(value) { return clamp(finite(value), 0, 1); }
function round(value, digits = 4) { const f = 10 ** digits; return Math.round(finite(value) * f) / f; }
function freeze(value) { return Object.freeze(value); }

export function createTraversalPresentationTelemetry() {
  const stateCounts = Object.fromEntries(PLAYER_TRAVERSAL_PRESENTATION_STATES.map((state) => [state, 0]));
  const eventCounts = Object.fromEntries(PLAYER_TRAVERSAL_PRESENTATION_EVENTS.map((event) => [event, 0]));
  let samples = 0;
  let confidenceTotal = 0;
  let confidenceMinimum = 1;
  let confidenceMaximum = 0;
  let transitionCount = 0;
  let blockedCount = 0;
  let landingCount = 0;
  let hardLandingCount = 0;
  let cancelledCount = 0;
  let recoverCount = 0;
  let traversalWeightTotal = 0;
  let anticipationTotal = 0;
  let commitmentTotal = 0;
  let contactTotal = 0;
  let impactTotal = 0;

  function observe(presentation) {
    if (!presentation) return snapshot();
    samples += 1;
    const state = presentation.state;
    const event = presentation.event;
    if (stateCounts[state] != null) stateCounts[state] += 1;
    if (eventCounts[event] != null) eventCounts[event] += 1;
    const confidence = clamp01(presentation.confidence);
    confidenceTotal += confidence;
    confidenceMinimum = Math.min(confidenceMinimum, confidence);
    confidenceMaximum = Math.max(confidenceMaximum, confidence);
    if (event !== 'none') transitionCount += 1;
    if (state === 'blocked') blockedCount += 1;
    if (state === 'land') {
      landingCount += 1;
      if (finite(presentation.metrics?.impact) >= 4.5) hardLandingCount += 1;
    }
    if (state === 'cancelled') cancelledCount += 1;
    if (state === 'recover') recoverCount += 1;
    traversalWeightTotal += clamp01(presentation.channels?.traversal);
    anticipationTotal += clamp01(presentation.channels?.anticipation);
    commitmentTotal += clamp01(presentation.channels?.commitment);
    contactTotal += clamp01(presentation.channels?.contact);
    impactTotal += clamp01(presentation.channels?.impact);
    return snapshot();
  }

  function snapshot() {
    const average = samples ? confidenceTotal / samples : 0;
    return freeze({
      version: PLAYER_TRAVERSAL_PRESENTATION_TELEMETRY_VERSION,
      samples,
      stateCounts: freeze({ ...stateCounts }),
      eventCounts: freeze({ ...eventCounts }),
      transitions: transitionCount,
      blocked: blockedCount,
      landings: landingCount,
      hardLandings: hardLandingCount,
      cancelled: cancelledCount,
      recoveries: recoverCount,
      confidence: freeze({ average: round(average), minimum: round(samples ? confidenceMinimum : 0), maximum: round(confidenceMaximum) }),
      channels: freeze({
        traversal: round(samples ? traversalWeightTotal / samples : 0),
        anticipation: round(samples ? anticipationTotal / samples : 0),
        commitment: round(samples ? commitmentTotal / samples : 0),
        contact: round(samples ? contactTotal / samples : 0),
        impact: round(samples ? impactTotal / samples : 0),
      }),
    });
  }

  function reset() {
    for (const key of Object.keys(stateCounts)) stateCounts[key] = 0;
    for (const key of Object.keys(eventCounts)) eventCounts[key] = 0;
    samples = 0; confidenceTotal = 0; confidenceMinimum = 1; confidenceMaximum = 0;
    transitionCount = 0; blockedCount = 0; landingCount = 0; hardLandingCount = 0;
    cancelledCount = 0; recoverCount = 0; traversalWeightTotal = 0; anticipationTotal = 0;
    commitmentTotal = 0; contactTotal = 0; impactTotal = 0;
    return snapshot();
  }
  function importSnapshot(input = {}) {
    reset();
    for (const [key, value] of Object.entries(input.stateCounts ?? {})) if (stateCounts[key] != null) stateCounts[key] = Math.max(0, finite(value));
    for (const [key, value] of Object.entries(input.eventCounts ?? {})) if (eventCounts[key] != null) eventCounts[key] = Math.max(0, finite(value));
    samples = Math.max(0, finite(input.samples));
    transitionCount = Math.max(0, finite(input.transitions));
    blockedCount = Math.max(0, finite(input.blocked));
    landingCount = Math.max(0, finite(input.landings));
    hardLandingCount = Math.max(0, finite(input.hardLandings));
    cancelledCount = Math.max(0, finite(input.cancelled));
    recoverCount = Math.max(0, finite(input.recoveries));
    return snapshot();
  }
  return freeze({ observe, snapshot, reset, importSnapshot });
}

export function mergeTraversalPresentationTelemetry(target, source) {
  const a = target?.snapshot?.() ?? target ?? {};
  const b = source?.snapshot?.() ?? source ?? {};
  const output = { ...a };
  output.samples = finite(a.samples) + finite(b.samples);
  for (const key of ['stateCounts','eventCounts']) {
    output[key] = {};
    const keys = new Set([...Object.keys(a[key] ?? {}), ...Object.keys(b[key] ?? {})]);
    for (const item of keys) output[key][item] = finite(a[key]?.[item]) + finite(b[key]?.[item]);
  }
  for (const key of ['transitions','blocked','landings','hardLandings','cancelled','recoveries']) output[key] = finite(a[key]) + finite(b[key]);
  return freeze(output);
}

export function summarizeTraversalTimelineTelemetry(timeline = []) {
  const summary = deriveTraversalTimelineSummary(timeline);
  return freeze({
    version: PLAYER_TRAVERSAL_PRESENTATION_TELEMETRY_VERSION,
    durationSeconds: summary.durationSeconds,
    entries: summary.entries,
    averageConfidence: summary.confidence.average,
    minimumConfidence: summary.confidence.minimum,
    maximumConfidence: summary.confidence.maximum,
    stateDurations: summary.states,
    eventCounts: summary.events,
  });
}

export function telemetryRiskFlags(snapshot = {}) {
  const flags = [];
  if (finite(snapshot.confidence?.average) < 0.5) flags.push('low-confidence');
  if (finite(snapshot.blocked) > Math.max(3, finite(snapshot.samples) * 0.2)) flags.push('blocked-heavy');
  if (finite(snapshot.hardLandings) > Math.max(2, finite(snapshot.landings) * 0.25)) flags.push('hard-landings-heavy');
  if (finite(snapshot.cancelled) > Math.max(2, finite(snapshot.samples) * 0.15)) flags.push('cancellation-heavy');
  return freeze(flags);
}
