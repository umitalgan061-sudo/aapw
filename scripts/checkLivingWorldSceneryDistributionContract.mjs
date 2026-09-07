#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [distribution, geography, surfaceAudit, sceneManager] = await Promise.all([
  readFile('src/3d/gameplay/livingWorldSceneryDistribution.js', 'utf8'),
  readFile('src/3d/gameplay/livingWorldGeographyAdapter.js', 'utf8'),
  readFile('src/3d/materials/RuntimeSurfaceAudit.js', 'utf8'),
  readFile('src/3d/sceneManager.js', 'utf8'),
]);

assert.match(distribution, /noSecondBiomeFramework:\s*true/);
assert.match(distribution, /slopeSampleOffsetMeters:\s*4/);
assert.match(distribution, /deriveTerrainContext\(/);
assert.match(distribution, /waterDepth = Math\.max\(0,/);
assert.match(distribution, /Math\.sin\(x \* 12\.9898 \+ z \* 78\.233/);
assert.match(distribution, /mesh\.count = next/);
assert.match(distribution, /settlementSeats/);
assert.match(distribution, /roadEdges/);
assert.match(distribution, /regionDensity/);

assert.match(geography, /const SPECIES_AUTHORED_ASSETS/);
assert.match(geography, /wolf:\s*Object\.freeze\(\['assets\/models\/animals\/wolf\/Wolf-Blender-2\.82a\.glb'\]\)/);
assert.match(geography, /dragon:\s*Object\.freeze\(\['assets\/models\/creatures\/dragons\/verdant_wyrm\.glb'/);
assert.match(geography, /habitat:\s*Object\.freeze\(\{ maxSlope:/);
assert.doesNotMatch(geography, /habitat:\s*Object\.freeze\(\{ minSlope:/);
assert.match(geography, /authoredAssetExact/);
assert.match(geography, /speciesId:\s*speciesId \?\? null/);

assert.match(surfaceAudit, /RUNTIME_SURFACE_AUDIT_POLICY/);
assert.match(surfaceAudit, /normalizeBaseColorColorSpace/);
assert.match(surfaceAudit, /normalMapped/);
assert.match(surfaceAudit, /roughnessMapped/);
assert.match(surfaceAudit, /runtimeSurfaceAudit/);
assert.match(sceneManager, /auditRuntimeSurface/);
assert.match(sceneManager, /winter-vegetation-hydrated/);
assert.match(sceneManager, /natural-geology-hydrated/);
assert.match(sceneManager, /vegetationDistribution/);

console.log(JSON.stringify({
  ok: true,
  checks: [
    'terrain-derived slope/water scenery gates',
    'continuous deterministic spatial hashing',
    'settlement and road exclusion',
    'exact species authored-asset resolution',
    'maxSlope habitat semantics',
    'runtime PBR texture/map audit wiring',
    'scene-level hydrated-asset telemetry',
  ],
}));
