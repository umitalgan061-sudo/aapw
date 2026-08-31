#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const terrain = read('src/3d/world/worldReferenceSurfaceTerrainVisual.js');
const water = read('src/3d/world/water.js');
const roads = read('src/3d/world/roads.js');

function requireTokens(source, label, tokens) {
	for (const token of tokens) {
		if (!source.includes(token)) throw new Error(`[checkCinematicGeographyRealism] ${label} missing: ${token}`);
	}
}

requireTokens(terrain, 'terrain natural-transition contract', [
	"naturalTransitionRevision: 'v1-slope-aspect-shelter'",
	'slopeAwareAtlasIntegration: true',
	'aspectWeathering: true',
	'shelteredMoisture: true',
	'pindexGeoNormal',
	'pindexGeoSlope',
	'pindexGeoAspect',
	'pindexGeoWetShelter',
	'pindexGeoWeatheredFace',
	'pindexGeoMossPocket',
	'PINDEX_QUALITY_V2_GRANITE_SHADOW',
	'PINDEX_QUALITY_V2_GRANITE_SUNLIT',
	'PINDEX_QUALITY_V2_BASALT_WET',
]);

requireTokens(water, 'coast breaker contract', [
	"shoreBreakerRevision: 'v1-bathymetry-directed-irregular-lace'",
	'directionalBreakers: true',
	'nonPeriodicFoamBreakup: true',
	'vec2 shorelineDepthGradient',
	'shoreNormal',
	'shoreTangent',
	'alongShoreBreakup',
	'breakerCrest',
	'foamLace',
	'irregularBreaker',
	'bathymetryDirectedIrregularBreakers: true',
]);

requireTokens(roads, 'road shoulder contract', [
	'irregularEdgeErosion: true',
	'terrainIngressAtShoulder: true',
	'run177EdgeMacro',
	'run177EdgeMeso',
	'run177EdgeThreshold',
	'run177EdgeErosion',
	'run177TerrainIngress',
	'run177IrregularShoulder',
]);

for (const [label, source] of [['terrain', terrain], ['water', water], ['roads', roads]]) {
	if (label === 'roads') {
		const roadSurface = source.slice(source.indexOf('// RUN 177'));
		if (roadSurface.includes('Math.random(')) throw new Error('[checkCinematicGeographyRealism] road material became nondeterministic');
		continue;
	}
	if (source.includes('Math.random(')) throw new Error(`[checkCinematicGeographyRealism] ${label} became nondeterministic`);
}

if (!water.includes('shallowMask *= shorelineGradientMask(vWorldPosition.xz) * waterCoverage;')) {
	throw new Error('[checkCinematicGeographyRealism] foam lost canonical shoreline/depth gating');
}
if (!roads.includes('extraDrawCalls: 0')) {
	throw new Error('[checkCinematicGeographyRealism] road realism added geometry instead of a material-only transition');
}
if (!terrain.includes('cpuVertexPassesAdded: 0')) {
	throw new Error('[checkCinematicGeographyRealism] terrain realism added a second CPU vertex pass');
}

console.log('[checkCinematicGeographyRealism] PASS: slope/aspect/shelter terrain, bathymetry-directed irregular surf, and eroded road shoulders remain deterministic and render-only.');

