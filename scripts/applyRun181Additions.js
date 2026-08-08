#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function appendOnce(filePath, marker, block) {
	const absolute = path.join(ROOT, filePath);
	const source = fs.readFileSync(absolute, 'utf8');
	if (source.includes(marker)) return;
	fs.writeFileSync(absolute, `${source.trimEnd()}\n\n${block.trim()}\n`);
}

function addPrecacheEntry() {
	const filePath = path.join(ROOT, 'service-worker.js');
	const source = fs.readFileSync(filePath, 'utf8');
	const entry = "    './src/3d/world/worldReferenceAlignment.js'";
	if (source.includes(entry)) return;
	const anchor = "    './src/3d/world/worldReferenceWaterMask.js'\n];";
	if (!source.includes(anchor)) throw new Error('run179 water-mask precache anchor not found');
	fs.writeFileSync(filePath, source.replace(anchor, `    './src/3d/world/worldReferenceWaterMask.js'\n    ,\n${entry}\n];`));
}

addPrecacheEntry();
appendOnce('WORLD_REFERENCE_MAP.md', '## Exact 2D canvas alignment — run 181', `## Exact 2D canvas alignment — run 181

The normalized reference transform is no longer an assumption. The live 2D shell defines \`#map-canvas\` as exactly **9000x7000** units and stretches \`resimler/map.png\` across that canvas with \`background-size: 100% 100%\`. Therefore \`src/3d/world/worldReferenceAlignment.js\` maps 2D coordinates exactly as \`normalizedX = mapX / 9000\`, \`normalizedY = mapY / 7000\`, and provides inverse/world-space round trips through the existing \`WORLD_SCALE.MAP_BOUNDS\` convention.

The alignment check also exposes two separate safety facts that must not be conflated with transform correctness: the coarse run179 mask classifies 12/14 kingdom-seat samples as land and flags \`balon\` + \`jon\` as raw-water cells, so a seat-safe hydrology override/refined mask is mandatory before runtime terrain adoption; and the current padded 3D \`MAP_BOUNDS\` span only about **67.3%** of the full normalized 2D reference rectangle, so whole-map 3D coverage requires a later measured world-extent/scale decision rather than silently pretending the current crop already represents the entire image.`);

console.log('[applyRun181Additions] PASS: alignment module precached and reference-map alignment findings documented additively.');
