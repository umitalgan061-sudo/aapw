/**
 * Scenario builders for traversal presentation regression coverage.
 * Each scenario is a sequence of explicit input snapshots and expected semantic states.
 */
export const PLAYER_TRAVERSAL_SCENARIOS = Object.freeze([
  {id:'far-approach',steps:[{traversalWeight:.25,traversalForwardDistance:6},{traversalWeight:.35,traversalForwardDistance:4}],states:['approach','approach']},
  {id:'approach-prepare',steps:[{traversalWeight:.4,traversalForwardDistance:4},{traversalWeight:.7,traversalForwardDistance:2.4}],states:['approach','prepare']},
  {id:'prepare-vault',steps:[{traversalWeight:.7,traversalForwardDistance:2.3},{traversalWeight:.9,traversalForwardDistance:1.4}],states:['prepare','vault']},
  {id:'vault-land-soft',steps:[{traversalWeight:.9,traversalForwardDistance:1.4},{traversalWeight:.2,landingImpactMps:1.8,elapsedSeconds:.1}],states:['vault','land']},
  {id:'vault-land-hard',steps:[{traversalWeight:.95,traversalForwardDistance:1.1},{traversalWeight:.1,landingImpactMps:6,elapsedSeconds:.1}],states:['vault','land']},
  {id:'prepare-climb-air',steps:[{traversalWeight:.8,traversalForwardDistance:2.2,traversalHeight:1.3},{traversalWeight:.95,traversalForwardDistance:1.8,traversalHeight:1.4,grounded:false}],states:['climb','climb']},
  {id:'prepare-drop-air',steps:[{traversalWeight:.8,traversalForwardDistance:2.2,traversalHeight:-.7},{traversalWeight:.95,traversalForwardDistance:1.8,traversalHeight:-1,grounded:false}],states:['drop','drop']},
  {id:'blocked-entry',steps:[{traversalWeight:.8,traversalForwardDistance:1.4,traversalBlocked:true}],states:['blocked']},
  {id:'blocked-release',steps:[{traversalWeight:.8,traversalForwardDistance:1.4,traversalBlocked:true},{traversalWeight:0}],states:['blocked','clear']},
  {id:'cancel-entry',steps:[{traversalWeight:.8,traversalForwardDistance:1.4,cancelRequested:true}],states:['cancelled']},
  {id:'cancel-release',steps:[{traversalWeight:.8,traversalForwardDistance:1.4,cancelRequested:true},{traversalWeight:0}],states:['cancelled','clear']},
  {id:'confidence-weak',steps:[{traversalWeight:.8,traversalForwardDistance:1.4,surfaceConfidence:.2},{traversalWeight:.8,traversalForwardDistance:1.4,surfaceConfidence:.9}],states:['vault','vault']},
  {id:'foot-confidence-weak',steps:[{traversalWeight:.8,traversalForwardDistance:1.4,footPlantConfidence:.1},{traversalWeight:.8,traversalForwardDistance:1.4,footPlantConfidence:.9}],states:['vault','vault']},
  {id:'direction-redirect',steps:[{traversalWeight:.7,traversalForwardDistance:2.3,directionShiftDegrees:10},{traversalWeight:.8,traversalForwardDistance:1.8,directionShiftDegrees:45}],states:['prepare','vault']},
  {id:'speed-up',steps:[{traversalWeight:.7,traversalForwardDistance:2.4,planarSpeedMps:1},{traversalWeight:.8,traversalForwardDistance:1.5,planarSpeedMps:7}],states:['prepare','vault']},
  {id:'surface-rough',steps:[{traversalWeight:.6,traversalForwardDistance:2.4,surfaceId:'stone'},{traversalWeight:.7,traversalForwardDistance:1.7,surfaceId:'stone'}],states:['prepare','vault']},
  {id:'surface-ice',steps:[{traversalWeight:.8,traversalForwardDistance:1.5,surfaceId:'ice',surfaceConfidence:.8},{traversalWeight:.8,traversalForwardDistance:1.5,surfaceId:'ice',surfaceConfidence:.8}],states:['vault','vault']},
  {id:'width-narrow',steps:[{traversalWeight:.8,traversalForwardDistance:1.5,traversalWidth:.4}],states:['vault']},
  {id:'width-wide',steps:[{traversalWeight:.8,traversalForwardDistance:1.5,traversalWidth:4}],states:['vault']},
  {id:'zero-weight',steps:[{traversalWeight:0,traversalForwardDistance:1}],states:['clear']},
  {id:'tiny-weight',steps:[{traversalWeight:.14,traversalForwardDistance:1}],states:['clear']},
  {id:'threshold-weight',steps:[{traversalWeight:.15,traversalForwardDistance:4}],states:['approach']},
  {id:'max-weight',steps:[{traversalWeight:1,traversalForwardDistance:4}],states:['approach']},
  {id:'distance-max',steps:[{traversalWeight:.8,traversalForwardDistance:8}],states:['approach']},
  {id:'distance-near',steps:[{traversalWeight:.8,traversalForwardDistance:1}],states:['vault']},
  {id:'height-positive-grounded',steps:[{traversalWeight:.8,traversalForwardDistance:2.2,traversalHeight:1.2,grounded:true}],states:['climb']},
  {id:'height-negative-grounded',steps:[{traversalWeight:.8,traversalForwardDistance:2.2,traversalHeight:-.8,grounded:true}],states:['drop']},
  {id:'airborne-flat',steps:[{traversalWeight:.8,traversalForwardDistance:2.2,traversalHeight:0,grounded:false}],states:['drop']},
  {id:'airborne-up',steps:[{traversalWeight:.8,traversalForwardDistance:2.2,traversalHeight:1.0,grounded:false}],states:['climb']},
  {id:'impact-small',steps:[{traversalWeight:.6,traversalForwardDistance:1.5,landingImpactMps:1.2,elapsedSeconds:.1}],states:['vault']},
  {id:'impact-soft',steps:[{traversalWeight:.6,traversalForwardDistance:1.5,landingImpactMps:1.21,elapsedSeconds:.1}],states:['land']},
  {id:'impact-hard',steps:[{traversalWeight:.6,traversalForwardDistance:1.5,landingImpactMps:4.5,elapsedSeconds:.1}],states:['land']},
  {id:'impact-over-hard',steps:[{traversalWeight:.6,traversalForwardDistance:1.5,landingImpactMps:8,elapsedSeconds:.1}],states:['land']},
  {id:'cancel-absolute',steps:[{traversalWeight:0,traversalBlocked:true,cancelRequested:true}],states:['cancelled']},
  {id:'blocked-dominates',steps:[{traversalWeight:1,traversalBlocked:true}],states:['blocked']},
  {id:'land-after-traversal',steps:[{traversalWeight:.9,traversalForwardDistance:1.4},{traversalWeight:.1,traversalForwardDistance:4,landingImpactMps:2,elapsedSeconds:.1}],states:['vault','land']},
  {id:'recovery-follow',steps:[{traversalWeight:.9,traversalForwardDistance:1.4,landingImpactMps:5,elapsedSeconds:.1},{traversalWeight:0,grounded:false}],states:['land','recover']},
  {id:'terminal-cancel',steps:[{traversalWeight:.9,cancelRequested:true},{traversalWeight:0,cancelRequested:true}],states:['cancelled','cancelled']},
  {id:'clear-recovers',steps:[{traversalWeight:.9,traversalBlocked:true},{traversalWeight:0,traversalBlocked:false},{traversalWeight:.2,traversalForwardDistance:5}],states:['blocked','clear','approach']},
  {id:'prepare-persistence',steps:[{traversalWeight:.6,traversalForwardDistance:2.6},{traversalWeight:.6,traversalForwardDistance:2.6}],states:['prepare','prepare']},
  {id:'vault-persistence',steps:[{traversalWeight:.9,traversalForwardDistance:1.3},{traversalWeight:.9,traversalForwardDistance:1.3}],states:['vault','vault']},
  {id:'climb-persistence',steps:[{traversalWeight:.9,traversalForwardDistance:1.5,traversalHeight:1.4,grounded:false},{traversalWeight:.9,traversalForwardDistance:1.5,traversalHeight:1.4,grounded:false}],states:['climb','climb']},
  {id:'drop-persistence',steps:[{traversalWeight:.9,traversalForwardDistance:1.5,traversalHeight:-1,grounded:false},{traversalWeight:.9,traversalForwardDistance:1.5,traversalHeight:-1,grounded:false}],states:['drop','drop']},
  {id:'obstacle-label',steps:[{traversalWeight:.8,traversalForwardDistance:1.4,obstacleId:'wall-east'}],states:['vault']},
  {id:'surface-label',steps:[{traversalWeight:.8,traversalForwardDistance:1.4,surfaceId:'wood'}],states:['vault']},
  {id:'malformed-strings',steps:[{traversalWeight:'x',traversalForwardDistance:'x',landingImpactMps:'x'}],states:['clear']},
  {id:'numeric-strings',steps:[{traversalWeight:'0.8',traversalForwardDistance:'1.4'}],states:['vault']},
]);

export function getTraversalScenario(id) {
  return PLAYER_TRAVERSAL_SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}

export function listTraversalScenarioIds() {
  return Object.freeze(PLAYER_TRAVERSAL_SCENARIOS.map((scenario) => scenario.id));
}
