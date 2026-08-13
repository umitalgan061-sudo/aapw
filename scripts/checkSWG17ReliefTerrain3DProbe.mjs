import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildG17ReliefProbe, measureG17Relief, G17_RELIEF_POLICY } from '../godot/terrain-authoring/geocells/sw/g17_relief.mjs';

const SOURCE_GRID = 65;
const IMPORT_GRID = 257;
const REGION_SIZE = 256;
const EXPECTED_MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const EXPECTED_POLICY = 'gunbatimi-ustasi-g17-terrain3d-relief-2026-08-13-v1';

function fail(message) { throw new Error(`SW G17 Terrain3D relief probe: ${message}`); }
function need(condition, message) { if (!condition) fail(message); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function round(value, digits = 8) { return Number(value.toFixed(digits)); }
function quantile(sorted, q) {
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at), hi = Math.ceil(at), t = at - lo;
  return lo === hi ? sorted[lo] : sorted[lo] * (1 - t) + sorted[hi] * t;
}

function summarizeRows(rows) {
  need(Array.isArray(rows) && rows.length === SOURCE_GRID, `expected ${SOURCE_GRID} rows`);
  const values = [];
  let maxAdjacentX = 0, maxAdjacentZ = 0, sum = 0, sumSquares = 0;
  for (let z = 0; z < SOURCE_GRID; z += 1) {
    need(Array.isArray(rows[z]) && rows[z].length === SOURCE_GRID, `row ${z} width changed`);
    for (let x = 0; x < SOURCE_GRID; x += 1) {
      const value = rows[z][x];
      need(Number.isFinite(value), `rows[${z}][${x}] is not finite`);
      values.push(value); sum += value; sumSquares += value * value;
      if (x) maxAdjacentX = Math.max(maxAdjacentX, Math.abs(value - rows[z][x - 1]));
      if (z) maxAdjacentZ = Math.max(maxAdjacentZ, Math.abs(value - rows[z - 1][x]));
    }
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sum / values.length;
  return {
    samples: values.length,
    min: sorted[0], p10: quantile(sorted, 0.1), median: quantile(sorted, 0.5), p90: quantile(sorted, 0.9), max: sorted.at(-1),
    mean, standardDeviation: Math.sqrt(Math.max(0, sumSquares / values.length - mean * mean)),
    maxAdjacentX, maxAdjacentZ,
    rowChecksum: sha256(JSON.stringify(rows)),
  };
}

function validatePolicy() {
  need(G17_RELIEF_POLICY.id === EXPECTED_POLICY, 'policy id changed');
  need(G17_RELIEF_POLICY.sourceMapSha256 === EXPECTED_MAP_SHA, 'map.png SHA changed');
  need(G17_RELIEF_POLICY.geoCell === 'G17' && G17_RELIEF_POLICY.layer === 'Relief/Height Character', 'ownership changed');
  need(G17_RELIEF_POLICY.terrain3dRegionSize === REGION_SIZE, 'region size changed');
  need(G17_RELIEF_POLICY.terrain3dImportSize === IMPORT_GRID, 'import size changed');
  need(G17_RELIEF_POLICY.waterCeilingMeters === -2.5, 'water ceiling changed');
}

function validateMeasured(m) {
  need(m.policyId === EXPECTED_POLICY, 'measurement policy mismatch');
  need(m.canonicalWater === 96 && m.canonicalLand === 0, 'G17 hydrology regression');
  need(m.samples === SOURCE_GRID * SOURCE_GRID, 'measurement sample count changed');
  need(m.maxHeight < G17_RELIEF_POLICY.waterCeilingMeters, 'marine ceiling regression');
  need(m.heightSpan > 0.45 && m.heightSpan < 5.5, 'relief span regression');
  need(m.maxAdjacentHeightDelta <= 0.12, 'adjacent height continuity regression');
  need(m.maxGuardBandHeightDelta <= 0.40, 'guard-band height continuity regression');
  need(m.maxGuardBandNormalDelta <= 0.012, 'guard-band normal continuity regression');
  need(Number.isInteger(m.heightChecksum), 'height checksum missing');
}

validatePolicy();
const measured = measureG17Relief();
validateMeasured(measured);
const probe = buildG17ReliefProbe(SOURCE_GRID);
const summary = summarizeRows(probe.rows);

need(probe.policyId === EXPECTED_POLICY && probe.sourceMapSha256 === EXPECTED_MAP_SHA, 'probe provenance mismatch');
need(probe.sourceGridSize === SOURCE_GRID && probe.terrain3dImportSize === IMPORT_GRID && probe.terrain3dRegionSize === REGION_SIZE, 'probe dimensions changed');
need(summary.samples === measured.samples, 'probe sample count mismatch');
need(summary.max < G17_RELIEF_POLICY.waterCeilingMeters, 'probe contains non-marine height');
need(summary.max - summary.min > 0.45, 'probe became too flat');
need(summary.maxAdjacentX <= 0.12 && summary.maxAdjacentZ <= 0.12, 'probe adjacency regression');
need(summary.standardDeviation > 0.08 && summary.p90 > summary.p10, 'probe distribution collapsed');

const payload = {
  ...probe,
  worldWidthMeters: G17_RELIEF_POLICY.referenceWorldMeters.x,
  worldDepthMeters: G17_RELIEF_POLICY.referenceWorldMeters.z,
  canonicalWaterCells: measured.canonicalWater,
  canonicalLandCells: measured.canonicalLand,
  minHeight: measured.minHeight,
  maxHeight: measured.maxHeight,
  heightSpan: measured.heightSpan,
  maxAdjacentHeightDelta: measured.maxAdjacentHeightDelta,
  maxGuardBandHeightDelta: measured.maxGuardBandHeightDelta,
  maxGuardBandNormalDelta: measured.maxGuardBandNormalDelta,
  heightChecksum: measured.heightChecksum,
  distribution: {
    samples: summary.samples,
    min: round(summary.min), p10: round(summary.p10), median: round(summary.median), p90: round(summary.p90), max: round(summary.max),
    mean: round(summary.mean), standardDeviation: round(summary.standardDeviation),
    maxAdjacentX: round(summary.maxAdjacentX), maxAdjacentZ: round(summary.maxAdjacentZ), rowChecksum: summary.rowChecksum,
  },
  proofContract: {
    importFormat: 'Image.FORMAT_RF', importGrid: IMPORT_GRID, regionSize: REGION_SIZE, minimumRegions: 4,
    alignedSourceStride: 4, regionBoundaryMeters: 256, seamBandMeters: [254, 254.5, 255, 255.5, 256],
    requireLod0Bake: true, requirePersistence: true, requireDoubleRunDeterminism: true, requirePreviewByteIdentity: true,
    maxAlignedHeightErrorMeters: 0.012, maxSeamHeightErrorMeters: 0.02, maxSeamDerivativeError: 0.002,
  },
};

const out = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6);
need(Boolean(out), '--out=path is required');
const encoded = `${JSON.stringify(payload, null, 2)}\n`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encoded);
console.log(`SW_G17_RELIEF_PROBE_SHA256=${sha256(encoded)}`);
console.log(`SW_G17_RELIEF_PROBE_METRICS=${JSON.stringify({ minHeight: payload.minHeight, maxHeight: payload.maxHeight, heightSpan: payload.heightSpan, maxAdjacentHeightDelta: payload.maxAdjacentHeightDelta, maxGuardBandHeightDelta: payload.maxGuardBandHeightDelta, maxGuardBandNormalDelta: payload.maxGuardBandNormalDelta, rowChecksum: payload.distribution.rowChecksum })}`);
console.log('SW_G17_RELIEF_PROBE_OK');
