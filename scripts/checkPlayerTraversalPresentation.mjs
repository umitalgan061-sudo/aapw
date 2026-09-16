import assert from 'node:assert/strict';
import { buildPlayerTraversalPresentationState, normalizePlayerTraversalPresentationCue } from '../src/3d/gameplay/playerTraversalPresentationPolicy.js';
import { PLAYER_TRAVERSAL_PRESENTATION_FIXTURES } from '../src/3d/gameplay/fixtures/playerTraversalPresentationFixtures.js';
import { createPlayerTraversalPresentationContract, validatePlayerTraversalPresentationContract } from '../src/3d/gameplay/playerTraversalPresentationContract.js';

for (const fixture of PLAYER_TRAVERSAL_PRESENTATION_FIXTURES) {
  const normalized = normalizePlayerTraversalPresentationCue(fixture.cue);
  const state = buildPlayerTraversalPresentationState(null, normalized);
  assert.equal(state.state, fixture.expect.state, fixture.id);
  if (fixture.expect.phase) assert.equal(state.phase, fixture.expect.phase, fixture.id);
  if (fixture.expect.event) assert.equal(state.event, fixture.expect.event, fixture.id);
  if (fixture.expect.technique) assert.equal(state.technique, fixture.expect.technique, fixture.id);
  const contract = createPlayerTraversalPresentationContract(state);
  assert.equal(validatePlayerTraversalPresentationContract(contract).valid, true, fixture.id);
}
console.log(`player traversal presentation: ${PLAYER_TRAVERSAL_PRESENTATION_FIXTURES.length} fixtures passed`);
