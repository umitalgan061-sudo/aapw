#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const swPath = path.join(ROOT, 'service-worker.js');
const source = fs.readFileSync(swPath, 'utf8');
const entry = "    './src/3d/world/worldReferenceMigrationPlan.js'";

if (source.includes(entry)) {
	console.log('[applyRun185PwaAddition] PASS: migration plan already precached.');
	process.exit(0);
}

const marker = "    './src/3d/world/worldReferenceExtent.js'\n];";
if (!source.includes(marker)) {
	throw new Error('GAME3D_SHELL_FILES tail marker not found; refusing ambiguous service-worker edit');
}

const next = source.replace(marker, "    './src/3d/world/worldReferenceExtent.js'\n    ,\n" + entry + "\n];");
fs.writeFileSync(swPath, next);
console.log('[applyRun185PwaAddition] PASS: appended worldReferenceMigrationPlan.js to GAME3D_SHELL_FILES.');