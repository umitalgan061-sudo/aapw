#!/usr/bin/env node
import assert from 'node:assert/strict';
import { classifyPart } from '../src/3d/materials/meshPartClassifier.js';

const CASES = [
	{ meshName: 'House_Window_Frame', materialName: 'Oak_Frame' },
	{ meshName: 'CottageWindowFrame', materialName: 'Wood' },
	{ meshName: 'Ev_Pencere_Cerceve', materialName: 'Ahsap' },
	{ meshName: 'Ev_Pencere_Çerçeve', materialName: 'Surface' },
];

for (const input of CASES) {
	const match = classifyPart(input);
	assert(match, `expected a structural window-frame classification: ${JSON.stringify(input)}`);
	assert.equal(match.slot, 'structure-timber', `window frame must stay timber, not glazing: ${JSON.stringify(input)}`);
}

assert.equal(
	classifyPart({ meshName: 'House_Window', materialName: 'Window_Glass' })?.slot,
	'structure-window',
	'actual glazing must remain glass',
);
assert.equal(
	classifyPart({ meshName: 'Cart_Frame', materialName: 'Wood' }),
	null,
	'bare non-building frame must remain fail-closed',
);

console.log('VILLAGE_WINDOW_FRAME_SEMANTICS_PASS', JSON.stringify({ checked: CASES.length, glazingPreserved: true, genericFrameFailClosed: true }));
