/**
 * Deterministic tuning report utilities for traversal presentation profiles.
 *
 * The report layer lets reviewers compare named presentation profiles without mutating the policy tables.
 * It is intentionally offline/read-only: no persistence, timing source, renderer or gameplay authority is involved.
 */
import { PLAYER_TRAVERSAL_PRESENTATION_TUNINGS, getTraversalPresentationTuning } from './playerTraversalPresentationTuning.js';
import { PLAYER_TRAVERSAL_SURFACE_PROFILES, getTraversalSurfaceProfile } from './playerTraversalPresentationSurfacePolicy.js';

export const PLAYER_TRAVERSAL_PRESENTATION_TUNING_REPORT_VERSION='2026-09-15-v1';

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, finite(value)));
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  const rounded = Math.round(finite(value) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function freeze(value) {
  return Object.freeze(value);
}

export function listTraversalTuningProfiles() {
  return Object.freeze(Object.keys(PLAYER_TRAVERSAL_PRESENTATION_TUNINGS));
}

export function listTraversalSurfaceProfilesForTuning() {
  return Object.freeze(Object.keys(PLAYER_TRAVERSAL_SURFACE_PROFILES));
}

export function summarizeTraversalTuningProfile(name = 'balanced') {
  const profile = getTraversalPresentationTuning(name);
  return freeze({
    name,
    anticipation: round(profile.anticipation),
    commitment: round(profile.commitment),
    contact: round(profile.contact),
    impact: round(profile.impact),
    confidenceFloor: round(clamp01(profile.confidenceFloor)),
  });
}

export function compareTraversalTuningProfiles(first = 'balanced', second = 'balanced') {
  const a = getTraversalPresentationTuning(first);
  const b = getTraversalPresentationTuning(second);
  return freeze({
    first,
    second,
    delta: freeze({
      anticipation: round(a.anticipation - b.anticipation),
      commitment: round(a.commitment - b.commitment),
      contact: round(a.contact - b.contact),
      impact: round(a.impact - b.impact),
      confidenceFloor: round(a.confidenceFloor - b.confidenceFloor),
    }),
  });
}

export function summarizeTraversalSurfaceProfile(name = 'unknown') {
  const profile = getTraversalSurfaceProfile(name);
  return freeze({
    name,
    grip: round(clamp01(profile.grip)),
    impact: round(Math.max(0, finite(profile.impact))),
    anticipation: round(Math.max(0, finite(profile.anticipation))),
    audio: String(profile.audio ?? 'generic'),
  });
}

export function compareTraversalSurfaceProfiles(first = 'stone', second = 'unknown') {
  const a = getTraversalSurfaceProfile(first);
  const b = getTraversalSurfaceProfile(second);
  return freeze({
    first,
    second,
    delta: freeze({
      grip: round(a.grip - b.grip),
      impact: round(a.impact - b.impact),
      anticipation: round(a.anticipation - b.anticipation),
    }),
  });
}

export function buildTraversalPresentationTuningMatrix() {
  const profiles = listTraversalTuningProfiles();
  const surfaces = listTraversalSurfaceProfilesForTuning();
  const tuningRows = profiles.map((name) => summarizeTraversalTuningProfile(name));
  const surfaceRows = surfaces.map((name) => summarizeTraversalSurfaceProfile(name));
  return freeze({
    version: PLAYER_TRAVERSAL_PRESENTATION_TUNING_REPORT_VERSION,
    profiles: freeze(tuningRows),
    surfaces: freeze(surfaceRows),
    profileCount: profiles.length,
    surfaceCount: surfaces.length,
  });
}

export function resolveTraversalTuningRecommendation(state = 'vault', surface = 'stone') {
  const surfaceProfile = getTraversalSurfaceProfile(surface);
  const base = getTraversalPresentationTuning('balanced');
  let recommendation = 'balanced';
  if (state === 'drop' || state === 'land') recommendation = 'heavy';
  else if (surfaceProfile.grip < 0.55) recommendation = 'cautious';
  else if (state === 'vault' || state === 'climb') recommendation = 'responsive';
  const selected = getTraversalPresentationTuning(recommendation);
  return freeze({
    state,
    surface,
    recommendation,
    confidenceFloor: round(Math.max(base.confidenceFloor, selected.confidenceFloor)),
    emphasis: freeze({
      anticipation: round(selected.anticipation * surfaceProfile.anticipation),
      commitment: round(selected.commitment * surfaceProfile.grip),
      contact: round(selected.contact * surfaceProfile.grip),
      impact: round(selected.impact * surfaceProfile.impact),
    }),
  });
}

export function buildTraversalTuningReviewCases() {
  const states = ['clear', 'approach', 'prepare', 'vault', 'climb', 'drop', 'land', 'blocked', 'recover', 'cancelled'];
  const surfaces = listTraversalSurfaceProfilesForTuning();
  const rows = [];
  for (const state of states) {
    for (const surface of surfaces) {
      const recommendation = resolveTraversalTuningRecommendation(state, surface);
      rows.push(freeze({ state, surface, recommendation: recommendation.recommendation, emphasis: recommendation.emphasis }));
    }
  }
  return freeze(rows);
}

export function validateTraversalTuningReviewCases(rows = []) {
  const errors = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row.state || !row.surface || !row.recommendation) errors.push(`row:${index}:identity`);
    for (const key of ['anticipation', 'commitment', 'contact', 'impact']) {
      if (row.emphasis?.[key] < 0 || row.emphasis?.[key] > 1.2) errors.push(`row:${index}:${key}`);
    }
  }
  return freeze({ valid: errors.length === 0, errors: freeze(errors) });
}

export function summarizeTraversalTuningReview(rows = []) {
  const counts = {};
  for (const row of rows) counts[row.recommendation] = (counts[row.recommendation] ?? 0) + 1;
  return freeze({
    version: PLAYER_TRAVERSAL_PRESENTATION_TUNING_REPORT_VERSION,
    rows: rows.length,
    recommendations: freeze(counts),
    validation: validateTraversalTuningReviewCases(rows),
  });
}

export function compareTraversalTuningMatrices(first = {}, second = {}) {
  return JSON.stringify(first) === JSON.stringify(second);
}

export function buildTraversalTuningFingerprint() {
  return JSON.stringify(buildTraversalPresentationTuningMatrix());
}
