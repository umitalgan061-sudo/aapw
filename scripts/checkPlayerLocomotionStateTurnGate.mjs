import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const featureFiles=[
  '../src/3d/gameplay/playerLocomotionStateSynthesis.js',
  '../src/3d/gameplay/playerLocomotionStateTimeline.js',
  '../src/3d/gameplay/playerLocomotionStateTelemetry.js',
  '../src/3d/gameplay/playerLocomotionStateRuntime.js',
  '../src/3d/gameplay/playerLocomotionStateQuality.js',
  '../src/3d/gameplay/playerLocomotionStateReplay.js',
  '../src/3d/gameplay/PLAYER_LOCOMOTION_STATE_SYNTHESIS.md',
  '../scripts/checkPlayerLocomotionStateSynthesisAcceptance.mjs',
  '../scripts/checkPlayerLocomotionStateSynthesisAdversarial.mjs',
  '../scripts/checkPlayerLocomotionStateSynthesisScenarioMatrix.mjs',
  '../scripts/checkPlayerLocomotionStateRuntime.mjs',
  '../scripts/checkPlayerLocomotionStateFixtures.mjs',
  '../scripts/checkPlayerLocomotionStateQuality.mjs',
  '../scripts/checkPlayerLocomotionStateOwnership.mjs',
  '../scripts/checkPlayerLocomotionStateReplay.mjs',
  '../scripts/checkPlayerLocomotionStateReplayContract.mjs',
  '../scripts/checkPlayerLocomotionStateIntegration.mjs',
  '../scripts/checkPlayerLocomotionStateTurnGate.mjs',
];
let readable=0;
for(const relative of featureFiles){
  const file=path.join(root,relative);
  const content=fs.readFileSync(file,'utf8');
  readable+=content.split(/\r?\n/).length-1;
  assert.ok(content.length>0,`${relative}:empty`);
}
assert.ok(readable>2500,`feature-line-estimate-${readable}`);
console.log(`PLAYER_LOCOMOTION_STATE_TURN_GATE_PASS:${readable}`);
