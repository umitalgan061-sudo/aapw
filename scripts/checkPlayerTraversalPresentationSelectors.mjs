import assert from 'node:assert/strict';
import { buildPlayerTraversalPresentationState } from '../src/3d/gameplay/playerTraversalPresentationPolicy.js';
import { selectTraversalPresentationSummary, selectTraversalAnimationFrame, selectTraversalAudioFrame, selectTraversalVfxFrame } from '../src/3d/gameplay/playerTraversalPresentationSelectors.js';
const samples=[
 {traversalWeight:0},
 {traversalWeight:.3,traversalForwardDistance:5},
 {traversalWeight:.7,traversalForwardDistance:2.3},
 {traversalWeight:.9,traversalForwardDistance:1.2},
 {traversalWeight:.9,traversalForwardDistance:1.2,traversalHeight:1.2,grounded:false},
 {traversalWeight:.9,traversalForwardDistance:1.2,traversalHeight:-1,grounded:false},
 {traversalWeight:.7,landingImpactMps:2,elapsedSeconds:.1},
 {traversalWeight:.7,traversalBlocked:true},
 {traversalWeight:.7,cancelRequested:true},
];
for(const cue of samples){const p=buildPlayerTraversalPresentationState(null,cue);const s=selectTraversalPresentationSummary(p);const a=selectTraversalAnimationFrame(p);const au=selectTraversalAudioFrame(p);const v=selectTraversalVfxFrame(p);assert.equal(typeof s.active,'boolean');assert.ok(a.weight>=0&&a.weight<=1);assert.ok(typeof au.event==='string');assert.ok(typeof v.state==='string');}
console.log(`traversal presentation selectors passed: ${samples.length}`);
