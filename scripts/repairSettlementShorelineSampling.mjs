#!/usr/bin/env node
/**
 * Repair the generated settlement surface sampler so coastal scoring uses the nearest observed
 * shoreline, not whichever of the 16 probe rays happens to encounter water first.
 *
 * The production scene still owns the actual terrain sampler. This script only repairs the village
 * adapter that derives geographic evidence from that canonical sampler, and it fails closed if the
 * expected migration shape is absent or already repaired.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetPath = path.join(ROOT, 'src/3d/world/villages.js');
let source = fs.readFileSync(targetPath, 'utf8');

const oldLoop = "for (let directionIndex = 0; directionIndex < probeDirections && !Number.isFinite(shorelineDistanceMeters); directionIndex++) {";
const newLoop = "for (let directionIndex = 0; directionIndex < probeDirections; directionIndex++) {";

if (source.includes(newLoop)) {
	console.log('[repairSettlementShorelineSampling] already repaired');
	process.exit(0);
}
if (!source.includes(oldLoop)) {
	throw new Error('[repairSettlementShorelineSampling] expected first-hit shoreline probe loop was not found');
}

source = source.replace(oldLoop, newLoop);

const oldAssignment = "shorelineDistanceMeters = previousDistance + (distance - previousDistance) * interpolation;";
const newAssignment = "const candidateDistance = previousDistance + (distance - previousDistance) * interpolation;\n\t\t\t\t\t\t\t\tshorelineDistanceMeters = Math.min(shorelineDistanceMeters, candidateDistance);";
const assignmentCount = source.split(oldAssignment).length - 1;
if (assignmentCount !== 1) {
	throw new Error(`[repairSettlementShorelineSampling] expected 1 shoreline assignment, found ${assignmentCount}`);
}
source = source.replace(oldAssignment, newAssignment);

const oldGuard = "if (height >= seaLevelMeters) {\n\t\t\tconst probeDirections = 16;\n\t\t\tconst probeSteps = [8, 16, 24, 32, 48, 64];";
const newGuard = "if (height >= seaLevelMeters) {\n\t\t\tconst probeDirections = 16;\n\t\t\tconst probeSteps = [8, 16, 24, 32, 48, 64];\n\t\t\t// Search every direction and retain the minimum observed crossing; the earlier first-hit\n\t\t\t// implementation biased shoreline distance by the fixed direction iteration order.\n";
const guardCount = source.split(oldGuard).length - 1;
if (guardCount !== 1) {
	throw new Error(`[repairSettlementShorelineSampling] expected shoreline probe guard once, found ${guardCount}`);
}
source = source.replace(oldGuard, newGuard);

if (!source.includes('shorelineDistanceMeters = Math.min(shorelineDistanceMeters, candidateDistance);')) {
	throw new Error('[repairSettlementShorelineSampling] minimum shoreline selection was not materialized');
}
if (source.includes('probeDirections && !Number.isFinite(shorelineDistanceMeters)')) {
	throw new Error('[repairSettlementShorelineSampling] first-hit shoreline condition still present');
}

fs.writeFileSync(targetPath, source);
console.log('[repairSettlementShorelineSampling] PATCH_APPLIED', JSON.stringify({
	file: 'src/3d/world/villages.js',
	probeDirections: 16,
	probeSteps: [8, 16, 24, 32, 48, 64],
	selection: 'minimum-crossing-distance',
	canonicalTerrainSamplerUntouched: true,
}));
