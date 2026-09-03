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
	const nextProfile = villages.indexOf('\n\t', start + marker.length);
	const close = villages.indexOf('}),', nextProfile);
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

assert.deepEqual(profiles.north.layers.map((layer) => layer.palette), ['stone', 'wood', 'roof-tile'], 'north must read as stone foundation + timber + hard roof');
assert(profiles.fertile.layers.some((layer) => layer.palette === 'plaster'), 'fertile settlements need plaster body surfaces');
assert(profiles.fertile.layers.some((layer) => layer.palette === 'thatch'), 'fertile settlements need agricultural thatch roof language');
assert(profiles.maritime.layers.some((layer) => layer.palette === 'rock'), 'maritime settlements need weathered rock foundation language');
assert(profiles.arid.layers.some((layer) => layer.palette === 'plaster'), 'arid settlements need pale plaster body language');
assert(profiles.mountain.layers.some((layer) => layer.palette === 'rock'), 'mountain settlements need rock foundation language');
assert(profiles.mountain.layers.some((layer) => layer.palette === 'brick'), 'mountain settlements need masonry body language');
assert(profiles.temperate.layers.some((layer) => layer.palette === 'thatch'), 'temperate rural settlements need thatch roof language');
assert(profiles.volcanic.layers.some((layer) => layer.palette === 'iron'), 'volcanic settlements need dark metal structural accents');
assert(profiles.volcanic.layers.some((layer) => layer.palette === 'rock'), 'volcanic settlements need rock foundation language');

const primaryCounts = new Map();
const secondaryCounts = new Map();
for (const region of regions) {
	primaryCounts.set(profiles[region].assetUrl, (primaryCounts.get(profiles[region].assetUrl) || 0) + 1);
	secondaryCounts.set(profiles[region].secondaryAssetUrl, (secondaryCounts.get(profiles[region].secondaryAssetUrl) || 0) + 1);
}
assert(Math.max(...primaryCounts.values()) <= 1, 'one primary prefab must not dominate multiple geographic regions');
assert(Math.max(...secondaryCounts.values()) <= 2, 'secondary silhouette reuse must remain bounded');

const seatRegionPairs = [...villages.matchAll(/([A-Za-z' ]+):\s*'(north|fertile|maritime|arid|mountain|temperate|volcanic)'/g)]
	.map((match) => ({ seat: match[1].trim().replace(/^'|'$/g, ''), region: match[2] }));
const seatMap = new Map(seatRegionPairs.map((entry) => [entry.seat, entry.region]));
for (const seat of ['berkalp', 'jon', 'Night King']) assert.equal(seatMap.get(seat), 'north', `${seat}: northern geography drift`);
for (const seat of ['ziya', 'berk', 'olena']) assert.equal(seatMap.get(seat), 'fertile', `${seat}: fertile geography drift`);
for (const seat of ['balon', 'stannis']) assert.equal(seatMap.get(seat), 'maritime', `${seat}: maritime geography drift`);
for (const seat of ['doran', 'Xaro']) assert.equal(seatMap.get(seat), 'arid', `${seat}: arid geography drift`);
assert.equal(seatMap.get('robin'), 'mountain', 'robin: mountain geography drift');
for (const seat of ['twin', 'cersei']) assert.equal(seatMap.get(seat), 'temperate', `${seat}: temperate geography drift`);
assert.equal(seatMap.get('umit'), 'volcanic', 'umit: volcanic geography drift');

assert(villages.includes('MAX_ARCHITECTURE_ASSETS_PER_HAMLET = 2'), 'real asset count per hamlet must remain bounded');
assert(villages.includes('MIN_ARCHITECTURE_ASSET_SPACING_METERS = 22'), 'real silhouettes must remain spatially separated');
assert(villages.includes('Math.hypot(valid[j].x - valid[i].x, valid[j].z - valid[i].z)'), 'landmark distribution must measure real world-space distance');
assert(villages.includes('valid[i].houseIndex < best.first.houseIndex'), 'equal-distance landmark selection must keep deterministic tie-breaking');
assert(villages.includes('targetWidthMeters: type.width'), 'replacement GLBs must inherit authored procedural parcel width');
assert(villages.includes('targetDepthMeters: type.depth'), 'replacement GLBs must inherit authored procedural parcel depth');
assert(villages.includes('Math.min(targetWidth / sourceWidth, targetDepth / sourceDepth)'), 'GLBs must fit both parcel axes without stretching');
assert(villages.includes('sampleFootprintRange(sampleHeightMeters'), 'procedural buildings must sample full rotated footprints');
assert(villages.includes('support.min - GROUND_EMBED_EPSILON_METERS'), 'procedural buildings must embed low side into terrain');
assert(villages.includes('support.max - support.min'), 'procedural foundations must absorb terrain relief rather than float');
assert(villages.includes('roadDistanceMeters(x, z, roadEdges)'), 'shared placement surface query must preserve road-distance context');
assert(villages.includes('waterDepth: Math.max(0, seaLevelMeters - height)'), 'shared placement surface query must preserve water context');
assert(villages.includes('slopeDegrees: Math.atan(Math.hypot(dx, dz))'), 'shared placement surface query must preserve slope context');

for (const semantic of ['structure-window', 'structure-door', 'structure-timber', 'structure-metal', 'structure-thatch', 'structure-roof', 'structure-stone', 'structure-brick', 'structure-plaster']) {
	assert(villages.includes(`slot === '${semantic}'`), `missing village material routing for ${semantic}`);
}
for (const token of ['window', 'door', 'timber', 'roof', 'stone', 'brick', 'plaster']) {
	assert(classifier.toLowerCase().includes(token), `mesh classifier lacks architecture semantic token: ${token}`);
}
assert(villages.includes("if (slot === 'structure-window') return 'glass'"), 'windows must remain a distinct glass surface');
assert(villages.includes("if (slot === 'structure-door' || slot === 'structure-timber') return 'wood'"), 'doors/timbers must remain wood surfaces');
assert(villages.includes("if (slot === 'structure-metal') return 'iron'"), 'metal trim must remain distinct from wall/roof material');
assert(villages.includes("mode: 'surface'"), 'multi-surface imported buildings must use surface material recipe');
assert(villages.includes("mode: 'layers'"), 'single-surface imported buildings need layered geographic fallback');
assert(villages.includes('analysis.meshCount === 1 && analysis.surfaceCount <= 1'), 'layer fallback must be restricted to true single-surface models');
assert(villages.includes('surfaceOverrides[surface.key] = paletteId'), 'authored material slots must feed shared-core surface overrides');

assert(villages.includes('bodyMesh.setColorAt(houseCount, wallTint)'), 'procedural settlement fabric needs regional wall tint variation');
assert(villages.includes('roofMesh.setColorAt(houseCount, roofTint)'), 'procedural settlement fabric needs regional roof tint variation');
assert(villages.includes('const materialVariation = rng() - 0.5'), 'regional procedural surfaces need deterministic per-house variation');
assert(villages.includes('.offsetHSL(0, 0, materialVariation * 0.035)'), 'wall variation must stay subtle');
assert(villages.includes('.offsetHSL(0, 0, materialVariation * 0.08)'), 'roof variation must stay visible but bounded');

const evidenceFields = ['requestedSiteCount', 'upgradedCount', 'missingAssetCount', 'placementFailureCount', 'textureSize', 'manifests'];
for (const field of evidenceFields) assert(villages.includes(field), `runtime architecture evidence lost field: ${field}`);
assert(villages.includes('distributionDistanceMeters'), 'placement evidence must expose real-asset spacing');
assert(villages.includes('architectureFootprint'), 'placement evidence must expose fitted model footprint');
assert(villages.includes('prepared.manifest'), 'shared placement/material manifest must be retained as acceptance evidence');
assert(villages.includes('villageArchitectureEvidence'), 'runtime group must retain architecture evidence');
assert(villages.includes('villageArchitecturePromise'), 'shipped runtime must expose async architecture completion for acceptance');

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
