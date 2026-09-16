import assert from 'node:assert/strict';
import { resolvePlayerMotionPresentation } from '../src/3d/gameplay/playerMotionPresentationPolicy.js';
import { replayPlayerMotionInputs, comparePlayerMotionReplays } from '../src/3d/gameplay/playerMotionPresentationReplay.js';
import { processTraversalPresentationBatch } from '../src/3d/gameplay/playerTraversalPresentationBatch.js';

const base={planarSpeedMps:3,traversalWeight:.8,traversalForwardDistance:1.4,deltaSeconds:1/60,velocity:{x:0,y:1},facing:{x:0,y:1}};
const variants=[
 {...base},
 {...base, surfaceConfidence:.2},
 {...base, surfaceConfidence:.9},
 {...base, directionShiftDegrees:35},
 {...base, landingImpactMps:1.3, elapsedSeconds:.1},
 {...base, traversalBlocked:true},
 {...base, cancelRequested:true},
 {...base, traversalHeight:1.2, grounded:false},
 {...base, traversalHeight:-1, grounded:false},
];
for(const input of variants){const a=resolvePlayerMotionPresentation(null,input);const b=resolvePlayerMotionPresentation(null,input);assert.equal(JSON.stringify(a),JSON.stringify(b));}
const replayA=replayPlayerMotionInputs(variants);const replayB=replayPlayerMotionInputs(variants);assert.equal(comparePlayerMotionReplays(replayA,replayB),true);
const batch=processTraversalPresentationBatch(variants);assert.equal(batch.timelineValid,true);
console.log(`presentation determinism matrix passed: ${variants.length} variants`);
