#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  NATURAL_GEOLOGY_PLACEMENT_POLICY,
  generateNaturalGeologyPlacements,
  sampleTerrainFrame,
} from '../src/3d/world/naturalGeologyPlacement.js';
import { WORLD_SCALE } from '../src/3d/config.js';

const P = NATURAL_GEOLOGY_PLACEMENT_POLICY;
const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
const wrapAngle = (value) => {
  let angle = value % TAU;
  if (angle > Math.PI) angle -= TAU;
  if (angle < -Math.PI) angle += TAU;
  return angle;
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

assert.equal(P.renderOnly, true);
assert.equal(P.geographyAuthorityUnchanged, true);
assert.equal(P.heightAuthority, 'world/terrain.js');
assert(P.maxTiltDegrees >= 18 && P.maxTiltDegrees <= 28);
assert(P.assetProxyFraction > 0 && P.assetProxyFraction < 0.25);
assert(P.valyriaAssetProxyFraction > P.assetProxyFraction);

const seaLevelMeters = 6;
const sampleHeightMeters = (x, z) => {
  const broad = Math.sin(x / 720) * 48 + Math.cos(z / 610) * 37;
  const ridge = Math.sin((x * 0.73 + z * 0.41) / 190) * 19;
  const shoulder = Math.cos((x - z * 0.62) / 330) * 13;
  return 138 + broad + ridge + shoulder;
};

const generated = generateNaturalGeologyPlacements({
  sampleHeightMeters,
  seaLevelMeters,
  seed: 1337,
  seats: [],
  roadEdges: [],
  worldWidthMeters: WORLD_SCALE.WORLD_WIDTH_METERS,
  worldDepthMeters: WORLD_SCALE.WORLD_DEPTH_METERS,
  isMobileClass: false,
  maxPlacements: P.desktopMaxPlacements,
});

const proxies = generated.placements.filter((placement) => placement.kind === 'asset-proxy');
assert(proxies.length >= 8, `too few hydrated-asset proxy opportunities: ${proxies.length}`);

const buryFractions = [];
const tiltErrors = [];
const tiltFractions = [];
const yawBuckets = new Set();
const tiltAxisBuckets = new Set();
const scaleAspectBuckets = new Set();
let slopedProxyCount = 0;
let volcanicProxyCount = 0;

for (const placement of proxies) {
  const frame = sampleTerrainFrame(sampleHeightMeters, placement.x, placement.z, P.normalProbeMeters);
  const buryDepth = frame.y - placement.y;
  const buryFraction = buryDepth / Math.max(1e-9, placement.scale.y);
  buryFractions.push(buryFraction);
  assert(buryDepth > 0, `asset proxy ${placement.id} sits on/above the terrain instead of being rooted into it`);
  assert(buryFraction >= 0.119 && buryFraction <= 0.221,
    `asset proxy ${placement.id} bury ratio left the natural 12–22% envelope: ${buryFraction}`);

  const expectedTilt = Math.min(P.maxTiltDegrees / DEG, frame.slopeRadians * 0.52);
  const tiltError = Math.abs(placement.tiltRadians - expectedTilt);
  tiltErrors.push(tiltError);
  assert(tiltError <= 1e-12, `asset proxy ${placement.id} tilt no longer follows terrain slope: ${tiltError}`);
  assert(placement.tiltRadians <= P.maxTiltDegrees / DEG + 1e-12,
    `asset proxy ${placement.id} exceeded bounded terrain tilt`);
  if (frame.slopeDegrees >= P.minRockSlopeDegrees) {
    slopedProxyCount += 1;
    tiltFractions.push(placement.tiltRadians / Math.max(1e-9, frame.slopeRadians));
    assert(placement.tiltRadians > 0.02, `sloped asset proxy ${placement.id} reverted to an upright prop`);
  }

  const expectedAxis = frame.downhillAngleRadians + Math.PI * 0.5;
  const axisError = Math.abs(wrapAngle(placement.tiltAxisRadians - expectedAxis));
  assert(axisError <= 0.181, `asset proxy ${placement.id} tilt axis drifted away from the terrain cross-slope: ${axisError}`);

  const normalLength = Math.hypot(placement.normal.x, placement.normal.y, placement.normal.z);
  assert(Math.abs(normalLength - 1) < 1e-9, `asset proxy ${placement.id} stored a non-unit terrain normal`);
  assert(Math.abs(placement.normal.y - frame.ny) < 1e-12, `asset proxy ${placement.id} normal no longer matches canonical height sampler`);

  yawBuckets.add(Math.floor((((placement.yawRadians % TAU) + TAU) % TAU) / TAU * 16));
  tiltAxisBuckets.add(Math.floor((((placement.tiltAxisRadians % TAU) + TAU) % TAU) / TAU * 12));
  scaleAspectBuckets.add(Math.round((placement.scale.x / Math.max(1e-9, placement.scale.z)) * 4));
  if (placement.volcanic) volcanicProxyCount += 1;
}

assert(slopedProxyCount >= Math.max(3, Math.floor(proxies.length * 0.35)),
  `asset fixture lacks enough slope-conforming proxies: ${slopedProxyCount}/${proxies.length}`);
assert(yawBuckets.size >= Math.min(7, proxies.length), `asset yaw diversity collapsed: ${yawBuckets.size} buckets`);
assert(tiltAxisBuckets.size >= Math.min(5, proxies.length), `asset tilt-axis diversity collapsed: ${tiltAxisBuckets.size} buckets`);
assert(scaleAspectBuckets.size >= Math.min(4, proxies.length), `asset silhouette scale diversity collapsed: ${scaleAspectBuckets.size} buckets`);
assert(Math.max(...buryFractions) - Math.min(...buryFractions) >= 0.045,
  'asset bury depth became a visibly repeated constant');
assert(Math.max(...tiltErrors) <= 1e-12);
if (tiltFractions.length) assert(Math.abs(mean(tiltFractions) - 0.52) < 1e-10, 'terrain-conforming tilt ratio drifted');
assert(volcanicProxyCount >= 1, 'Valyria no longer receives any real-asset hydration opportunities');

console.log('[checkNaturalGeologyAssetGrounding] PASS');
console.log(JSON.stringify({
  policyId: P.id,
  totalPlacements: generated.placements.length,
  assetProxyCount: proxies.length,
  volcanicProxyCount,
  slopedProxyCount,
  meanBuryFraction: Number(mean(buryFractions).toFixed(4)),
  buryFractionRange: [Number(Math.min(...buryFractions).toFixed(4)), Number(Math.max(...buryFractions).toFixed(4))],
  meanSlopeTiltRatio: Number(mean(tiltFractions).toFixed(4)),
  yawBuckets: yawBuckets.size,
  tiltAxisBuckets: tiltAxisBuckets.size,
  scaleAspectBuckets: scaleAspectBuckets.size,
}, null, 2));
