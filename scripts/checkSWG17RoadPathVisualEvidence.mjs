import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WORLD_SCALE } from '../src/3d/config.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import { G17_ROAD_PATH_POLICY } from '../godot/terrain-authoring/geocells/sw/g17_road_path.mjs';

function value(flag) {
  const arg = process.argv.find((candidate) => candidate.startsWith(`${flag}=`));
  if (!arg) throw new Error(`missing ${flag}=...`);
  return arg.slice(flag.length + 1);
}

function digest(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 1000) throw new Error(`visual evidence too small: ${file} (${bytes.length})`);
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`visual evidence is not PNG: ${file}`);
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  return { bytes: bytes.length, width, height, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

const visualDir = value('--visual-dir');
const source = JSON.parse(fs.readFileSync(value('--source'), 'utf8'));
const out = value('--out');
const semantic = path.join(visualDir, 'g17-hydrology-full-world-topdown.png');
const near = path.join(visualDir, 'g17-road-path-runtime-near.png');
const far = path.join(visualDir, 'g17-road-path-runtime-far.png');
const full = path.join(visualDir, 'g17-road-path-full-world-3d-topdown.png');
const metadataPath = path.join(visualDir, 'g17-road-path-full-world-3d-topdown.json');

if (source.sourceMapSha256 !== G17_ROAD_PATH_POLICY.sourceMapSha256 ||
    source.sourceMapVersion !== G17_ROAD_PATH_POLICY.sourceMapVersion ||
    source.sourceMapSize?.[0] !== 1536 || source.sourceMapSize?.[1] !== 1024) {
  throw new Error('Road/Path source evidence lost canonical map provenance');
}
if (source.coverage?.activeSamples !== 0 || source.routeEvidence?.roadGuardCrossingSegments !== 0 ||
    source.routeEvidence?.pathGuardCrossingSegments !== 0) throw new Error('Road/Path negative source proof is not empty');

const { mapCanvasWidthUnits: mapW, mapCanvasHeightUnits: mapH } = WORLD_REFERENCE_ALIGNMENT;
const m = WORLD_SCALE.MAP_BOUNDS;
const runtimeBounds = { xMin: m.minX / mapW, xMax: m.maxX / mapW, yMin: m.minY / mapH, yMax: m.maxY / mapH };
const g = G17_ROAD_PATH_POLICY.normalizedBounds;
const runtimeCovered = runtimeBounds.xMin <= g.xMin && runtimeBounds.xMax >= g.xMax &&
  runtimeBounds.yMin <= g.yMin && runtimeBounds.yMax >= g.yMax;
const overlapX = Math.max(0, Math.min(runtimeBounds.xMax, g.xMax) - Math.max(runtimeBounds.xMin, g.xMin));
const overlapY = Math.max(0, Math.min(runtimeBounds.yMax, g.yMax) - Math.max(runtimeBounds.yMin, g.yMin));
const runtimeCoverageFraction = overlapX * overlapY / ((g.xMax - g.xMin) * (g.yMax - g.yMin));
fs.writeFileSync(path.join(visualDir, 'g17-road-path-runtime-coverage.json'), `${JSON.stringify({ runtimeBounds, g17Bounds: g, runtimeCoverageFraction }, null, 2)}\n`);
if (!runtimeCovered) {
  throw new Error(`G17 live createScene coverage ${(runtimeCoverageFraction * 100).toFixed(6)}%; runtime=${JSON.stringify(runtimeBounds)} G17=${JSON.stringify(g)}`);
}

for (const file of [semantic, near, far, full, metadataPath]) {
  if (!fs.existsSync(file)) throw new Error(`missing strict visual evidence ${file}`);
}
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
if (metadata.cameraType !== 'OrthographicCamera' || metadata.topDownDegrees !== 90) throw new Error('full-world runtime proof must be 90 degree OrthographicCamera');
if (metadata.visibleGeoCellOverlay !== false || metadata.runtimeTerrain !== true || metadata.runtimeWater !== true ||
    metadata.productionPBR !== true || metadata.runtimeVegetation !== true) throw new Error('full-world runtime composition contract failed');
if (metadata.sourceMapSha256 !== source.sourceMapSha256 || !metadata.runtimeChecksum || !metadata.renderChecksum) throw new Error('runtime/source/render checksum provenance missing');
if (!Array.isArray(metadata.consoleErrors) || metadata.consoleErrors.length !== 0) throw new Error('runtime visual proof has console errors');
if (!metadata.worldBounds || Object.values(metadata.worldBounds).some((v) => !Number.isFinite(v))) throw new Error('runtime world bounds metadata missing');

const images = { near: digest(near), far: digest(far), fullWorld3DTopDown: digest(full), semanticReference: digest(semantic) };
if (images.fullWorld3DTopDown.width !== 1536 || images.fullWorld3DTopDown.height !== 1024) throw new Error('runtime full-world proof must be 1536x1024');
if (new Set([images.near.sha256, images.far.sha256, images.fullWorld3DTopDown.sha256]).size !== 3) throw new Error('near/far/full runtime evidence must be distinct');

const manifest = {
  schema: 'westeros-g17-road-path-visual-evidence-v3',
  sourceMapSha256: source.sourceMapSha256, sourceMapVersion: source.sourceMapVersion, sourceMapSize: source.sourceMapSize,
  geoCell: 'G17', layer: 'Road/Path', runtimeCovered, runtimeBounds, visibleGeoCellOverlay: false,
  roadGuardCrossings: source.routeEvidence.roadGuardCrossingSegments, pathGuardCrossings: source.routeEvidence.pathGuardCrossingSegments,
  images, runtimeMetadata: metadata,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`SW_G17_ROAD_PATH_VISUAL_EVIDENCE=${JSON.stringify({ runtimeCovered, fullWorld3DTopDownSha256: images.fullWorld3DTopDown.sha256 })}`);
console.log('SW_G17_ROAD_PATH_VISUAL_EVIDENCE_OK');
