#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const terrain = read('src/3d/world/worldReferenceSurfaceTerrainVisual.js');
const water = read('src/3d/world/water.js');
const roads = read('src/3d/world/roads.js');
const ecologyDetail = read('src/3d/world/worldAssetTransitionDetail.js');
const surfaceFabric = read('src/3d/materials/worldAssetSurfaceFabric.js');

function requireTokens(source, label, tokens) {
	for (const token of tokens) {
		if (!source.includes(token)) throw new Error(`[checkCinematicGeographyRealism] ${label} missing: ${token}`);
	}
}

requireTokens(terrain, 'terrain owner-map visual contract', [
	'WORLD_REFERENCE_SURFACE_VISUAL_POLICY',
	'sourceMapSha256:',
	'applyReferenceSurfaceToTerrainMesh',
	'RUNTIME_PINDEX_TERRAIN_POLISH_POLICY',
	'applyPindex01DetailToTerrainMesh',
	'applyPindex05DetailToTerrainMesh',
	'applyPindex10DetailToTerrainMesh',
	'canonical terrain mesh',
]);

requireTokens(ecologyDetail, 'world transition detail contract', [
	"WORLD_ASSET_TRANSITION_DETAIL_REVISION = 'v1-world-space-irregular-boundary-fabric'",
	'revision: WORLD_ASSET_TRANSITION_DETAIL_REVISION',
	'canonicalDistanceReadOnly: true',
	'canonicalHydrologyReadOnly: true',
	'canonicalRoadReadOnly: true',
	'canonicalSettlementReadOnly: true',
	'newGeographyIntroduced: false',
	'boundaryWarpMeters:',
	'materialNoiseScalesMeters:',
]);

requireTokens(surfaceFabric, 'asset surface fabric contract', [
	"revision: WORLD_ASSET_SURFACE_FABRIC_REVISION",
	'worldSpace: true',
	'geometryUnchanged: true',
	'sourceMapsPreserved: true',
	'sourceUvsPreserved: true',
	'canonicalTerrainReadOnly: true',
	'canonicalHydrologyReadOnly: true',
	'canonicalColliderReadOnly: true',
	'usesIrregularBoundaryDetail: true',
	'worldAssetSurfaceFabricFbm',
	'worldAssetSurfaceFabricRoughPattern',
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

for (const [label, source] of [['terrain', terrain], ['water', water], ['roads', roads], ['transition-detail', ecologyDetail], ['surface-fabric', surfaceFabric]]) {
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
if (!surfaceFabric.includes('newGeographyIntroduced: false')) {
	throw new Error('[checkCinematicGeographyRealism] asset surface fabric is no longer geography-neutral');
}

console.log('[checkCinematicGeographyRealism] PASS: owner-map terrain, deterministic irregular world-space transitions, bathymetry-directed surf, and eroded road shoulders remain render-only.');
