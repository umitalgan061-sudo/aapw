#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SW_PATH = path.join(ROOT, 'service-worker.js');
const ENTRY = "    './src/3d/world/worldReferenceMigrationPlan.js'";
const ANCHOR = "    './src/3d/world/worldReferenceExtent.js'\n];";

let source = fs.readFileSync(SW_PATH, 'utf8');
if (!source.includes(ENTRY)) {
	if (!source.includes(ANCHOR)) throw new Error('Run185 PWA precache anchor not found');
	source = source.replace(ANCHOR, `    './src/3d/world/worldReferenceExtent.js'\n    ,\n${ENTRY}\n];`);
	fs.writeFileSync(SW_PATH, source);
}

console.log('[applyRun185PwaPrecacheAddition] PASS: shadow migration module is included in GAME3D_SHELL_FILES without changing existing service-worker lines.');
