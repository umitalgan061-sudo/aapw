#!/usr/bin/env node
import assert from 'node:assert/strict';
import { classifyPart, surveyParts, tokenize } from '../src/3d/materials/meshPartClassifier.js';
import { FIGURE_KITS, kitForPalette, resolveKit } from '../src/3d/materials/figureKits.js';
import { findPalette } from '../src/3d/materials/palettes.js';
import {
	VILLAGE_ARCHITECTURE_PROFILES,
	resolveVillageArchitectureSurfacePalette,
} from '../src/3d/world/villages.js';

// Strong authored structure semantics belong in the shared classifier because they identify a real
// architectural role rather than merely naming a substance. These are safe for every shared caller.
const STRUCTURE_CASES = [
	{ meshName: 'House_Roof_Tiles', materialName: 'RoofTile_Clay', slot: 'structure-roof' },
	{ meshName: 'Cottage_Thatch', materialName: 'Thatched_Roof', slot: 'structure-thatch' },
	{ meshName: 'House_Window_Frame', materialName: 'Window_Glass', slot: 'structure-window' },
	{ meshName: 'Cabin_Door', materialName: 'Oak_Door', slot: 'structure-door' },
	{ meshName: 'Timber_Frame', materialName: 'Wooden_Beam', slot: 'structure-timber' },
	{ meshName: 'Stone_Footing', materialName: 'Masonry_Foundation', slot: 'structure-stone' },
	{ meshName: 'Brick_Chimney', materialName: 'Brickwork', slot: 'structure-brick' },
	{ meshName: 'Plaster_Facade', materialName: 'Stucco', slot: 'structure-plaster' },
	{ meshName: 'Door_Hardware', materialName: 'Wrought_Iron_Hinge', slot: 'structure-metal' },
	{ meshName: 'Ev_Cati', materialName: 'Kiremit', slot: 'structure-roof' },
	{ meshName: 'Ahsap_Kiris', materialName: 'Tahta', slot: 'structure-timber' },
	{ meshName: 'Kapi', materialName: 'Kapi', slot: 'structure-door' },
	{ meshName: 'Pencere', materialName: 'Vitray', slot: 'structure-window' },
];

for (const testCase of STRUCTURE_CASES) {
	const match = classifyPart(testCase);
	assert(match, `expected authored structure match for ${JSON.stringify(testCase)}`);
	assert.equal(match.slot, testCase.slot, `${testCase.materialName || testCase.meshName}: wrong structure slot`);
	assert(match.score > 0, `${testCase.slot}: semantic match must carry positive confidence`);
}

// Material names are the artist's stronger semantic signal. A Window_Glass material on a generic
// roof-labelled mesh must stay glass instead of being flattened into the roof palette.
assert.equal(
	classifyPart({ meshName: 'House_Roof', materialName: 'Window_Glass' })?.slot,
	'structure-window',
	'artist material semantics must outrank a competing mesh name',
);

// Real village GLBs frequently expose useful substance slots under a mesh that is explicitly a
// house but do not repeat the architectural role in every material name. In that bounded context,
// exact physical substances are safe signals and should receive destination-region PBR treatment.
const CONTEXTUAL_HOUSE_CASES = [
	{ meshName: 'House_2', materialName: 'Wood', slot: 'structure-timber' },
	{ meshName: 'House_2', materialName: 'Wood_Light', slot: 'structure-timber' },
	{ meshName: 'House_2', materialName: 'Wood_Side', slot: 'structure-timber' },
	{ meshName: 'House_2', materialName: 'Stone', slot: 'structure-stone' },
	{ meshName: 'House_2', materialName: 'Stone_Dark', slot: 'structure-stone' },
	{ meshName: 'House_2', materialName: 'Stone_Light', slot: 'structure-stone' },
	{ meshName: 'CottageShell', materialName: 'Glass', slot: 'structure-window' },
	{ meshName: 'CabinShell', materialName: 'Iron', slot: 'structure-metal' },
];
for (const testCase of CONTEXTUAL_HOUSE_CASES) {
	const match = classifyPart(testCase);
	assert(match, `expected bounded house-context match for ${JSON.stringify(testCase)}`);
	assert.equal(match.slot, testCase.slot, `${testCase.materialName}: wrong contextual structure slot`);
}

// Bare substances remain fail-closed everywhere that the mesh does not independently establish a
// building context. This is the ownership boundary that protects carts, vegetation and equipment.
const FAIL_CLOSED_CASES = [
	{ meshName: 'CartShell', materialName: 'Wood' },
	{ meshName: 'PropShell', materialName: 'Stone' },
	{ meshName: 'DisplayCase', materialName: 'Glass' },
	{ meshName: 'ToolHead', materialName: 'Iron' },
	{ meshName: 'GenericMesh', materialName: 'Metal' },
	{ meshName: 'House_Wall', materialName: 'Wall' },
	{ meshName: 'House', materialName: 'Surface' },
	{ meshName: 'Building', materialName: 'Material' },
	{ meshName: 'Mesh_02', materialName: 'Material_04' },
];
for (const generic of FAIL_CLOSED_CASES) {
	assert.equal(classifyPart(generic), null, `ambiguous surface must preserve imported material: ${JSON.stringify(generic)}`);
}

// Existing high-priority creature/human vocabulary must still win when an equipment mesh itself
// carries a structural-looking word. This prevents the village work from rewriting other agents'
// character/equipment material semantics.
assert.equal(classifyPart({ meshName: 'Paladin_Helmet', materialName: 'Steel_Plate' })?.slot, 'helmet');
assert.equal(classifyPart({ meshName: 'Knight_Shield', materialName: 'Wooden_Plank' })?.slot, 'armor');
assert.equal(classifyPart({ meshName: 'Knight_Sword', materialName: 'Iron' })?.slot, 'armor');
assert.equal(classifyPart({ meshName: 'Wolf3_teeth', materialName: 'Wolf Teeth' })?.slot, 'tooth');
assert.equal(classifyPart({ meshName: 'GameDragonWing', materialName: 'Wing_Membrane' })?.slot, 'wing');
assert.equal(classifyPart({ meshName: 'HumanBody', materialName: 'Skin' })?.slot, 'skin');

assert.deepEqual(tokenize('OldHouse_RoofTiles02'), ['old', 'house', 'roof', 'tiles']);
assert.deepEqual(tokenize('Pencere-Cam_04'), ['pencere', 'cam']);

const fakeMesh = {
	isMesh: true,
	isInstancedMesh: false,
	name: 'Authored_House',
	material: [
		{ name: 'Roof_Tile' },
		{ name: 'Window_Glass' },
		{ name: 'Oak_Door' },
		{ name: 'Wooden_Beam' },
		{ name: 'Wood' },
		{ name: 'Stone' },
		{ name: 'Wall_Material' },
	],
};
const fakeRoot = {
	traverse(callback) { callback(fakeMesh); },
};
const survey = surveyParts(fakeRoot);
assert.equal(survey.length, 7, 'multi-material architecture must be surveyed per material slot');
assert.deepEqual(
	survey.map((surface) => surface.slot),
	['structure-roof', 'structure-window', 'structure-door', 'structure-timber', 'structure-timber', 'structure-stone', null],
	'authored building slots and bounded house substances must remain physically distinct',
);
assert.deepEqual(survey.map((surface) => surface.materialIndex), [0, 1, 2, 3, 4, 5, 6]);

const housePaletteIds = ['house', 'brick', 'plaster', 'thatch', 'roof-tile'];
for (const paletteId of housePaletteIds) {
	const palette = findPalette(paletteId);
	assert(palette, `missing palette fixture: ${paletteId}`);
	assert.equal(kitForPalette(palette)?.id, 'house', `${paletteId}: architecture palette must resolve the house kit`);
}

const house = FIGURE_KITS.house;
assert(house, 'house material kit missing');
assert.deepEqual(
	{
		window: house.slots['structure-window'],
		door: house.slots['structure-door'],
		thatch: house.slots['structure-thatch'],
		roof: house.slots['structure-roof'],
		brick: house.slots['structure-brick'],
		plaster: house.slots['structure-plaster'],
		stone: house.slots['structure-stone'],
		timber: house.slots['structure-timber'],
		metal: house.slots['structure-metal'],
	},
	{
		window: 'glass',
		door: 'wood',
		thatch: 'thatch',
		roof: 'roof-tile',
		brick: 'brick',
		plaster: 'plaster',
		stone: 'stone',
		timber: 'wood',
		metal: 'iron',
	},
	'house kit must map semantic slots to physically distinct PBR palette families',
);

const resolved = resolveKit(house, 0xA11CE);
for (const [slot, paletteId] of Object.entries(house.slots)) {
	assert.equal(resolved.slots[slot], paletteId, `${slot}: architecture slot must not vary nondeterministically`);
	assert(findPalette(paletteId), `${slot}: mapped palette does not exist: ${paletteId}`);
}
assert.equal(resolved.base, 'house', 'house base façade must remain the kit base when no skin slot exists');
assert(house.bands.length >= 4, 'single-mesh architecture fallback must retain multi-surface vertical PBR bands');
assert.equal(house.bands.at(-1)?.to, 1, 'house fallback must cover the complete mesh height');

const EXPECTED_REGION_SURFACES = Object.freeze({
	north: { roof: 'roof-tile', stone: 'stone', brick: 'stone', plaster: 'house' },
	fertile: { roof: 'thatch', stone: 'stone', brick: 'plaster', plaster: 'plaster' },
	maritime: { roof: 'roof-tile', stone: 'rock', brick: 'rock', plaster: 'house' },
	arid: { roof: 'roof-tile', stone: 'stone', brick: 'plaster', plaster: 'plaster' },
	mountain: { roof: 'roof-tile', stone: 'rock', brick: 'brick', plaster: 'brick' },
	temperate: { roof: 'thatch', stone: 'stone', brick: 'stone', plaster: 'house' },
	volcanic: { roof: 'roof-tile', stone: 'rock', brick: 'brick', plaster: 'brick' },
});

const regionalProof = [];
for (const [regionId, expected] of Object.entries(EXPECTED_REGION_SURFACES)) {
	const profile = VILLAGE_ARCHITECTURE_PROFILES[regionId];
	assert(profile, `missing village architecture profile: ${regionId}`);
	const actual = {
		roof: resolveVillageArchitectureSurfacePalette(profile, 'structure-roof'),
		stone: resolveVillageArchitectureSurfacePalette(profile, 'structure-stone'),
		brick: resolveVillageArchitectureSurfacePalette(profile, 'structure-brick'),
		plaster: resolveVillageArchitectureSurfacePalette(profile, 'structure-plaster'),
		window: resolveVillageArchitectureSurfacePalette(profile, 'structure-window'),
		door: resolveVillageArchitectureSurfacePalette(profile, 'structure-door'),
		timber: resolveVillageArchitectureSurfacePalette(profile, 'structure-timber'),
		metal: resolveVillageArchitectureSurfacePalette(profile, 'structure-metal'),
		thatch: resolveVillageArchitectureSurfacePalette(profile, 'structure-thatch'),
	};
	assert.deepEqual(
		{ roof: actual.roof, stone: actual.stone, brick: actual.brick, plaster: actual.plaster },
		expected,
		`${regionId}: masonry/roof semantics must follow destination geography`,
	);
	assert.equal(actual.window, 'glass');
	assert.equal(actual.door, 'wood');
	assert.equal(actual.timber, 'wood');
	assert.equal(actual.metal, 'iron');
	assert.equal(actual.thatch, 'thatch');
	for (const paletteId of Object.values(actual)) assert(findPalette(paletteId), `${regionId}: unknown regional surface palette ${paletteId}`);
	assert.equal(resolveVillageArchitectureSurfacePalette(profile, 'unknown-slot'), null, `${regionId}: unknown slots must fail closed`);
	regionalProof.push({ regionId, ...actual });
}

assert.equal(new Set(regionalProof.map((entry) => entry.roof)).size, 2, 'regional roof identity must distinguish thatch from tile families');
assert.equal(new Set(regionalProof.map((entry) => entry.stone)).size, 2, 'regional foundations must distinguish stone from rock families');
assert.equal(new Set(regionalProof.map((entry) => entry.brick)).size, 4, 'regional masonry must retain distinct brick/plaster/rock/stone identities');

console.log('ARCHITECTURE_SURFACE_SEMANTICS_PASS', JSON.stringify({
	classifiedCases: STRUCTURE_CASES.length,
	contextualHouseCases: CONTEXTUAL_HOUSE_CASES.length,
	failClosedCases: FAIL_CLOSED_CASES.length,
	surveySlots: survey.map((surface) => surface.slot),
	houseSlots: house.slots,
	fallbackBands: house.bands,
	regionalProof,
}));
