#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(ROOT, 'src/3d/world/villages.js');
let source = fs.readFileSync(target, 'utf8');
const replaceOnce = (before, after, label) => {
	const count = source.split(before).length - 1;
	if (count !== 1) throw new Error(`[integrateSettlementHouseTypeMix] ${label}: expected 1 match, found ${count}`);
	source = source.replace(before, after);
};
if (!source.includes("./settlementHouseTypeMix.js")) {
	replaceOnce(
		"import { createStoneMaterial, createRoofMaterial } from './materials.js';\n",
		"import { createStoneMaterial, createRoofMaterial } from './materials.js';\nimport { pickSettlementHouseTypeIndex } from './settlementHouseTypeMix.js';\n",
		'import',
	);
	replaceOnce(
		"export function pickHouseTypeIndex(roll) {\n",
		"export function pickHouseTypeIndex(roll, regionId = null) {\n\tconst regionalIndex = pickSettlementHouseTypeIndex(roll, regionId);\n\tif (regionalIndex !== null) return regionalIndex;\n",
		'picker signature',
	);
	replaceOnce(
		"\t\t\t\tconst type = HOUSE_TYPES[pickHouseTypeIndex(rng())];\n",
		"\t\t\t\tconst type = HOUSE_TYPES[pickHouseTypeIndex(rng(), architectureProfile?.id)];\n",
		'regional fallback usage',
	);
}
fs.writeFileSync(target, source);
console.log('[integrateSettlementHouseTypeMix] PATCH_APPLIED');