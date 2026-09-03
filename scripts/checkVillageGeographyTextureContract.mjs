#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const villages = fs.readFileSync(path.join(ROOT, 'src/3d/world/villages.js'), 'utf8');
const palettes = fs.readFileSync(path.join(ROOT, 'src/3d/materials/palettes.js'), 'utf8');
const classifier = fs.readFileSync(path.join(ROOT, 'src/3d/materials/meshPartClassifier.js'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
function extractProfileBlock(region) { const marker = `${region}: architectureProfile({`; const start = villages.indexOf(marker); assert(start >= 0, `missing ${region}`); const close = villages.indexOf('}),', start + marker.length); assert(close > start, `cannot parse ${region}`); return villages.slice(start, close + 3); }
function extractHex(block, key) { const match = block.match(new RegExp(`${key}:\\s*(0x[0-9a-fA-F]+)`)); assert(match, `${key} missing`); return Number(match[1]); }
function extractString(block, key) { const match = block.match(new RegExp(`${key}:\\s*'([^']+)'`)); assert(match, `${key} missing`); return match[1]; }
function extractLayers(block) { return [...block.matchAll(/\{\s*to:\s*([0-9.]+),\s*palette:\s*'([^']+)'\s*\}/g)].map((match) => ({ to: Number(match[1]), palette: match[2] })); }
function colorDistance(a, b) { return Math.hypot(((a >> 16) & 255) - ((b >> 16) & 255), ((a >> 8) & 255) - ((b >> 8) & 255), (a & 255) - (b & 255)); }
const regions = ['north','fertile','maritime','arid','mountain','temperate','volcanic'];
const profiles = Object.fromEntries(regions.map((region) => { const block = extractProfileBlock(region); return [region, { assetUrl: extractString(block,'assetUrl'), secondaryAssetUrl: extractString(block,'secondaryAssetUrl'), wallHex: extractHex(block,'proceduralWallHex'), roofHex: extractHex(block,'proceduralRoofHex'), layers: extractLayers(block) }]; }));
assert(villages.split(/\r?\n/).length <= 600);
for (const required of ["from '../materials/MaterialAssignmentCore.js'", "from './WorldAssetPlacementPipeline.js'", 'analyzeMaterialSurfaces(object)', 'placeWorldAsset(assetGroup, object', "placementPolicy: WORLD_SURFACE_POLICY_PRESETS.settlement", "footprintGrounding: 'always'", 'requireSurfaceContext: true', 'source?.userData?.isPlaceholder === true']) assert(villages.includes(required), `missing runtime contract: ${required}`);
const assetUrls = [...new Set(regions.flatMap((region) => [profiles[region].assetUrl, profiles[region].secondaryAssetUrl]))].sort();
assert.equal(assetUrls.length, 7);
for (const assetUrl of assetUrls) { assert(assetUrl.startsWith('assets/models/settlements/')); assert(assetUrl.endsWith('.glb')); assert(serviceWorker.includes(`./${assetUrl}`), `${assetUrl}: missing offline cache`); }
for (const region of regions) { const p = profiles[region]; assert.notEqual(p.assetUrl,p.secondaryAssetUrl); assert(p.layers.length >= 3); assert.equal(p.layers.at(-1).to,1); for (let i=0;i<p.layers.length;i++){ assert(p.layers[i].to>0 && p.layers[i].to<=1); if(i>0) assert(p.layers[i].to>p.layers[i-1].to); assert(palettes.includes(`id: '${p.layers[i].palette}'`)); } assert(colorDistance(p.wallHex,p.roofHex)>=35); }
assert.deepEqual(profiles.north.layers.map((x)=>x.palette),['stone','wood','roof-tile']);
assert(profiles.fertile.layers.some((x)=>x.palette==='plaster') && profiles.fertile.layers.some((x)=>x.palette==='thatch'));
assert(profiles.maritime.layers.some((x)=>x.palette==='rock'));
assert(profiles.arid.layers.some((x)=>x.palette==='plaster'));
assert(profiles.mountain.layers.some((x)=>x.palette==='rock') && profiles.mountain.layers.some((x)=>x.palette==='brick'));
assert(profiles.temperate.layers.some((x)=>x.palette==='thatch'));
assert(profiles.volcanic.layers.some((x)=>x.palette==='iron') && profiles.volcanic.layers.some((x)=>x.palette==='rock'));
const primaryCounts = new Map(); const secondaryCounts = new Map(); for (const r of regions){ primaryCounts.set(profiles[r].assetUrl,(primaryCounts.get(profiles[r].assetUrl)||0)+1); secondaryCounts.set(profiles[r].secondaryAssetUrl,(secondaryCounts.get(profiles[r].secondaryAssetUrl)||0)+1); }
assert(Math.max(...primaryCounts.values())<=1); assert(Math.max(...secondaryCounts.values())<=2);
const seatBlock = villages.slice(villages.indexOf('const SEAT_ARCHITECTURE_REGION'), villages.indexOf('export function resolveVillageArchitectureProfile'));
for (const [seat,region] of [['berkalp','north'],['jon','north'],['Night King','north'],['ziya','fertile'],['berk','fertile'],['olena','fertile'],['balon','maritime'],['stannis','maritime'],['doran','arid'],['Xaro','arid'],['robin','mountain'],['twin','temperate'],['cersei','temperate'],['umit','volcanic']]) { const key=seat.includes(' ')?`'${seat}'`:seat; assert(seatBlock.includes(`${key}: '${region}'`), `${seat}: geography mapping drift`); }
for (const required of ['MAX_ARCHITECTURE_ASSETS_PER_HAMLET = 2','MIN_ARCHITECTURE_ASSET_SPACING_METERS = 22','Math.hypot(valid[j].x - valid[i].x, valid[j].z - valid[i].z)','targetWidthMeters: type.width','targetDepthMeters: type.depth','Math.min(targetWidth / sourceWidth, targetDepth / sourceDepth)','sampleFootprintRange(sampleHeightMeters','support.min - GROUND_EMBED_EPSILON_METERS','support.max - support.min','roadDistanceMeters(x, z, roadEdges)','waterDepth: Math.max(0, seaLevelMeters - height)','slopeDegrees: Math.atan(Math.hypot(dx, dz))']) assert(villages.includes(required), `missing geography contract: ${required}`);
for (const semantic of ['structure-window','structure-door','structure-timber','structure-metal','structure-thatch','structure-roof','structure-stone','structure-brick','structure-plaster']) assert(villages.includes(`slot === '${semantic}'`));
for (const token of ['window','door','timber','roof','stone','brick','plaster']) assert(classifier.toLowerCase().includes(token));
for (const required of ["mode: 'surface'","mode: 'layers'",'analysis.meshCount === 1 && analysis.surfaceCount <= 1','surfaceOverrides[surface.key] = paletteId','bodyMesh.setColorAt(houseCount, wallTint)','roofMesh.setColorAt(houseCount, roofTint)','const materialVariation = rng() - 0.5','prepared.manifest','villageArchitectureEvidence','villageArchitecturePromise']) assert(villages.includes(required), `missing texture/evidence contract: ${required}`);
console.log('VILLAGE_GEOGRAPHY_TEXTURE_CONTRACT_PASS', JSON.stringify({ villagesLines:villages.split(/\r?\n/).length, regionCount:regions.length, assetCount:assetUrls.length, assets:assetUrls }));
