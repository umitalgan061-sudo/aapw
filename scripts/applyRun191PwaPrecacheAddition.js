#!/usr/bin/env node
/** Run 191: additive-only PWA precache insertion for the stone-bridge shadow module. */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'service-worker.js');
const ENTRY = "    './src/3d/world/worldReferenceStoneBridgeShadow.js',";
const MARKER = "    './src/3d/world/worldReferenceRockShadow.js',";

let source = fs.readFileSync(FILE, 'utf8');
if (source.includes(ENTRY)) {
	console.log('[applyRun191PwaPrecacheAddition] PASS: entry already present.');
	process.exit(0);
}
if (!source.includes(MARKER)) throw new Error('service-worker Run190 insertion marker missing');
source = source.replace(MARKER, `${MARKER}\n${ENTRY}`);
fs.writeFileSync(FILE, source);
console.log('[applyRun191PwaPrecacheAddition] PASS: added worldReferenceStoneBridgeShadow.js to GAME3D_SHELL_FILES.');
