#!/usr/bin/env node
/** Additive-only PWA precache insertion for Run191 medieval bridge art V2. */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'service-worker.js');
const MARKER = "    './src/3d/world/worldReferenceStoneBridgeShadow.js',";
const ENTRY = "    './src/3d/world/worldReferenceStoneBridgeMedievalArtV2.js',";
let source = fs.readFileSync(FILE, 'utf8');
if (source.includes(ENTRY)) {
	console.log('[applyRun191MedievalArtV2PwaPrecacheAddition] PASS: entry already present.');
	process.exit(0);
}
if (!source.includes(MARKER)) throw new Error('Run191 core bridge precache marker missing');
source = source.replace(MARKER, `${MARKER}\n${ENTRY}`);
fs.writeFileSync(FILE, source);
console.log('[applyRun191MedievalArtV2PwaPrecacheAddition] PASS: added versioned medieval bridge art V2 module.');
