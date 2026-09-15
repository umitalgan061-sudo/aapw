import assert from 'node:assert/strict';
import { resolveTraversalContactBand, resolveTraversalContactPresentation, resolveTraversalContactAnimationEmphasis, resolveTraversalContactAudioEmphasis, resolveTraversalContactVfxEmphasis, validateTraversalContactPresentation } from '../src/3d/gameplay/playerTraversalPresentationContactPolicy.js';
const bands=[[0,'none'],[1.19,'none'],[1.2,'soft'],[4.49,'soft'],[4.5,'hard'],[9,'hard'],[99,'hard']];
for(const [impact,expected] of bands)assert.equal(resolveTraversalContactBand(impact).label,expected);
for(const impact of [0,1.2,2,4.5,8]){const p=resolveTraversalContactPresentation({state:impact?'land':'clear',metrics:{impact,footContactConfidence:.8},channels:{contact:.5},event:'land-soft'});assert.equal(validateTraversalContactPresentation(p).valid,true);assert.ok(p.weight>=0&&p.weight<=1);assert.ok(resolveTraversalContactAnimationEmphasis(p).recoil<=1);assert.ok(resolveTraversalContactAudioEmphasis(p).intensity<=1);assert.ok(resolveTraversalContactVfxEmphasis(p).dust<=1);}
console.log('traversal contact presentation passed');
