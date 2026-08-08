#!/usr/bin/env node
/** Run 190: additive-only PWA precache insertion for the shadow rock module. */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'service-worker.js');
const ENTRY = "    './src/3d/world/worldReferenceRockShadow.js',";
const MARKER = "    './src/3d/world/mobileVegetationCulling.js',";

let source = fs.readFileSync(FILE, 'utf8');
if (source.includes(ENTRY)) {
	console.log('[applyRun190PwaPrecacheAddition] PASS: entry already present.');
	process.exit(0);
}
if (!source.includes(MARKER)) throw new Error('service-worker insertion marker missing');
source = source.replace(MARKER, `${MARKER}\n${ENTRY}`);
fs.writeFileSync(FILE, source);
console.log('[applyRun190PwaPrecacheAddition] PASS: added worldReferenceRockShadow.js to GAME3D_SHELL_FILES.');
