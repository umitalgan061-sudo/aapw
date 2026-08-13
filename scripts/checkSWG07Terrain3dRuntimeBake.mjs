import fs from 'node:fs';
import path from 'node:path';
import {
  G07_RUNTIME_BAKE_POLICY,
  buildG07RuntimeBakeSource,
  measureG07RuntimeBakeSource,
} from '../godot/terrain-authoring/geocells/sw/g07_runtime_bake_source.mjs';

function parseArg(prefix) {
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function fail(message) {
  throw new Error(message);
}

function verifyMetrics(metrics) {
  if (metrics.canonicalLandSamples !== 0) fail(`G07 must remain canonical open sea; land=${metrics.canonicalLandSamples}`);
  if (metrics.canonicalWaterSamples !== G07_RUNTIME_BAKE_POLICY.sourceGridSize ** 2) {
    fail(`unexpected canonical water count ${metrics.canonicalWaterSamples}`);
  }
  if (!(metrics.maxHeight < G07_RUNTIME_BAKE_POLICY.waterCeilingMeters)) {
    fail(`G07 seabed crossed water ceiling: ${metrics.maxHeight}`);
  }
  if (!(metrics.maxHeight > metrics.minHeight)) fail('G07 seabed has no relief variation');
  if (!(metrics.maxRockBlend > metrics.minRockBlend)) fail('G07 submerged-rock field has no variation');
  if (!(metrics.maxRoughness > metrics.minRoughness)) fail('G07 near-detail roughness has no variation');
  if (metrics.maxSnowBlend !== 0) fail(`snow leaked into G07: ${metrics.maxSnowBlend}`);
  if (metrics.maxRoadBlend !== 0) fail(`road leaked into G07: ${metrics.maxRoadBlend}`);
  if (metrics.maxPathBlend !== 0) fail(`path leaked into G07: ${metrics.maxPathBlend}`);
  if (metrics.maxAdjacentHeightDelta > 0.08) fail(`adjacent height step too large: ${metrics.maxAdjacentHeightDelta}`);
  if (metrics.maxAdjacentRockDelta > 0.03) fail(`adjacent rock step too large: ${metrics.maxAdjacentRockDelta}`);
  if (metrics.maxAdjacentColorDelta > 0.01) fail(`adjacent color step too large: ${metrics.maxAdjacentColorDelta}`);
  if (metrics.maxAdjacentRoughnessDelta > 0.01) fail(`adjacent roughness step too large: ${metrics.maxAdjacentRoughnessDelta}`);
  if (metrics.maxGuardHeightDelta > 0.15) fail(`guard height seam too large: ${metrics.maxGuardHeightDelta}`);
  if (metrics.maxGuardNormalDelta > 0.005) fail(`guard normal seam too large: ${metrics.maxGuardNormalDelta}`);
  if (metrics.maxGuardRockDelta > 0.03) fail(`guard rock seam too large: ${metrics.maxGuardRockDelta}`);
  if (metrics.maxGuardColorDelta > 0.01) fail(`guard color seam too large: ${metrics.maxGuardColorDelta}`);
  if (metrics.maxGuardRoughnessDelta > 0.01) fail(`guard roughness seam too large: ${metrics.maxGuardRoughnessDelta}`);
}

function verifyBake(bakePath, source) {
  const bake = JSON.parse(fs.readFileSync(bakePath, 'utf8'));
  if (bake.schema !== 'westeros-g07-terrain3d-bake-v2') fail(`unexpected bake schema ${bake.schema}`);
  if (bake.sourceSchema !== source.schema) fail(`bake source schema drifted: ${bake.sourceSchema}`);
  if (bake.policyId !== source.policyId) fail(`bake policy drifted: ${bake.policyId}`);
  if (bake.sourceMapSha256 !== source.sourceMapSha256) fail('bake map.png SHA drifted');
  if (bake.width !== source.sourceGridSize || bake.height !== source.sourceGridSize) fail('bake dimensions drifted');
  if (bake.importWidth !== 257 || bake.importHeight !== 257 || bake.sourceVertexStride !== 4) {
    fail('bake lost 257x257 guard-backed import provenance');
  }
  if (bake.regionCount < 4 || bake.savedRegionFiles < 4 || bake.regionPersistenceNonEmpty !== true) {
    fail('bake lacks four persisted guard-backed Terrain3D regions');
  }
  if (!(bake.bakedSurfaces >= 1) || !(bake.bakedVertices > 0)) fail('bake_mesh(0) provenance is empty');
  if (bake.maxHeightError > 0.01 || bake.meanHeightError > 0.0025 || bake.maxFractionalHeightError > 0.01) {
    fail(`Terrain3D height parity exceeded tolerance: max=${bake.maxHeightError} mean=${bake.meanHeightError} frac=${bake.maxFractionalHeightError}`);
  }
  if (bake.maxRockBlendError > 0.006 || bake.maxColorError > 0.006 || bake.maxRoughnessError > 0.006) {
    fail(`Terrain3D surface parity exceeded tolerance: rock=${bake.maxRockBlendError} color=${bake.maxColorError} rough=${bake.maxRoughnessError}`);
  }
  const count = source.sourceGridSize ** 2;
  if (!Array.isArray(bake.heights) || bake.heights.length !== count) fail('bake height payload size mismatch');
  if (!Array.isArray(bake.rockBlend) || bake.rockBlend.length !== count) fail('bake rock payload size mismatch');
  if (!Array.isArray(bake.colorRoughness) || bake.colorRoughness.length !== count) fail('bake color/roughness payload size mismatch');

  let maxHeightError = 0;
  let maxRockError = 0;
  let maxColorError = 0;
  let maxRoughnessError = 0;
  let index = 0;
  for (const row of source.rows) {
    for (const sample of row) {
      maxHeightError = Math.max(maxHeightError, Math.abs(Number(bake.heights[index]) - sample[0]));
      maxRockError = Math.max(maxRockError, Math.abs(Number(bake.rockBlend[index]) - sample[1]));
      const actualColor = bake.colorRoughness[index];
      if (!Array.isArray(actualColor) || actualColor.length !== 4) fail(`invalid color/roughness bake sample ${index}`);
      maxColorError = Math.max(
        maxColorError,
        Math.abs(Number(actualColor[0]) - sample[5]),
        Math.abs(Number(actualColor[1]) - sample[6]),
        Math.abs(Number(actualColor[2]) - sample[7]),
      );
      maxRoughnessError = Math.max(maxRoughnessError, Math.abs(Number(actualColor[3]) - sample[8]));
      index += 1;
    }
  }
  if (maxHeightError > 0.01 || maxRockError > 0.006 || maxColorError > 0.006 || maxRoughnessError > 0.006) {
    fail(`bake/source payload mismatch: height=${maxHeightError} rock=${maxRockError} color=${maxColorError} rough=${maxRoughnessError}`);
  }
  return { maxHeightError, maxRockError, maxColorError, maxRoughnessError };
}

const metrics = measureG07RuntimeBakeSource();
verifyMetrics(metrics);
const source = buildG07RuntimeBakeSource();
const emitSource = parseArg('--emit-source=');
if (emitSource) {
  fs.mkdirSync(path.dirname(emitSource), { recursive: true });
  fs.writeFileSync(emitSource, `${JSON.stringify(source)}\n`);
}
const verifyBakePath = parseArg('--verify-bake=');
const bakeMetrics = verifyBakePath ? verifyBake(verifyBakePath, source) : null;
console.log(`G07_RUNTIME_BAKE_SOURCE_METRICS=${JSON.stringify(metrics)}`);
if (bakeMetrics) console.log(`G07_RUNTIME_BAKE_PARITY_METRICS=${JSON.stringify(bakeMetrics)}`);
console.log('SW_G07_RUNTIME_BAKE_SOURCE_OK');
