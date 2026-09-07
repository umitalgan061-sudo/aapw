import { readFile, stat } from 'node:fs/promises';

const sourcePath = 'src/3d/world/settlements.js';
const source = await readFile(sourcePath, 'utf8');

const requiredMarkers = [
  "export const CASTLE_MODEL_ASSIGNMENTS",
  "spawnRealCastleModels",
  "assets/models/settlements/castles/",
  "prepareImportedGeometryForTexturing",
  "Object3D.clone()",
];
for (const marker of requiredMarkers) {
  if (!source.includes(marker)) throw new Error(`SETTLEMENT_ASSET_CONTRACT_FAIL missing marker: ${marker}`);
}
if (source.includes('EditorMaterialStudio.js')) throw new Error('SETTLEMENT_ASSET_CONTRACT_FAIL editor runtime import');

const assignmentBlock = source.match(/export const CASTLE_MODEL_ASSIGNMENTS[\s\S]*?\n\]\);/u)?.[0] || '';
const objectBlocks = [...assignmentBlock.matchAll(/Object\.freeze\(\{([\s\S]*?)\}\)/gu)].map(([, body]) => body);
const entries = objectBlocks.map((body) => ({
  seatId: body.match(/\bseatId:\s*'([^']+)'/u)?.[1],
  assetId: body.match(/\bassetId:\s*'([^']+)'/u)?.[1],
  file: body.match(/\bfile:\s*'([^']+)'/u)?.[1],
  stoneColorHex: body.match(/\bstoneColorHex:\s*([^,}]+)/u)?.[1]?.trim(),
  yawRadians: body.match(/\byawRadians:\s*([0-9.]+)/u)?.[1],
  footprintMeters: body.match(/\bfootprintMeters:\s*([0-9.]+)/u)?.[1],
}));
if (entries.some((entry) => !entry.seatId || !entry.assetId || !entry.file || !entry.stoneColorHex)) {
  throw new Error('SETTLEMENT_ASSET_CONTRACT_FAIL malformed castle assignment entry');
}
if (entries.length < 14) throw new Error(`SETTLEMENT_ASSET_CONTRACT_FAIL expected >=14 assignments, got ${entries.length}`);
const seatIds = new Set(entries.map((entry) => entry.seatId));
if (seatIds.size !== entries.length) throw new Error('SETTLEMENT_ASSET_CONTRACT_FAIL duplicate seat assignment');
for (const entry of entries) {
  if (!entry.file.startsWith('assets/models/settlements/')) throw new Error(`SETTLEMENT_ASSET_CONTRACT_FAIL non-settlement asset: ${entry.file}`);
  if (!entry.assetId.startsWith('castle_')) throw new Error(`SETTLEMENT_ASSET_CONTRACT_FAIL non-castle asset id: ${entry.assetId}`);
}

const duplicateFileGroups = new Map();
for (const entry of entries) {
  const group = duplicateFileGroups.get(entry.file) || [];
  group.push(entry);
  duplicateFileGroups.set(entry.file, group);
}
for (const [file, group] of duplicateFileGroups) {
  if (group.length < 2) continue;
  if (group.some((entry) => !entry.yawRadians || !entry.footprintMeters)) {
    throw new Error(`SETTLEMENT_ASSET_CONTRACT_FAIL duplicate asset lacks per-seat yaw/footprint metadata: ${file}`);
  }
  const transforms = group.map((entry) => entry.yawRadians);
  if (new Set(transforms).size !== transforms.length) {
    throw new Error(`SETTLEMENT_ASSET_CONTRACT_FAIL duplicate asset yaw collision: ${file}`);
  }
}

const sharedCore = await readFile('src/3d/materials/MaterialAssignmentCore.js', 'utf8');
const placementCore = await readFile('src/3d/world/WorldAssetPlacementPipeline.js', 'utf8');
for (const [name, content, marker] of [
  ['material core', sharedCore, 'validateMaterialAssignment'],
  ['placement core', placementCore, 'prepareWorldAssetForPlacement'],
]) {
  if (!content.includes(marker)) throw new Error(`SETTLEMENT_ASSET_CONTRACT_FAIL missing shared ${name}`);
}

const assetFamilies = [...new Set(entries.map((entry) => entry.file))];
const missing = [];
for (const file of assetFamilies) {
  try {
    const metadata = await stat(file);
    if (!metadata.isFile()) missing.push(file);
  } catch {
    missing.push(file);
  }
}
if (missing.length) {
  throw new Error(`SETTLEMENT_ASSET_CONTRACT_FAIL missing hydrated settlement assets: ${missing.join(', ')}`);
}

console.log(JSON.stringify({
  ok: true,
  assignments: entries.length,
  uniqueSeats: seatIds.size,
  uniqueAssetFiles: assetFamilies.length,
  duplicateAssetGroups: [...duplicateFileGroups.values()].filter((group) => group.length > 1).length,
  missingAssets: 0,
  sharedMaterialCore: true,
  sharedPlacementCore: true,
  editorRuntimeImport: false,
}, null, 2));
