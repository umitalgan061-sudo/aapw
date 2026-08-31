#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const browserSource = readFileSync(new URL('./checkNorthMountainSnowVisualQa.js', import.meta.url), 'utf8');
const htmlSource = readFileSync(new URL('../north-mountain-snow-visual-qa.html', import.meta.url), 'utf8');
const terrainSource = readFileSync(new URL('../src/3d/world/terrainBiomeShading.js', import.meta.url), 'utf8');
const snowToneSource = readFileSync(new URL('../src/3d/world/terrainSnowSurfaceTone.js', import.meta.url), 'utf8');

assert.match(browserSource, /resolveTerrainSnowCoverage/,
  'mountain visual QA must consume authoritative terrain snow coverage rather than inventing snow amount');
assert.match(browserSource, /resolveTerrainSnowSurfaceTone/,
  'mountain visual QA must consume the production snow-tone classifier');
assert.match(browserSource, /resolveTerrainBiomeColor/,
  'mountain visual QA must render final production terrain colour, not standalone palette swatches');
assert.match(browserSource, /terrainWindward:\s*0\.94/,
  'mountain visual QA must retain a strong canonical windward fixture');
assert.match(browserSource, /terrainLee:\s*0\.94/,
  'mountain visual QA must retain a strong canonical lee fixture');
assert.match(browserSource, /terrainConcavityMeters:\s*-3\.2/,
  'windward fixture must remain ridge-like/convex');
assert.match(browserSource, /terrainConcavityMeters:\s*3\.8/,
  'lee fixtures must remain bowl-like/concave');

for (const coordinate of [
  /normalizedX:\s*0\.145,\s*normalizedY:\s*0\.115/,
  /normalizedX:\s*0\.155,\s*normalizedY:\s*0\.20/,
  /normalizedX:\s*0\.175,\s*normalizedY:\s*0\.30/,
]) {
  assert.match(browserSource, coordinate,
    'mountain visual QA must keep canonical FAR NORTH / ICE EDGE / TUNDRA map-aligned anchors');
}

assert.match(browserSource, /north-mountain-snow-harmony\.png/,
  'mountain QA must keep a browser screenshot artifact');
assert.match(browserSource, /north-mountain-snow-report\.json/,
  'mountain QA must keep machine-readable snow harmony telemetry');
assert.match(browserSource, /accumulatedGlacialPaletteRetention/,
  'mountain QA report must expose accumulated glacial palette retention telemetry');
assert.match(browserSource, /toGlacialIce/,
  'mountain QA report must measure final runtime colour distance to glacial ice');
assert.match(browserSource, /toCoastalIce/,
  'mountain QA report must measure final runtime colour distance to coastal ice');
assert.match(browserSource, /toPackedSnow/,
  'mountain QA report must measure packed-snow family distance');
assert.match(browserSource, /toAccumulatedSnow/,
  'mountain QA report must measure accumulated-snow family distance');

assert.match(htmlSource, /terrainBiomeShading\.js/,
  'mountain browser page must import the live terrain shading module');
assert.match(htmlSource, /terrainSnowSurfaceTone\.js/,
  'mountain browser page must import the live snow-tone module');
assert.match(htmlSource, /worldReferenceAlignment\.js/,
  'mountain browser page must retain map-aligned coordinate authority');
assert.match(htmlSource, /__northMountainSnowQaModules/,
  'mountain browser page must expose only the modules used by its runtime QA harness');

assert.match(terrainSource, /heightAuthorityUnchanged:\s*true/,
  'terrain palette owner must remain explicitly render-only');
assert.match(snowToneSource, /heightAuthorityUnchanged:\s*true/,
  'snow-tone classifier must remain explicitly outside terrain height authority');
assert.match(snowToneSource, /snowCoverageAuthorityUnchanged:\s*true/,
  'snow-tone classifier must not become a second snow-coverage owner');
assert.doesNotMatch(snowToneSource, /heightAboveSeaMeters\s*[+\-]=/,
  'snow-tone visual model must never mutate terrain height');

const orderedCalls = [
  browserSource.indexOf('resolveTerrainSnowCoverage({'),
  browserSource.indexOf('resolveTerrainSnowSurfaceTone({'),
  browserSource.indexOf('resolveTerrainBiomeColor(new THREE.Color()'),
];
assert(orderedCalls.every((index) => index >= 0), 'full mountain snow runtime chain must remain present');
assert(orderedCalls[0] < orderedCalls[1] && orderedCalls[1] < orderedCalls[2],
  'mountain visual fixture must resolve coverage before tone and final terrain colour');

console.log(JSON.stringify({
  authoritativeChain: ['resolveTerrainSnowCoverage', 'resolveTerrainSnowSurfaceTone', 'resolveTerrainBiomeColor'],
  canonicalAnchors: ['far-north', 'ice-edge', 'tundra'],
  screenshotArtifact: 'north-mountain-snow-harmony.png',
  reportArtifact: 'north-mountain-snow-report.json',
  heightAuthorityUnchanged: true,
  snowCoverageAuthorityUnchanged: true,
}, null, 2));
