#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VILLAGES_PATH = path.join(ROOT, 'src/3d/world/villages.js');
const PALETTES_PATH = path.join(ROOT, 'src/3d/materials/palettes.js');
const CLASSIFIER_PATH = path.join(ROOT, 'src/3d/materials/meshPartClassifier.js');
const SERVICE_WORKER_PATH = path.join(ROOT, 'service-worker.js');

const villages = fs.readFileSync(VILLAGES_PATH, 'utf8');
const palettes = fs.readFileSync(PALETTES_PATH, 'utf8');
const classifier = fs.readFileSync(CLASSIFIER_PATH, 'utf8');
const serviceWorker = fs.readFileSync(SERVICE_WORKER_PATH, 'utf8');

function extractProfileBlock(region) {
	const marker = `${region}: architectureProfile({`;
	const start = villages.indexOf(marker);
	assert(start >= 0, `missing ${region} architecture profile`);
	const close = villages.indexOf('}),', start + marker.length);
	assert(close > start, `cannot parse ${region} architecture profile`);
	return villages.slice(start, close + 3);
}

function extractHex(block, key) {
	const match = block.match(new RegExp(`${key}:\\s*(0x[0-9a-fA-F]+)`));
	assert(match, `${key} missing from profile`);
	return Number(match[1]);
}

function extractString(block, key) {
	const match = block.match(new RegExp(`${key}:\\s*'([^']+)'`));
	assert(match, `${key} missing from profile`);
	return match[1];
}

function extractLayers(block) {
	return [...block.matchAll(/\{\s*to:\s*([0-9.]+),\s*palette:\s*'([^']+)'\s*\}/g)]
		.map((match) => ({ to: Number(match[1]), palette: match[2] }));
}

function colorDistance(a, b) {
	const ar = (a >> 16) & 255;
	const ag = (a >> 8) & 255;
	const ab = a & 255;
	const br = (b >> 16) & 255;
	const bg = (b >> 8) & 255;
	const bb = b & 255;
	return Math.hypot(ar - br, ag - bg, ab - bb);
}

const regions = ['north', 'fertile', 'maritime', 'arid', 'mountain', 'temperate', 'volcanic'];
const profiles = Object.fromEntries(regions.map((region) => {
	const block = extractProfileBlock(region);
	return [region, {
		region,
		assetUrl: extractString(block, 'assetUrl'),
		secondaryAssetUrl: extractString(block, 'secondaryAssetUrl'),
		wallHex: extractHex(block, 'proceduralWallHex'),
		roofHex: extractHex(block, 'proceduralRoofHex'),
		layers: extractLayers(block),
	}];
}));

assert.equal(villages.split(/\r?\n/).length <= 600, true, 'villages.js must remain under the repository smoke cap');
assert(villages.includes("from '../materials/MaterialAssignmentCore.js'"), 'village runtime must use shared material core');
assert(villages.includes("from './WorldAssetPlacementPipeline.js'"), 'village runtime must use shared placement pipeline');
assert(villages.includes('analyzeMaterialSurfaces(object)'), 'material assignment must inspect authored material surfaces');
assert(villages.includes('placeWorldAsset(assetGroup, object'), 'real settlement models must pass through shared world placement');
assert(villages.includes("placementPolicy: WORLD_SURFACE_POLICY_PRESETS.settlement"), 'settlement placement policy must stay authoritative');
assert(villages.includes("footprintGrounding: 'always'"), 'real houses must retain footprint grounding');
assert(villages.includes('requireSurfaceContext: true'), 'placement must fail closed without surface context');
assert(villages.includes('source?.userData?.isPlaceholder === true'), 'LFS/missing model placeholders must never replace procedural houses');
assert(villages.includes('hidePrimitiveLandmark(villageGroup, site)'), 'primitive fallback must hide only after successful attach');
assert(villages.indexOf('hidePrimitiveLandmark(villageGroup, site)') > villages.indexOf('if (!prepared.ok)'), 'fallback must remain visible until placement succeeds');

const assetUrls = [...new Set(regions.flatMap((region) => [profiles[region].assetUrl, profiles[region].secondaryAssetUrl]))].sort();
assert.equal(assetUrls.length, 7, `expected exactly seven bounded residential GLB families, got ${assetUrls.length}`);
for (const assetUrl of assetUrls) {
	assert(assetUrl.startsWith('assets/models/settlements/'), `${assetUrl}: village architecture must stay inside settlement asset family`);
	assert(assetUrl.endsWith('.glb'), `${assetUrl}: runtime architecture asset must be GLB`);
	assert(serviceWorker.includes(`./${assetUrl}`), `${assetUrl}: offline PWA shell does not cache live village asset`);
}

for (const region of regions) {
	const profile = profiles[region];
	assert.notEqual(profile.assetUrl, profile.secondaryAssetUrl, `${region}: primary/secondary silhouette must differ`);
	assert(profile.layers.length >= 3, `${region}: layered fallback must contain at least foundation/body/roof surfaces`);
	assert.equal(profile.layers.at(-1).to, 1, `${region}: material layers must cover full normalized height`);
	for (let index = 0; index < profile.layers.length; index++) {
		const layer = profile.layers[index];
		assert(layer.to > 0 && layer.to <= 1, `${region}: layer ${index} threshold out of normalized range`);
		if (index > 0) assert(layer.to > profile.layers[index - 1].to, `${region}: layer thresholds must increase strictly`);
		assert(palettes.includes(`id: '${layer.palette}'`), `${region}: palette ${layer.palette} is not registered`);
	}
	assert(colorDistance(profile.wallHex, profile.roofHex) >= 35, `${region}: procedural wall/roof colors are too similar; silhouette reads as one material`);
}

assert.deepEqual(profiles.north.layers.map((layer) => layer.palette), ['stone', 'wood', 'roof-tile']);
assert(profiles.fertile.layers.some((layer) => layer.palette === 'plaster'));
assert(profiles.fertile.layers.some((layer) => layer.palette === 'thatch'));
assert(profiles.maritime.layers.some((layer) => layer.palette === 'rock'));
assert(profiles.arid.layers.some((layer) => layer.palette === 'plaster'));
assert(profiles.mountain.layers.some((layer) => layer.palette === 'rock'));
assert(profiles.mountain.layers.some((layer) => layer.palette === 'brick'));
assert(profiles.temperate.layers.some((layer) => layer.palette === 'thatch'));
assert(profiles.volcanic.layers.some((layer) => layer.palette === 'iron'));
assert(profiles.volcanic.layers.some((layer) => layer.palette === 'rock'));

const primaryCounts = new Map();
const secondaryCounts = new Map();
for (const region of regions) {
	primaryCounts.set(profiles[region].assetUrl, (primaryCounts.get(profiles[region].assetUrl) || 0) + 1);
	secondaryCounts.set(profiles[region].secondaryAssetUrl, (secondaryCounts.get(profiles[region].secondaryAssetUrl) || 0) + 1);
}
assert(Math.max(...primaryCounts.values()) <= 1, 'one primary prefab must not dominate multiple geographic regions');
assert(Math.max(...secondaryCounts.values()) <= 2, 'secondary silhouette reuse must remain bounded');

const seatMapBlock = villages.slice(villages.indexOf('const SEAT_ARCHITECTURE_REGION'), villages.indexOf('export function resolveVillageArchitectureProfile'));
for (const [seat, region] of [
	['berkalp', 'north'], ['jon', 'north'], ['Night King', 'north'],
	['ziya', 'fertile'], ['berk', 'fertile'], ['olena', 'fertile'],
	['balon', 'maritime'], ['stannis', 'maritime'],
	['doran', 'arid'], ['Xaro', 'arid'], ['robin', 'mountain'],
	['twin', 'temperate'], ['cersei', 'temperate'], ['umit', 'volcanic'],
]) {
	const quotedSeat = seat.includes(' ') ? `'${seat}'` : seat;
	assert(seatMapBlock.includes(`${quotedSeat}: '${region}'`), `${seat}: geography mapping drifted from ${region}`);
}

assert(villages.includes('MAX_ARCHITECTURE_ASSETS_PER_HAMLET = 2'));
assert(villages.includes('MIN_ARCHITECTURE_ASSET_SPACING_METERS = 22'));
assert(villages.includes('Math.hypot(valid[j].x - valid[i].x, valid[j].z - valid[i].z)'));
assert(villages.includes('valid[i].houseIndex < best.first.houseIndex'));
assert(villages.includes('targetWidthMeters: type.width'));
assert(villages.includes('targetDepthMeters: type.depth'));
assert(villages.includes('Math.min(targetWidth / sourceWidth, targetDepth / sourceDepth)'));
assert(villages.includes('sampleFootprintRange(sampleHeightMeters'));
assert(villages.includes('support.min - GROUND_EMBED_EPSILON_METERS'));
assert(villages.includes('support.max - support.min'));
assert(villages.includes('roadDistanceMeters(x, z, roadEdges)'));
assert(villages.includes('waterDepth: Math.max(0, seaLevelMeters - height)'));
assert(villages.includes('slopeDegrees: Math.atan(Math.hypot(dx, dz))'));

for (const semantic of ['structure-window', 'structure-door', 'structure-timber', 'structure-metal', 'structure-thatch', 'structure-roof', 'structure-stone', 'structure-brick', 'structure-plaster']) {
	assert(villages.includes(`slot === '${semantic}'`), `missing village material routing for ${semantic}`);
}
for (const token of ['window', 'door', 'timber', 'roof', 'stone', 'brick', 'plaster']) {
	assert(classifier.toLowerCase().includes(token), `mesh classifier lacks architecture semantic token: ${token}`);
}
assert(villages.includes("if (slot === 'structure-window') return 'glass'"));
assert(villages.includes("if (slot === 'structure-door' || slot === 'structure-timber') return 'wood'"));
assert(villages.includes("if (slot === 'structure-metal') return 'iron'"));
assert(villages.includes("mode: 'surface'"));
assert(villages.includes("mode: 'layers'"));
assert(villages.includes('analysis.meshCount === 1 && analysis.surfaceCount <= 1'));
assert(villages.includes('surfaceOverrides[surface.key] = paletteId'));

assert(villages.includes('bodyMesh.setColorAt(houseCount, wallTint)'));
assert(villages.includes('roofMesh.setColorAt(houseCount, roofTint)'));
assert(villages.includes('const materialVariation = rng() - 0.5'));
assert(villages.includes('.offsetHSL(0, 0, materialVariation * 0.035)'));
assert(villages.includes('.offsetHSL(0, 0, materialVariation * 0.08)'));

for (const field of ['requestedSiteCount', 'upgradedCount', 'missingAssetCount', 'placementFailureCount', 'textureSize', 'manifests']) {
	assert(villages.includes(field), `runtime architecture evidence lost field: ${field}`);
}
assert(villages.includes('distributionDistanceMeters'));
assert(villages.includes('architectureFootprint'));
assert(villages.includes('prepared.manifest'));
assert(villages.includes('villageArchitectureEvidence'));
assert(villages.includes('villageArchitecturePromise'));

console.log('VILLAGE_GEOGRAPHY_TEXTURE_CONTRACT_PASS', JSON.stringify({
	villagesLines: villages.split(/\r?\n/).length,
	regionCount: regions.length,
	assetCount: assetUrls.length,
	assets: assetUrls,
	profiles: Object.fromEntries(regions.map((region) => [region, {
		primary: profiles[region].assetUrl,
		secondary: profiles[region].secondaryAssetUrl,
		layers: profiles[region].layers.map((layer) => layer.palette),
		wallRoofColorDistance: Number(colorDistance(profiles[region].wallHex, profiles[region].roofHex).toFixed(2)),
	}])),
}));
