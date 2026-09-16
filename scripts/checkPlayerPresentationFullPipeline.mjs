import assert from 'node:assert/strict';
import { resolvePlayerMotionPresentation, validatePlayerMotionPresentation } from '../src/3d/gameplay/playerMotionPresentationPolicy.js';
import { createPlayerPresentationOrchestrator } from '../src/3d/gameplay/playerMotionPresentationOrchestrator.js';
import { createPlayerMotionPresentationIntegration } from '../src/3d/gameplay/playerMotionPresentationIntegration.js';
import { buildPlayerTraversalPresentationState } from '../src/3d/gameplay/playerTraversalPresentationPolicy.js';
import { resolveTraversalContactPresentation, validateTraversalContactPresentation } from '../src/3d/gameplay/playerTraversalPresentationContactPolicy.js';
import { buildTraversalPresentationEventIntent } from '../src/3d/gameplay/playerTraversalPresentationEventPolicy.js';
import { buildTraversalPresentationBatchReport } from '../src/3d/gameplay/playerTraversalPresentationBatchReport.js';

const cues=[
 {planarSpeedMps:0,traversalWeight:0,deltaSeconds:1/60,velocity:{x:0,y:1},facing:{x:0,y:1}},
 {planarSpeedMps:3,traversalWeight:.7,traversalForwardDistance:2.4,deltaSeconds:1/60,velocity:{x:0,y:1},facing:{x:0,y:1}},
 {planarSpeedMps:4,traversalWeight:.9,traversalForwardDistance:1.2,deltaSeconds:1/60,velocity:{x:0,y:1},facing:{x:0,y:1}},
 {planarSpeedMps:0,traversalWeight:.2,landingImpactMps:2,elapsedSeconds:.1,deltaSeconds:1/60,velocity:{x:0,y:1},facing:{x:0,y:1}},
];
let previous=null;
for(const cue of cues){const packet=resolvePlayerMotionPresentation(previous,cue);assert.equal(validatePlayerMotionPresentation(packet).valid,true);assert.ok(packet.audio.intensity<=1);assert.ok(packet.vfx.weight<=1);const contact=resolveTraversalContactPresentation(packet.state.traversal);assert.equal(validateTraversalContactPresentation(contact).valid,true);assert.ok(buildTraversalPresentationEventIntent(packet.state.traversal).priority>=0);previous=packet.state;}
const orchestrator=createPlayerPresentationOrchestrator();for(const cue of cues)assert.ok(orchestrator.update(cue).packet);
const integration=createPlayerMotionPresentationIntegration();for(const cue of cues)assert.ok(integration.update(cue).health);
const report=buildTraversalPresentationBatchReport(cues);assert.equal(report.timelineValid,true);assert.ok(report.averageQuality>=0&&report.averageQuality<=1);
console.log('full player presentation pipeline passed');
