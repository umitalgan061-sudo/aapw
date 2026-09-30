/** Quality and safety scoring for traversal presentation intent. */
import { PLAYER_TRAVERSAL_PRESENTATION_STATES } from './playerTraversalPresentationPolicy.js';

export const PLAYER_TRAVERSAL_PRESENTATION_QUALITY_VERSION = '2026-09-15-v1';
function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function clamp01(value) { return clamp(finite(value), 0, 1); }
function round(value, digits = 4) { const f = 10 ** digits; return Math.round(finite(value) * f) / f; }
function freeze(value) { return Object.freeze(value); }

export function scoreTraversalPresentationConfidence(presentation = {}) {
  const confidence = clamp01(presentation.confidence);
  const surface = clamp01(presentation.metrics?.surfaceConfidence);
  const contact = clamp01(presentation.metrics?.footContactConfidence);
  const traversal = clamp01(presentation.metrics?.traversalWeight);
  return round(confidence * 0.5 + surface * 0.18 + contact * 0.17 + traversal * 0.15);
}

export function scoreTraversalPresentationContinuity(previous = null, current = null) {
  if (!previous || !current) return 1;
  let score = 1;
  if (Math.abs(finite(previous.metrics?.height) - finite(current.metrics?.height)) > 1.5) score -= 0.2;
  if (Math.abs(finite(previous.metrics?.distance) - finite(current.metrics?.distance)) > 3) score -= 0.2;
  if (previous.state !== current.state && current.event === 'none') score -= 0.25;
  if (current.event !== 'none' && previous.event === current.event) score -= 0.05;
  return round(clamp01(score));
}

export function scoreTraversalPresentationProgress(presentation = {}) {
  const state = presentation.state;
  const channels = presentation.channels ?? {};
  if (state === 'clear') return 1;
  const active = (clamp01(channels.anticipation) + clamp01(channels.commitment) + clamp01(channels.contact)) / 3;
  return round(clamp01(active + (['vault','climb','drop'].includes(state) ? 0.12 : 0)));
}

export function detectTraversalPresentationAnomalies(presentation = {}, previous = null) {
  const anomalies = [];
  if (!PLAYER_TRAVERSAL_PRESENTATION_STATES.includes(presentation.state)) anomalies.push('invalid-state');
  if (presentation.confidence < 0 || presentation.confidence > 1) anomalies.push('invalid-confidence');
  if (presentation.metrics?.distance < 0) anomalies.push('negative-distance');
  if (presentation.metrics?.width < 0) anomalies.push('negative-width');
  if (presentation.state === 'clear' && presentation.channels?.traversal > 0.5) anomalies.push('clear-with-active-traversal');
  if (presentation.state === 'blocked' && presentation.channels?.commitment > 0.8) anomalies.push('blocked-with-high-commitment');
  if (previous && previous.state === 'clear' && presentation.state === 'land') anomalies.push('land-without-observed-traversal');
  return freeze(anomalies);
}

export function validateTraversalPresentationQuality(presentation = {}, previous = null) {
  const anomalies = detectTraversalPresentationAnomalies(presentation, previous);
  const confidence = scoreTraversalPresentationConfidence(presentation);
  const continuity = scoreTraversalPresentationContinuity(previous, presentation);
  const progress = scoreTraversalPresentationProgress(presentation);
  const score = round(confidence * 0.45 + continuity * 0.3 + progress * 0.25);
  return freeze({
    version: PLAYER_TRAVERSAL_PRESENTATION_QUALITY_VERSION,
    valid: anomalies.length === 0,
    score,
    confidence,
    continuity,
    progress,
    anomalies,
  });
}

export function rankTraversalPresentationRisks(presentation = {}, previous = null) {
  const quality = validateTraversalPresentationQuality(presentation, previous);
  const risks = [];
  for (const anomaly of quality.anomalies) risks.push(freeze({ id: anomaly, weight: 1 }));
  if (quality.confidence < 0.5) risks.push(freeze({ id: 'low-confidence', weight: round(1 - quality.confidence) }));
  if (quality.continuity < 0.6) risks.push(freeze({ id: 'continuity-break', weight: round(1 - quality.continuity) }));
  if (quality.progress < 0.3 && presentation.state !== 'clear') risks.push(freeze({ id: 'stalled-progress', weight: round(1 - quality.progress) }));
  risks.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  return freeze(risks);
}

export function buildTraversalPresentationQualitySeries(timeline = []) {
  const rows = [];
  let previous = null;
  for (const entry of timeline) {
    const quality = validateTraversalPresentationQuality(entry, previous);
    rows.push(freeze({ timestampSeconds: entry.timestampSeconds, state: entry.state, event: entry.event, ...quality }));
    previous = entry;
  }
  const average = rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : 0;
  const invalid = rows.filter((row) => !row.valid).length;
  return freeze({ version: PLAYER_TRAVERSAL_PRESENTATION_QUALITY_VERSION, rows: freeze(rows), averageScore: round(average), invalidRows: invalid });
}

export function isTraversalPresentationQualityAcceptable(quality = {}, threshold = 0.68) {
  return Boolean(quality.valid) && finite(quality.score) >= threshold;
}

export function compareTraversalQualityReports(first = {}, second = {}) {
  return JSON.stringify(first) === JSON.stringify(second);
}
