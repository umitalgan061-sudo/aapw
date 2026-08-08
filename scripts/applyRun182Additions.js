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

function addPrecacheEntries() {
	const filePath = path.join(ROOT, 'service-worker.js');
	const source = fs.readFileSync(filePath, 'utf8');
	const hydrologyEntry = "    './src/3d/world/worldReferenceHydrology.js'";
	const extentEntry = "    './src/3d/world/worldReferenceExtent.js'";
	if (source.includes(hydrologyEntry) && source.includes(extentEntry)) return;
	const anchor = "    './src/3d/world/worldReferenceAlignment.js'\n];";
	if (!source.includes(anchor)) throw new Error('run181 alignment precache anchor not found');
	const additions = [hydrologyEntry, extentEntry].filter((entry) => !source.includes(entry));
	fs.writeFileSync(filePath, source.replace(anchor, `    './src/3d/world/worldReferenceAlignment.js'\n    ,\n${additions.join('\n    ,\n')}\n];`));
}

addPrecacheEntries();
appendOnce('WORLD_REFERENCE_MAP.md', '## Seat-safe hydrology and full-map extent — run 182', `## Seat-safe hydrology and full-map extent — run 182

Two run181 blockers are now explicit deterministic contracts, still without changing live terrain/water. \`worldReferenceHydrology.js\` composes the immutable coarse coastline mask with caller-supplied protected land sites. The standing settlement flatten outer radius (**75m**, read from the existing settlement source by the regression test) is used as the safety footprint during validation: raw mask remains 12/14 at kingdom-seat centers (\`balon\` + \`jon\` are the two coarse-mask false-water samples), while the protected composition is 14/14 land and leaves open Summer Sea water unchanged.

\`worldReferenceExtent.js\` proves that the **entire 9000x7000 owner map can fit under the existing area budget** without increasing total world area beyond the project target. Holding the canonical target at 137.5 km² gives **1.4773421007 m/map-unit**, a full-map physical extent of about **13,296m × 10,341m**, and a 500m partition grid of **27×21 = 567 chunks**. This is only ~5.9% more area than the current ~129.8 km² crop; the full-map problem is therefore primarily coordinate re-centering/scaling + streaming, not an unavoidable >150 km² expansion. The runtime constants remain untouched until a dedicated migration pass proves roads, settlements, terrain, mobile budgets and determinism under the new full-reference extent.`);

console.log('[applyRun182Additions] PASS: seat-safe hydrology + full-reference extent modules precached and documented additively.');
