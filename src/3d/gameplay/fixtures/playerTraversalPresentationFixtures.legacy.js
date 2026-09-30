/**
 * Traversal presentation fixture corpus.
 *
 * Fixtures are intentionally explicit instead of generated at runtime. They act as a stable contract
 * for edge cases encountered by animation/audio/VFX consumers and make regressions reviewable in diffs.
 */
export const PLAYER_TRAVERSAL_PRESENTATION_FIXTURES = Object.freeze([
  { id:'idle-clear', cue:{ traversalWeight:0 }, expect:{ state:'clear', phase:'idle' } },
  { id:'approach-far-low', cue:{ traversalWeight:0.3, traversalForwardDistance:6 }, expect:{ state:'approach' } },
  { id:'approach-near', cue:{ traversalWeight:0.55, traversalForwardDistance:3 }, expect:{ state:'approach' } },
  { id:'prepare-middle', cue:{ traversalWeight:0.65, traversalForwardDistance:2.3 }, expect:{ state:'prepare' } },
  { id:'prepare-surface', cue:{ traversalWeight:0.8, traversalForwardDistance:2.1, surfaceConfidence:0.75 }, expect:{ state:'prepare' } },
  { id:'vault-close', cue:{ traversalWeight:0.9, traversalForwardDistance:1.2 }, expect:{ state:'vault', technique:'vault' } },
  { id:'vault-commit', cue:{ traversalWeight:1, traversalForwardDistance:0.9 }, expect:{ state:'vault' } },
  { id:'climb-low', cue:{ traversalWeight:0.8, traversalForwardDistance:1.7, traversalHeight:1.1, grounded:false }, expect:{ state:'climb', technique:'climb' } },
  { id:'climb-high', cue:{ traversalWeight:0.9, traversalForwardDistance:1.3, traversalHeight:2.5, grounded:false }, expect:{ state:'climb' } },
  { id:'drop-small', cue:{ traversalWeight:0.8, traversalForwardDistance:1.5, traversalHeight:-0.7, grounded:false }, expect:{ state:'drop', technique:'drop' } },
  { id:'drop-deep', cue:{ traversalWeight:0.95, traversalForwardDistance:0.8, traversalHeight:-2, grounded:false }, expect:{ state:'drop' } },
  { id:'land-soft', cue:{ traversalWeight:0.5, landingImpactMps:1.4, elapsedSeconds:0.1, grounded:true }, expect:{ state:'land', event:'land-soft' } },
  { id:'land-hard', cue:{ traversalWeight:0.8, landingImpactMps:5.5, elapsedSeconds:0.1, grounded:true }, expect:{ state:'land', event:'land-hard' } },
  { id:'blocked-high', cue:{ traversalWeight:0.9, traversalBlocked:true }, expect:{ state:'blocked' } },
  { id:'blocked-low', cue:{ traversalWeight:0.2, traversalBlocked:true }, expect:{ state:'blocked' } },
  { id:'cancel', cue:{ traversalWeight:0.9, traversalForwardDistance:1.4, cancelRequested:true }, expect:{ state:'cancelled' } },
  { id:'confidence-low', cue:{ traversalWeight:0.8, traversalForwardDistance:1.4, surfaceConfidence:0.1 }, expect:{ state:'vault' } },
  { id:'width-large', cue:{ traversalWeight:0.8, traversalForwardDistance:1.4, traversalWidth:4 }, expect:{ state:'vault' } },
  { id:'speed-zero', cue:{ traversalWeight:0.5, traversalForwardDistance:2.2, planarSpeedMps:0 }, expect:{ state:'prepare' } },
  { id:'speed-fast', cue:{ traversalWeight:0.8, traversalForwardDistance:1.5, planarSpeedMps:8 }, expect:{ state:'vault' } },
  { id:'surface-unknown', cue:{ traversalWeight:0.4, traversalForwardDistance:5, surfaceId:'unknown' }, expect:{ state:'approach' } },
  { id:'direction-change', cue:{ traversalWeight:0.7, traversalForwardDistance:2.2, directionShiftDegrees:40 }, expect:{ state:'prepare' } },
  { id:'negative-distance', cue:{ traversalWeight:0.7, traversalForwardDistance:-20 }, expect:{ state:'vault' } },
  { id:'negative-height', cue:{ traversalWeight:0.7, traversalForwardDistance:2, traversalHeight:-3, grounded:false }, expect:{ state:'drop' } },
  { id:'huge-height', cue:{ traversalWeight:0.7, traversalForwardDistance:2, traversalHeight:20, grounded:false }, expect:{ state:'climb' } },
  { id:'huge-weight', cue:{ traversalWeight:4, traversalForwardDistance:3 }, expect:{ state:'approach' } },
  { id:'nan-cue', cue:{ traversalWeight:'NaN', traversalForwardDistance:'bad' }, expect:{ state:'clear' } },
  { id:'string-number', cue:{ traversalWeight:'0.8', traversalForwardDistance:'1.4' }, expect:{ state:'vault' } },
  { id:'soft-contact', cue:{ traversalWeight:0.6, traversalForwardDistance:1.3, footPlantConfidence:0.8 }, expect:{ state:'vault' } },
  { id:'un-grounded-no-height', cue:{ traversalWeight:0.6, traversalForwardDistance:1.3, grounded:false }, expect:{ state:'drop' } },
  { id:'un-grounded-positive', cue:{ traversalWeight:0.6, traversalForwardDistance:2, traversalHeight:1, grounded:false }, expect:{ state:'climb' } },
  { id:'cancel-over-block', cue:{ traversalWeight:0.9, traversalBlocked:true, cancelRequested:true }, expect:{ state:'cancelled' } },
  { id:'land-over-block', cue:{ traversalWeight:0.9, traversalBlocked:true, landingImpactMps:5 }, expect:{ state:'blocked' } },
  { id:'clear-after-zero', cue:{ traversalWeight:0 }, expect:{ state:'clear', phase:'idle' } },
  { id:'approach-boundary', cue:{ traversalWeight:0.5, traversalForwardDistance:2.76 }, expect:{ state:'approach' } },
  { id:'prepare-boundary', cue:{ traversalWeight:0.5, traversalForwardDistance:2.74 }, expect:{ state:'prepare' } },
  { id:'vault-boundary', cue:{ traversalWeight:0.5, traversalForwardDistance:1.89 }, expect:{ state:'vault' } },
  { id:'climb-boundary', cue:{ traversalWeight:0.5, traversalForwardDistance:2.2, traversalHeight:0.96, grounded:true }, expect:{ state:'climb' } },
  { id:'drop-boundary', cue:{ traversalWeight:0.5, traversalForwardDistance:2.2, traversalHeight:-0.56, grounded:true }, expect:{ state:'drop' } },
  { id:'airborne-neutral', cue:{ traversalWeight:0.5, traversalForwardDistance:3, traversalHeight:0, grounded:false }, expect:{ state:'drop' } },
  { id:'airborne-climb', cue:{ traversalWeight:0.5, traversalForwardDistance:3, traversalHeight:1.1, grounded:false }, expect:{ state:'climb' } },
  { id:'airborne-drop', cue:{ traversalWeight:0.5, traversalForwardDistance:3, traversalHeight:-1, grounded:false }, expect:{ state:'drop' } },
  { id:'impact-max', cue:{ traversalWeight:0.8, landingImpactMps:9, elapsedSeconds:0.1, grounded:true }, expect:{ state:'land' } },
  { id:'impact-min', cue:{ traversalWeight:0.8, landingImpactMps:0, elapsedSeconds:0.1, grounded:true }, expect:{ state:'vault' } },
  { id:'surface-zero', cue:{ traversalWeight:0.8, traversalForwardDistance:1.4, surfaceConfidence:0 }, expect:{ state:'vault' } },
  { id:'surface-one', cue:{ traversalWeight:0.8, traversalForwardDistance:1.4, surfaceConfidence:1 }, expect:{ state:'vault' } },
  { id:'contact-zero', cue:{ traversalWeight:0.8, traversalForwardDistance:1.4, footPlantConfidence:0 }, expect:{ state:'vault' } },
  { id:'contact-one', cue:{ traversalWeight:0.8, traversalForwardDistance:1.4, footPlantConfidence:1 }, expect:{ state:'vault' } },
  { id:'width-zero', cue:{ traversalWeight:0.8, traversalForwardDistance:1.4, traversalWidth:0 }, expect:{ state:'vault' } },
  { id:'width-clamped', cue:{ traversalWeight:0.8, traversalForwardDistance:1.4, traversalWidth:30 }, expect:{ state:'vault' } },
  { id:'delta-small', cue:{ traversalWeight:0.8, traversalForwardDistance:1.4, deltaSeconds:0.001 }, expect:{ state:'vault' } },
  { id:'delta-large', cue:{ traversalWeight:0.8, traversalForwardDistance:1.4, deltaSeconds:2 }, expect:{ state:'vault' } },
  { id:'elapsed-large', cue:{ traversalWeight:0.8, traversalForwardDistance:1.4, elapsedSeconds:60 }, expect:{ state:'vault' } },
  { id:'surface-label', cue:{ traversalWeight:0.8, traversalForwardDistance:1.4, surfaceId:'stone' }, expect:{ state:'vault' } },
  { id:'obstacle-label', cue:{ traversalWeight:0.8, traversalForwardDistance:1.4, obstacleId:'wall-3' }, expect:{ state:'vault' } },
]);

export const PLAYER_TRAVERSAL_PRESENTATION_SEQUENCE_FIXTURES = Object.freeze([
  { id:'approach-to-prepare', cues:[
    { traversalWeight:0.3, traversalForwardDistance:5 },
    { traversalWeight:0.7, traversalForwardDistance:2.5 },
  ], expect:['approach','prepare'] },
  { id:'prepare-to-vault', cues:[
    { traversalWeight:0.6, traversalForwardDistance:2.5 },
    { traversalWeight:0.9, traversalForwardDistance:1.2 },
  ], expect:['prepare','vault'] },
  { id:'vault-to-land', cues:[
    { traversalWeight:0.9, traversalForwardDistance:1.2 },
    { traversalWeight:0.2, landingImpactMps:2, elapsedSeconds:0.1 },
  ], expect:['vault','land'] },
  { id:'blocked-recovery', cues:[
    { traversalWeight:0.9, traversalBlocked:true },
    { traversalWeight:0 },
  ], expect:['blocked','clear'] },
  { id:'cancelled-terminal', cues:[
    { traversalWeight:0.9, traversalForwardDistance:1.2, cancelRequested:true },
    { traversalWeight:0 },
  ], expect:['cancelled','clear'] },
]);

export function getTraversalPresentationFixture(id) {
  return PLAYER_TRAVERSAL_PRESENTATION_FIXTURES.find((fixture) => fixture.id === id) ?? null;
}

export function listTraversalPresentationFixtureIds() {
  return Object.freeze(PLAYER_TRAVERSAL_PRESENTATION_FIXTURES.map((fixture) => fixture.id));
}
