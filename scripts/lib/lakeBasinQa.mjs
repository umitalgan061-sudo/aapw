import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';

export const QA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DEG = 180 / Math.PI;
export const TAU = Math.PI * 2;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value) {
  return clamp(value, 0, 1);
}

export function smoothstep(edge0, edge1, value) {
  if (value <= edge0) return 0;
  if (value >= edge1) return 1;
  const t = (value - edge0) / (edge1 - edge0);
  return t * t * (3 - 2 * t);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function round(value, digits = 4) {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function assertFinite(value, label) {
  assert(Number.isFinite(value), `${label} must be finite, received ${value}`);
  return value;
}

export function assertUnit(value, label, epsilon = 1e-9) {
  assertFinite(value, label);
  assert(value >= -epsilon && value <= 1 + epsilon, `${label} must remain in [0,1], received ${value}`);
  return value;
}

export function sum(values) {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

export function mean(values) {
  return values.length ? sum(values) / values.length : 0;
}

export function variance(values, knownMean = mean(values)) {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) {
    const delta = value - knownMean;
    total += delta * delta;
  }
  return total / values.length;
}

export function standardDeviation(values, knownMean = mean(values)) {
  return Math.sqrt(variance(values, knownMean));
}

export function quantile(values, q) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(q, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return lerp(sorted[lower], sorted[upper], index - lower);
}

export function summarize(values, digits = 4) {
  const finite = values.filter(Number.isFinite);
  const m = mean(finite);
  return Object.freeze({
    count: finite.length,
    min: finite.length ? round(Math.min(...finite), digits) : 0,
    max: finite.length ? round(Math.max(...finite), digits) : 0,
    mean: round(m, digits),
    sd: round(standardDeviation(finite, m), digits),
    p05: round(quantile(finite, 0.05), digits),
    p10: round(quantile(finite, 0.10), digits),
    p25: round(quantile(finite, 0.25), digits),
    p50: round(quantile(finite, 0.50), digits),
    p75: round(quantile(finite, 0.75), digits),
    p90: round(quantile(finite, 0.90), digits),
    p95: round(quantile(finite, 0.95), digits),
    p99: round(quantile(finite, 0.99), digits),
  });
}

export function decodeSurfaceMask(mask) {
  const { width, height, bitsPerCell, rowsHex } = mask;
  assert(Number.isInteger(width) && width > 0, 'mask width must be a positive integer');
  assert(Number.isInteger(height) && height > 0, 'mask height must be a positive integer');
  assert(Number.isInteger(bitsPerCell) && bitsPerCell > 0, 'mask bitsPerCell must be a positive integer');
  assert.equal(rowsHex.length, height, 'mask rowsHex height mismatch');
  const decoded = new Uint8Array(width * height);
  const totalBits = BigInt(width * bitsPerCell);
  const codeMask = (1n << BigInt(bitsPerCell)) - 1n;
  for (let y = 0; y < height; y += 1) {
    const row = BigInt(`0x${rowsHex[y]}`);
    for (let x = 0; x < width; x += 1) {
      const shift = totalBits - BigInt((x + 1) * bitsPerCell);
      decoded[y * width + x] = Number((row >> shift) & codeMask);
    }
  }
  return decoded;
}

export function collectCellCenters(mask, decoded, wantedCode) {
  const centers = [];
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (decoded[y * mask.width + x] !== wantedCode) continue;
      centers.push(Object.freeze({
        cellX: x,
        cellY: y,
        nx: (x + 0.5) / mask.width,
        ny: (y + 0.5) / mask.height,
      }));
    }
  }
  return Object.freeze(centers);
}

export function collectLakeCenters(mask) {
  const decoded = decodeSurfaceMask(mask);
  return collectCellCenters(mask, decoded, mask.codes.lake);
}

export function normalizedToWorld(nx, ny, worldScale) {
  const bounds = worldScale.MAP_BOUNDS;
  const mapX = bounds.minX + (bounds.maxX - bounds.minX) * nx;
  const mapY = bounds.minY + (bounds.maxY - bounds.minY) * ny;
  const centerMapX = (bounds.minX + bounds.maxX) * 0.5;
  const centerMapY = (bounds.minY + bounds.maxY) * 0.5;
  return Object.freeze({
    mapX,
    mapY,
    x: (mapX - centerMapX) * worldScale.METERS_PER_MAP_UNIT,
    z: (mapY - centerMapY) * worldScale.METERS_PER_MAP_UNIT,
  });
}

export function worldToNormalized(x, z, worldScale) {
  const bounds = worldScale.MAP_BOUNDS;
  const centerMapX = (bounds.minX + bounds.maxX) * 0.5;
  const centerMapY = (bounds.minY + bounds.maxY) * 0.5;
  const mapX = x / worldScale.METERS_PER_MAP_UNIT + centerMapX;
  const mapY = z / worldScale.METERS_PER_MAP_UNIT + centerMapY;
  return Object.freeze({
    nx: (mapX - bounds.minX) / (bounds.maxX - bounds.minX),
    ny: (mapY - bounds.minY) / (bounds.maxY - bounds.minY),
    mapX,
    mapY,
  });
}

export function normalizedOffset(nx, ny, radius, angle, aspect = 1) {
  return Object.freeze({
    nx: nx + Math.cos(angle) * radius / aspect,
    ny: ny + Math.sin(angle) * radius,
  });
}

export function aspectCorrectDistance(a, b, aspect = 1) {
  return Math.hypot((a.nx - b.nx) * aspect, a.ny - b.ny);
}

export function nearestCenter(point, centers, aspect = 1) {
  let nearest = null;
  let distance = Infinity;
  for (const center of centers) {
    const candidate = aspectCorrectDistance(point, center, aspect);
    if (candidate < distance) {
      distance = candidate;
      nearest = center;
    }
  }
  return Object.freeze({ center: nearest, distance });
}

export function gradeDegreesFromRiseRun(rise, run) {
  if (run <= 0) return rise === 0 ? 0 : 90;
  return Math.atan(Math.abs(rise) / run) * DEG;
}

export function sampleGradient(sampleHeight, x, z, stepMeters = 10) {
  assert(stepMeters > 0, 'gradient step must be positive');
  const west = sampleHeight(x - stepMeters, z);
  const east = sampleHeight(x + stepMeters, z);
  const north = sampleHeight(x, z - stepMeters);
  const south = sampleHeight(x, z + stepMeters);
  const dx = (east - west) / (2 * stepMeters);
  const dz = (south - north) / (2 * stepMeters);
  const magnitude = Math.hypot(dx, dz);
  return Object.freeze({
    west,
    east,
    north,
    south,
    dx,
    dz,
    magnitude,
    degrees: Math.atan(magnitude) * DEG,
  });
}

export function sampleRadialProfile({
  center,
  radii,
  angle,
  aspect,
  worldScale,
  sampleHeight,
  sampleScale,
}) {
  const samples = [];
  for (const radius of radii) {
    const point = normalizedOffset(center.nx, center.ny, radius, angle, aspect);
    if (point.nx < 0 || point.nx > 1 || point.ny < 0 || point.ny > 1) continue;
    const world = normalizedToWorld(point.nx, point.ny, worldScale);
    const height = sampleHeight(world.x, world.z);
    const scale = sampleScale(point.nx, point.ny);
    samples.push(Object.freeze({ radius, ...point, ...world, height, scale }));
  }
  return Object.freeze(samples);
}

export function profileGrades(profile) {
  const grades = [];
  for (let index = 1; index < profile.length; index += 1) {
    const a = profile[index - 1];
    const b = profile[index];
    const run = Math.hypot(b.x - a.x, b.z - a.z);
    grades.push(gradeDegreesFromRiseRun(b.height - a.height, run));
  }
  return grades;
}

export function fixedLcg(seed = 0x9e3779b9) {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822519) >>> 0;
    state = Math.imul(state ^ (state >>> 13), 3266489917) >>> 0;
    state ^= state >>> 16;
    return (state >>> 0) / 0x100000000;
  };
}

export function checksumNumbers(values, scale = 1000000) {
  let hash = 2166136261 >>> 0;
  for (const value of values) {
    const quantized = Math.round(value * scale) | 0;
    hash ^= quantized;
    hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= hash >>> 13;
  }
  return hash >>> 0;
}

export function timeIt(fn) {
  const started = performance.now();
  const value = fn();
  return Object.freeze({ value, elapsedMs: performance.now() - started });
}

export function ensureDirectory(pathname) {
  mkdirSync(pathname, { recursive: true });
  return pathname;
}

export function writeJsonArtifact(relativePath, value) {
  const target = resolve(QA_ROOT, relativePath);
  ensureDirectory(dirname(target));
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return target;
}

export function runNodeCheck(relativeScript, { timeoutMs = 180000, env = {} } = {}) {
  const scriptPath = resolve(QA_ROOT, relativeScript);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: QA_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  return Object.freeze({
    script: relativeScript,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ? String(result.error) : null,
    ok: result.status === 0 && !result.error,
  });
}

export function requireSuccessfulCheck(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert(result.ok, `${result.script} failed with status=${result.status} signal=${result.signal} error=${result.error}`);
  return result;
}

export function countConnectedComponents(width, height, active) {
  assert.equal(active.length, width * height, 'active grid length mismatch');
  const visited = new Uint8Array(active.length);
  const components = [];
  const stack = [];
  const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (!active[start] || visited[start]) continue;
      visited[start] = 1;
      stack.push(start);
      let size = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      while (stack.length) {
        const index = stack.pop();
        const cx = index % width;
        const cy = Math.floor(index / width);
        size += 1;
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);
        for (const [dx, dy] of neighbours) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (!active[next] || visited[next]) continue;
          visited[next] = 1;
          stack.push(next);
        }
      }
      components.push(Object.freeze({ size, minX, maxX, minY, maxY }));
    }
  }
  return Object.freeze(components.sort((a, b) => b.size - a.size));
}

export function angularCoverage(angles, totalBins = 32) {
  if (!angles.length) return 0;
  const occupied = new Uint8Array(totalBins);
  for (const angle of angles) {
    const normalized = ((angle % TAU) + TAU) % TAU;
    const bin = Math.min(totalBins - 1, Math.floor((normalized / TAU) * totalBins));
    occupied[bin] = 1;
  }
  return sum(occupied) / totalBins;
}

export function assertApprox(actual, expected, epsilon, label) {
  assertFinite(actual, label);
  assertFinite(expected, `${label} expected`);
  assert(Math.abs(actual - expected) <= epsilon,
    `${label} expected ${expected} ± ${epsilon}, received ${actual}`);
}

export function monotonicViolations(values, epsilon = 0) {
  let violations = 0;
  let largestDrop = 0;
  for (let index = 1; index < values.length; index += 1) {
    const drop = values[index - 1] - values[index];
    if (drop > epsilon) {
      violations += 1;
      largestDrop = Math.max(largestDrop, drop);
    }
  }
  return Object.freeze({ violations, largestDrop });
}
