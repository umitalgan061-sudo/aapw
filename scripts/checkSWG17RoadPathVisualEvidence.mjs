import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function value(flag) {
  const arg = process.argv.find((candidate) => candidate.startsWith(`${flag}=`));
  if (!arg) throw new Error(`missing ${flag}=...`);
  return arg.slice(flag.length + 1);
}

function digest(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 1000) throw new Error(`visual evidence too small: ${file} (${bytes.length})`);
  return { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

const visualDir = value('--visual-dir');
const sourcePath = value('--source');
const out = value('--out');
const metricsPath = path.join(visualDir, 'g17-hydrology-visual-metrics.json');
const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

const near = path.join(visualDir, 'g17-hydrology-near.png');
const far = path.join(visualDir, 'g17-hydrology-far.png');
const full = path.join(visualDir, 'g17-hydrology-full-world-topdown.png');
for (const file of [near, far, full]) {
  if (!fs.existsSync(file)) throw new Error(`missing visual evidence ${file}`);
}

const serialized = JSON.stringify(metrics);
if (!serialized.includes('20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1')) {
  throw new Error('visual metrics lost canonical map SHA');
}
if (serialized.includes('"visibleGeoCellOverlay":true')) {
  throw new Error('full-world visual evidence exposes a GeoCell overlay');
}
if (source.coverage?.activeSamples !== 0 || source.routeEvidence?.roadGuardCrossingSegments !== 0 || source.routeEvidence?.pathGuardCrossingSegments !== 0) {
  throw new Error('Road/Path negative visual proof source is not empty');
}

const manifest = {
  schema: 'westeros-g17-road-path-visual-evidence-v2',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  layer: 'Road/Path',
  geoCell: 'G17',
  negativePhysicalProof: true,
  inheritedGeographyUnchanged: true,
  visibleGeoCellOverlay: false,
  roadGuardCrossings: source.routeEvidence.roadGuardCrossingSegments,
  pathGuardCrossings: source.routeEvidence.pathGuardCrossingSegments,
  minRoadGuardClearance: source.routeEvidence.minRoadGuardClearance,
  minPathGuardClearance: source.routeEvidence.minPathGuardClearance,
  images: { near: digest(near), far: digest(far), fullWorldTopDown: digest(full) },
  hydrologyVisualMetrics: metrics,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`SW_G17_ROAD_PATH_VISUAL_EVIDENCE=${JSON.stringify({
  visibleGeoCellOverlay: false,
  roadGuardCrossings: manifest.roadGuardCrossings,
  pathGuardCrossings: manifest.pathGuardCrossings,
  fullWorldTopDownSha256: manifest.images.fullWorldTopDown.sha256,
})}`);
console.log('SW_G17_ROAD_PATH_VISUAL_EVIDENCE_OK');
