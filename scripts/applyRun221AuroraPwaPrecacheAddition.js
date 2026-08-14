#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SW_PATH = path.join(ROOT, 'service-worker.js');
const MARKER = '// Run221 realistic gameplay aurora offline shell extension.';
const ENTRIES = [
	"    GAME3D_SHELL_FILES.push('./src/3d/auroraRealism.js');",
	"    GAME3D_SHELL_FILES.push('./src/3d/nightVisualEnhancement.js');",
];

let source = fs.readFileSync(SW_PATH, 'utf8');
if (!ENTRIES.every((entry) => source.includes(entry.trim()))) {
	const block = `${MARKER}\nself.addEventListener('install', () => {\n${ENTRIES.join('\n')}\n});\n\n`;
	if (!source.startsWith(MARKER)) source = block + source;
	fs.writeFileSync(SW_PATH, source);
}

for (const entry of ENTRIES) {
	if (!fs.readFileSync(SW_PATH, 'utf8').includes(entry.trim())) {
		throw new Error(`Run221 PWA precache entry missing after patch: ${entry.trim()}`);
	}
}

console.log('[applyRun221AuroraPwaPrecacheAddition] PASS: realistic aurora + cinematic night modules staged additively in GAME3D_SHELL_FILES.');
