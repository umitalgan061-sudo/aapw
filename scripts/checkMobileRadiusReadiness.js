#!/usr/bin/env node
/** Conservative mobile radius-4 readiness gate; does not change runtime behavior. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const CHUNK_MANAGER_PATH = path.join(ROOT, 'src/3d/world/chunkManager.js');
const MOBILE_PERF_GATE_PATH = path.join(__dirname, 'checkMobilePerfBudget.js');
const CURRENT_RADIUS = 3;
const CANDIDATE_RADIUS = 4;
const FAR_SEGMENTS = 16;
const DRAW_CALL_EXCLUSIVE_MAX = 500;
const TRIANGLE_EXCLUSIVE_MAX = 500000;
function squareChunkCount(radius) { return (radius * 2 + 1) ** 2; }
function parseMobileSample(stdout) {
	const match = stdout.match(/\[checkMobilePerfBudget\] sample (\{.*\})/);
	if (!match) throw new Error('could not find checkMobilePerfBudget sample payload');
	return JSON.parse(match[1]);
}
function verifyCurrentPolicy(source) {
	if (!source.includes('const MOBILE_STREAMING_RADIUS_CHUNKS_RUN130 = 3;')) throw new Error('live mobile streaming radius is no longer the expected run-130 radius 3');
	if (!source.includes('const MOBILE_TERRAIN_LOD_SEGMENTS_RUN134 = Object.freeze({ NEAR: 64, MID: 32, FAR: 16 });')) throw new Error('run-134 terrain LOD policy changed; readiness projection would be stale');
}
function main() {
	const source = fs.readFileSync(CHUNK_MANAGER_PATH, 'utf8');
	verifyCurrentPolicy(source);
	const perf = spawnSync(process.execPath, [MOBILE_PERF_GATE_PATH], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
	process.stdout.write(perf.stdout || '');
	process.stderr.write(perf.stderr || '');
	if (perf.status !== 0) throw new Error(`existing mobile render-budget gate failed with exit ${perf.status}`);
	const sample = parseMobileSample(perf.stdout || '');
	const currentChunks = squareChunkCount(CURRENT_RADIUS);
	const candidateChunks = squareChunkCount(CANDIDATE_RADIUS);
	const addedChunks = candidateChunks - currentChunks;
	const addedTerrainTrianglesUpperBound = addedChunks * 2 * FAR_SEGMENTS * FAR_SEGMENTS;
	const projectedTrianglesUpperBound = sample.triangles + addedTerrainTrianglesUpperBound;
	const projectedDrawCallsUpperBound = sample.drawCalls + addedChunks;
	const payload = {
		currentRadius: CURRENT_RADIUS, candidateRadius: CANDIDATE_RADIUS,
		currentResidentChunks: currentChunks, candidateResidentChunks: candidateChunks,
		addedOuterRingChunks: addedChunks, farSegments: FAR_SEGMENTS,
		currentMeasured: { drawCalls: sample.drawCalls, triangles: sample.triangles, geometries: sample.geometries, textures: sample.textures, fpsTrendOnly: sample.fps },
		conservativeProjection: { drawCallsUpperBound: projectedDrawCallsUpperBound, trianglesUpperBound: projectedTrianglesUpperBound, drawCallHeadroom: DRAW_CALL_EXCLUSIVE_MAX - projectedDrawCallsUpperBound, triangleHeadroom: TRIANGLE_EXCLUSIVE_MAX - projectedTrianglesUpperBound, addedTerrainTrianglesUpperBound },
		budgets: { drawCallsExclusiveMax: DRAW_CALL_EXCLUSIVE_MAX, trianglesExclusiveMax: TRIANGLE_EXCLUSIVE_MAX },
		governanceApproval: false,
		governanceReason: 'ADR-0157 / QUESTIONS_FOR_OWNER.md owner decision is still required before changing live radius',
	};
	console.log(`[checkMobileRadiusReadiness] projection ${JSON.stringify(payload)}`);
	if (projectedDrawCallsUpperBound >= DRAW_CALL_EXCLUSIVE_MAX) throw new Error(`radius-4 conservative draw-call projection fails: ${projectedDrawCallsUpperBound} >= ${DRAW_CALL_EXCLUSIVE_MAX}`);
	if (projectedTrianglesUpperBound >= TRIANGLE_EXCLUSIVE_MAX) throw new Error(`radius-4 conservative triangle projection fails: ${projectedTrianglesUpperBound} >= ${TRIANGLE_EXCLUSIVE_MAX}`);
	console.log('[checkMobileRadiusReadiness] PASS: radius 4 has conservative measurable render-budget headroom; governance approval remains intentionally unresolved.');
}
try { main(); } catch (error) { console.error('[checkMobileRadiusReadiness] FAIL:', error.message || error); process.exit(1); }
