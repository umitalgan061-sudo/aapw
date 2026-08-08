#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SW_PATH = path.join(ROOT, 'service-worker.js');
const ENTRY = "    './src/3d/world/worldReferenceTerrainAdapter.js'";
const ANCHOR = "    './src/3d/world/worldReferenceMigrationPlan.js'\n];";

let source = fs.readFileSync(SW_PATH, 'utf8');
if (!source.includes(ENTRY)) {
	if (!source.includes(ANCHOR)) throw new Error('Run186 PWA precache anchor not found');
	source = source.replace(ANCHOR, `    './src/3d/world/worldReferenceMigrationPlan.js'\n    ,\n${ENTRY}\n];`);
	fs.writeFileSync(SW_PATH, source);
}

console.log('[applyRun186PwaPrecacheAddition] PASS: canonical terrain shadow adapter is included in GAME3D_SHELL_FILES additively.');
