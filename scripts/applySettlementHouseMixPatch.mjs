#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetPath = path.join(ROOT, 'src/3d/world/villages.js');
let source = fs.readFileSync(targetPath, 'utf8');
if (source.includes("./settlementHouseTypeMix.js")) {
	console.log('[applySettlementHouseMixPatch] already applied');
	process.exit(0);
}

const replaceOnce = (before, after, label) => {
	const count = source.split(before).length - 1;
	if (count !== 1) throw new Error(`[applySettlementHouseMixPatch] ${label}: expected 1 match, found ${count}`);
	source = source.replace(before, after);
};

replaceOnce(
	"import {\n\tresolveSettlementArchitectureEvidence,\n\tresolveSettlementPreferredMaterialRole,\n\tscoreSettlementArchitectureSite,\n\tselectSettlementArchitectureVariant,\n} from './settlementGeographyPolicy.js';\n",
	"import {\n\tresolveSettlementArchitectureEvidence,\n\tresolveSettlementPreferredMaterialRole,\n\tscoreSettlementArchitectureSite,\n\tselectSettlementArchitectureVariant,\n} from './settlementGeographyPolicy.js';\nimport { pickSettlementHouseTypeIndex } from './settlementHouseTypeMix.js';\n",
	'house mix import',
);

replaceOnce(
	"export function pickHouseTypeIndex(roll) {\n\tconst total = HOUSE_TYPES.reduce((sum, type) => sum + type.weight, 0);\n\tlet cumulative = 0;\n\tfor (let i = 0; i < HOUSE_TYPES.length; i++) {\n\t\tcumulative += HOUSE_TYPES[i].weight / total;\n\t\tif (roll < cumulative) return i;\n\t}\n\treturn HOUSE_TYPES.length - 1;\n}\n",
	"export function pickHouseTypeIndex(roll, regionId = null) {\n\tconst regionalIndex = pickSettlementHouseTypeIndex(roll, regionId);\n\tif (regionalIndex !== null) return regionalIndex;\n\tconst total = HOUSE_TYPES.reduce((sum, type) => sum + type.weight, 0);\n\tlet cumulative = 0;\n\tfor (let i = 0; i < HOUSE_TYPES.length; i++) {\n\t\tcumulative += HOUSE_TYPES[i].weight / total;\n\t\tif (roll < cumulative) return i;\n\t}\n\treturn HOUSE_TYPES.length - 1;\n}\n",
	'house type picker',
);

replaceOnce(
	"\t\t\t\tconst type = HOUSE_TYPES[pickHouseTypeIndex(rng())];\n",
	"\t\t\t\tconst type = HOUSE_TYPES[pickHouseTypeIndex(rng(), architectureProfile?.id)];\n",
	'regional procedural house selection',
);

replaceOnce(
	"\tgroup.userData.villageArchitectureGeographyPolicy = 'settlement-geography-asset-material-v1-2026-09-07';\n",
	"\tgroup.userData.villageArchitectureGeographyPolicy = 'settlement-geography-asset-material-v1-2026-09-07';\n\tgroup.userData.villageArchitectureHouseTypeMix = 'regional-house-type-mix-v1-2026-09-07';\n",
	'house mix evidence',
);

fs.writeFileSync(targetPath, source);
console.log('[applySettlementHouseMixPatch] PATCH_APPLIED', JSON.stringify({
	version: 'regional-house-type-mix-v1-2026-09-07',
	changedBytes: source.length,
}));