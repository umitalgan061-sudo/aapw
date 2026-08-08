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
	let source = fs.readFileSync(filePath, 'utf8');
	const entry = "    './src/3d/world/worldReferenceMigrationPlan.js'";
	if (source.includes(entry)) return;
	const anchor = "    './src/3d/world/worldReferenceExtent.js'\n];";
	if (!source.includes(anchor)) throw new Error('run182 extent precache anchor not found');
	source = source.replace(anchor, `    './src/3d/world/worldReferenceExtent.js'\n    ,\n${entry}\n];`);
	fs.writeFileSync(filePath, source);
}

addPrecacheEntry();
appendOnce('WORLD_REFERENCE_MAP.md', '## Full-map runtime migration dry-run — run 184', `## Full-map runtime migration dry-run — run 184

\`worldReferenceMigrationPlan.js\` turns Run182's mathematical extent target into an explicit reversible migration contract: future full-map bounds are exactly **x:[0,9000], y:[0,7000]**, centered at map coordinate **(4500,3500)**, using **1.4773421007 m/map-unit**, about **13.296×10.341 km**, **137.5 km²**, and **27×21** 500m chunks. The helper migrates current world coordinates by first recovering their canonical 2D map coordinate, then projecting that coordinate into the planned full-reference world. This keeps saved/runtime positions tied to the owner map rather than to an ad-hoc direct world-space transform.

Run184 remains a dry-run: live \`WORLD_SCALE\`, terrain, water, roads and scene construction do not import this module. Its browser regression exercises the real modules under the planned scale and requires 14/14 kingdom-seat reversible mapping, settlement flatten safety, 14/14 seat-safe hydrology, unchanged 13-edge MST topology, finite <=20° routed road grades that remain inside the planned world rectangle, and open Summer Sea remaining water. Only after that proof may a later run switch runtime world scale and canonical hydrology.`);

console.log('[applyRun184Additions] PASS: migration plan precached and full-map dry-run contract documented additively.');
