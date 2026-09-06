import assert from 'node:assert/strict';
import fs from 'node:fs';

const villagesPath = 'src/3d/world/villages.js';
const economyPath = 'src/3d/gameplay/interactionEconomy.js';
const assetPath = 'assets/models/settlements/blacksmith_bV52eTG1Aj.glb';
const villages = fs.readFileSync(villagesPath, 'utf8');
const economy = fs.readFileSync(economyPath, 'utf8');

assert.ok(fs.existsSync(assetPath), 'asset-first blacksmith GLB must remain tracked');
const stat = fs.statSync(assetPath);
assert.ok(stat.size > 0, 'blacksmith GLB entry must not be empty');
const prefix = fs.readFileSync(assetPath).subarray(0, Math.min(stat.size, 160)).toString('utf8');
const lfsPointer = prefix.startsWith('version https://git-lfs.github.com/spec/v1');
if (!lfsPointer) {
	const magic = fs.readFileSync(assetPath).subarray(0, 4).toString('ascii');
	assert.equal(magic, 'glTF', 'hydrated blacksmith asset must be a binary GLB');
}

assert.match(economy, /id:\s*'dragonstone-whetstone'/, 'canonical whetstone offer must remain present');
assert.match(economy, /kind:\s*'settlement-service'/, 'whetstone must remain a settlement service');
assert.match(economy, /serviceId:\s*'dragonstone-watch-armorer-honing'/, 'armorer service id must remain canonical');
assert.match(economy, /stationId:\s*'dragonstone-armorer-bench'/, 'armorer station id must remain canonical');
assert.match(economy, /discipline:\s*'smithing'/, 'armorer service must remain smithing-owned');
assert.match(economy, /recipeId:\s*'dragonstone-expedition-maintenance-kit'/, 'smithing upgrade recipe must remain canonical');

assert.match(villages, /MaterialAssignmentCore\.js/, 'settlement runtime must keep shared material authority');
assert.match(villages, /WorldAssetPlacementPipeline\.js/, 'settlement runtime must keep shared placement authority');
assert.doesNotMatch(villages, /EditorMaterialStudio/, 'runtime must not import editor material UI');
assert.match(villages, /footprintGrounding:\s*'always'/, 'settlement assets must remain footprint-grounded');
assert.match(villages, /requireSurfaceContext:\s*true/, 'settlement assets must require surface context');

// This guard intentionally defines the next playable blacksmith slice without pretending the
// residential architecture PR has already shipped it. Once production wiring lands, the asset
// literal must live in villages.js together with canonical station/service metadata so a decorative
// blacksmith cannot silently diverge from the existing RPG economy contract.
const hasBlacksmithRuntime = villages.includes(assetPath);
const hasStationBinding = villages.includes('dragonstone-armorer-bench');
const hasServiceBinding = villages.includes('dragonstone-watch-armorer-honing');
assert.equal(hasStationBinding, hasBlacksmithRuntime,
	'blacksmith asset runtime adoption must atomically bind dragonstone-armorer-bench');
assert.equal(hasServiceBinding, hasBlacksmithRuntime,
	'blacksmith asset runtime adoption must atomically bind dragonstone-watch-armorer-honing');

console.log(JSON.stringify({
	status: 'PASS',
	assetPath,
	assetState: lfsPointer ? 'tracked-lfs-pointer' : 'hydrated-glb',
	canonicalStationId: 'dragonstone-armorer-bench',
	canonicalServiceId: 'dragonstone-watch-armorer-honing',
	canonicalRecipeId: 'dragonstone-expedition-maintenance-kit',
	runtimeBlacksmithAdopted: hasBlacksmithRuntime,
	sharedMaterialPlacementAuthority: true,
}));
