import assert from 'node:assert/strict';
import { buildPlayerTraversalPresentationState } from '../src/3d/gameplay/playerTraversalPresentationPolicy.js';
import { normalizeTraversalPresentationShape, validateTraversalPresentationShape, equivalentTraversalPresentationShape } from '../src/3d/gameplay/playerTraversalPresentationSchema.js';
const states=['clear','approach','prepare','vault','climb','drop','land','blocked','recover','cancelled'];
for(const state of states){
 const p=buildPlayerTraversalPresentationState(null,state==='clear'?{traversalWeight:0}:{traversalWeight:.8,traversalForwardDistance:1.4});
 const n=normalizeTraversalPresentationShape({...p,state});
 assert.equal(validateTraversalPresentationShape(n).valid,true,state);
 assert.equal(equivalentTraversalPresentationShape(n,normalizeTraversalPresentationShape(n)),true,state);
}
assert.equal(validateTraversalPresentationShape({}).valid,false);
console.log('traversal presentation schema passed');
