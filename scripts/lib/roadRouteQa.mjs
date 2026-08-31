#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { profileRoadPolyline } from '../../src/3d/world/roadSurfaceProfile.js';

export const QA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const ARTIFACT_ROOT = resolve(QA_ROOT, 'artifacts/road-route-exact-head');
export const TAU = Math.PI * 2;

export const round = (value, digits = 5) => Number(Number(value).toFixed(digits));
export const clamp01 = (value) => Math.max(0, Math.min(1, value));
export const smoothstep = (edge0, edge1, value) => {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * clamp01(p);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const t = index - lower;
  return sorted[lower] * (1 - t) + sorted[upper] * t;
}

export function standardDeviation(values) {
  if (!values.length) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
}

export function summarize(values, digits = 5) {
  if (!values.length) return Object.freeze({ count: 0, min: 0, p10: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0, mean: 0, sd: 0 });
  return Object.freeze({
    count: values.length,
    min: round(Math.min(...values), digits),
    p10: round(percentile(values, 0.10), digits),
    p50: round(percentile(values, 0.50), digits),
    p90: round(percentile(values, 0.90), digits),
    p95: round(percentile(values, 0.95), digits),
    p99: round(percentile(values, 0.99), digits),
    max: round(Math.max(...values), digits),
    mean: round(mean(values), digits),
    sd: round(standardDeviation(values), digits),
  });
}

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian2d(x, z, cx, cz, sx, sz, amplitude) {
  const dx = (x - cx) / sx;
  const dz = (z - cz) / sz;
  return amplitude * Math.exp(-(dx * dx + dz * dz));
}

export function ridgeField(x, z, options = {}) {
  const { centerX = 0, centerZ = 0, widthMeters = 70, lengthMeters = 900, heightMeters = 95, angleRadians = 0 } = options;
  const cos = Math.cos(angleRadians);
  const sin = Math.sin(angleRadians);
  const dx = x - centerX;
  const dz = z - centerZ;
  const across = dx * cos + dz * sin;
  const along = -dx * sin + dz * cos;
  return heightMeters * Math.exp(-((across / widthMeters) ** 2)) * Math.exp(-((along / lengthMeters) ** 8));
}

export function rollingField(x, z, seed = 0) {
  const phase = seed * 0.173;
  return Math.sin(x / 190 + phase) * 5.5 + Math.cos(z / 230 - phase * 0.7) * 4.1 + Math.sin((x + z) / 145 + phase * 1.3) * 2.8 + Math.cos((x - z) / 310 - phase) * 1.9;
}

export function mountainField(x, z, options = {}) {
  const { centerX = 0, centerZ = 0, radiusMeters = 620, heightMeters = 180, shoulderOffsetX = 220, shoulderOffsetZ = -160, shoulderHeightMeters = 42, seed = 0 } = options;
  const main = gaussian2d(x, z, centerX, centerZ, radiusMeters, radiusMeters * 0.92, heightMeters);
  const shoulder = gaussian2d(x, z, centerX + shoulderOffsetX, centerZ + shoulderOffsetZ, radiusMeters * 0.58, radiusMeters * 0.72, shoulderHeightMeters);
  return main + shoulder + rollingField(x, z, seed) * 0.55;
}

export function saddleField(x, z, options = {}) {
  const { centerX = 0, centerZ = 0, separationMeters = 420, radiusMeters = 410, heightMeters = 130, angleRadians = 0 } = options;
  const cos = Math.cos(angleRadians); const sin = Math.sin(angleRadians);
  const dx = cos * separationMeters * 0.5; const dz = sin * separationMeters * 0.5;
  return gaussian2d(x, z, centerX - dx, centerZ - dz, radiusMeters, radiusMeters, heightMeters) + gaussian2d(x, z, centerX + dx, centerZ + dz, radiusMeters, radiusMeters, heightMeters);
}

export function terraceField(x, z, options = {}) {
  const { axis = 'x', stepMeters = 180, riseMeters = 12, blurMeters = 28 } = options;
  const coordinate = axis === 'z' ? z : x;
  const band = coordinate / stepMeters;
  const whole = Math.floor(band);
  const fraction = band - whole;
  const softened = smoothstep(0.5 - blurMeters / stepMeters, 0.5 + blurMeters / stepMeters, fraction);
  return (whole + softened) * riseMeters;
}

export function basinField(x, z, options = {}) {
  const { centerX = 0, centerZ = 0, radiusMeters = 420, depthMeters = 55, rimHeightMeters = 38 } = options;
  const r = Math.hypot(x - centerX, z - centerZ) / radiusMeters;
  return -depthMeters * Math.exp(-(r * r * 1.6)) + rimHeightMeters * Math.exp(-(((r - 1.05) / 0.22) ** 2));
}

export function composeFields(...fields) { return (x, z) => fields.reduce((sum, field) => sum + field(x, z), 0); }

export function routeLength(points) {
  let lengthMeters = 0;
  for (let index = 1; index < points.length; index += 1) lengthMeters += Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z);
  return lengthMeters;
}

export function directDistance(start, end) { return Math.hypot(end.x - start.x, end.z - start.z); }
export function detourRatio(points, start, end) { const direct = directDistance(start, end); return direct > 1e-9 ? routeLength(points) / direct : 1; }

export function maxLateralDeviation(points, start, end) {
  const dx = end.x - start.x; const dz = end.z - start.z; const length = Math.hypot(dx, dz);
  if (length <= 1e-9) return 0;
  let maxDeviation = 0;
  for (const point of points) maxDeviation = Math.max(maxDeviation, Math.abs((point.x - start.x) * dz - (point.z - start.z) * dx) / length);
  return maxDeviation;
}

export function routeMetrics({ result, sampleHeightMeters, start, end, profileSpacingMeters = 8 }) {
  const profile = profileRoadPolyline({ points: result.points, sampleHeightMeters, maxSpacingMeters: profileSpacingMeters });
  return Object.freeze({
    fallback: Boolean(result.diagnostics?.fallback), mode: result.diagnostics?.mode ?? 'unknown', pointCount: result.points.length,
    maxGradeDegrees: round(profile.maxGradeDegrees), meanGradeDegrees: round(profile.meanGradeDegrees), lengthMeters: round(profile.lengthMeters),
    detourRatio: round(detourRatio(result.points, start, end)), maxLateralDeviationMeters: round(maxLateralDeviation(result.points, start, end)),
    ascentMeters: round(profile.totalAscentMeters), descentMeters: round(profile.totalDescentMeters), roughnessRmsMeters: round(profile.roughnessRmsMeters),
    cellMeters: result.diagnostics?.cellMeters ?? null, paddingMeters: result.diagnostics?.paddingMeters ?? null,
    smoothingIterations: result.diagnostics?.smoothingIterations ?? null, expandedNodes: result.diagnostics?.expandedNodes ?? null,
    attemptCount: result.diagnostics?.attempts?.length ?? 0, riverRun: result.diagnostics?.river?.maxConsecutiveAdjacentSamples ?? null,
    minimumRiverDistanceMeters: Number.isFinite(result.diagnostics?.river?.minimumDistanceMeters) ? round(result.diagnostics.river.minimumDistanceMeters) : null,
    checksum: result.diagnostics?.checksum ?? null,
  });
}

export function assertRouteFinite(result, label = 'route') {
  assert(result && Array.isArray(result.points) && result.points.length > 0, `${label} returned no points`);
  for (const [index, point] of result.points.entries()) {
    assert(Number.isFinite(point.x), `${label} point ${index}.x is not finite`);
    assert(Number.isFinite(point.z), `${label} point ${index}.z is not finite`);
    assert(Number.isFinite(point.y), `${label} point ${index}.y is not finite`);
  }
  assert(Number.isFinite(result.maxGradeDegrees), `${label} maxGradeDegrees is not finite`);
}

export function writeJsonArtifact(relativePath, value) {
  const target = resolve(QA_ROOT, relativePath); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`); return target;
}
export function writeMarkdownArtifact(relativePath, lines) {
  const target = resolve(QA_ROOT, relativePath); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, `${lines.join('\n')}\n`); return target;
}
