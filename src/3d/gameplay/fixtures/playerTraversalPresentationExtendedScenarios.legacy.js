/** Extended scenario fixtures for multi-frame traversal transitions. */
export const PLAYER_TRAVERSAL_EXTENDED_SCENARIOS=Object.freeze([
{id:'slow-approach',steps:[{w:.2,d:7},{w:.25,d:6},{w:.3,d:5},{w:.35,d:4},{w:.5,d:3.2}],states:['approach','approach','approach','approach','approach']},
{id:'steady-prepare',steps:[{w:.45,d:3},{w:.5,d:2.8},{w:.55,d:2.75},{w:.6,d:2.7}],states:['approach','approach','approach','prepare']},
{id:'vault-commit',steps:[{w:.7,d:2.7},{w:.75,d:2.1},{w:.85,d:1.9},{w:.95,d:1.2}],states:['prepare','prepare','vault','vault']},
{id:'climb-commit',steps:[{w:.7,d:2.7,h:1},{w:.8,d:2.2,h:1},{w:.85,d:1.8,h:1.1,g:false}],states:['climb','climb','climb']},
{id:'drop-commit',steps:[{w:.7,d:2.7,h:-.6},{w:.8,d:2.2,h:-.8},{w:.9,d:1.8,h:-1,g:false}],states:['drop','drop','drop']},
{id:'blocked-after-prepare',steps:[{w:.6,d:3},{w:.7,d:2.4},{w:.8,d:2,g:false},{w:.8,d:2,blocked:true}],states:['approach','prepare','prepare','blocked']},
{id:'cancel-after-commit',steps:[{w:.7,d:2.5},{w:.9,d:1.4},{w:.9,d:1.4,c:true}],states:['prepare','vault','cancelled']},
{id:'land-release',steps:[{w:.9,d:1.4},{w:.2,d:1.4,impact:2,e:.1},{w:.1,d:3,impact:0,e:.4},{w:0,d:4}],states:['vault','land','clear','clear']},
{id:'hard-land-recover',steps:[{w:.9,d:1.4},{w:.2,impact:6,e:.1},{w:0,g:false},{w:0,g:true}],states:['vault','land','recover','clear']},
{id:'confidence-rebound',steps:[{w:.8,d:1.4,s:.2},{w:.8,d:1.4,s:.35},{w:.8,d:1.4,s:.75},{w:.8,d:1.4,s:.95}],states:['vault','vault','vault','vault']},
{id:'direction-noise',steps:[{w:.8,d:1.5,shift:2},{w:.8,d:1.5,shift:-4},{w:.8,d:1.5,shift:10},{w:.8,d:1.5,shift:-20}],states:['vault','vault','vault','vault']},
{id:'speed-oscillation',steps:[{w:.8,d:2,speed:1},{w:.8,d:2,speed:4},{w:.8,d:2,speed:8},{w:.8,d:2,speed:2}],states:['prepare','prepare','prepare','prepare']},
{id:'weight-pulse',steps:[{w:.05,d:1},{w:.2,d:1},{w:.1,d:1},{w:.2,d:1}],states:['clear','vault','clear','vault']},
{id:'blocked-pulse',steps:[{w:.8,d:1.4,blocked:true},{w:.8,d:1.4,blocked:false},{w:.8,d:1.4,blocked:true}],states:['blocked','vault','blocked']},
{id:'cancel-pulse',steps:[{w:.8,d:1.4,c:true},{w:.8,d:1.4,c:false},{w:.8,d:1.4,c:true}],states:['cancelled','vault','cancelled']},
{id:'surface-change',steps:[{w:.8,d:1.4,surface:'stone'},{w:.8,d:1.4,surface:'wood'},{w:.8,d:1.4,surface:'ice'}],states:['vault','vault','vault']},
{id:'obstacle-change',steps:[{w:.8,d:1.4,o:'wall-a'},{w:.8,d:1.4,o:'wall-b'},{w:.8,d:1.4,o:'rail-c'}],states:['vault','vault','vault']},
{id:'airborne-climb-land',steps:[{w:.9,d:1.2,h:1.1,g:false},{w:.9,d:1.2,h:1.2,g:false},{w:.2,impact:2,e:.1,g:true},{w:0,g:true}],states:['climb','climb','land','clear']},
{id:'airborne-drop-land',steps:[{w:.9,d:1.2,h:-1,g:false},{w:.9,d:1.2,h:-.7,g:false},{w:.2,impact:2,e:.1,g:true},{w:0,g:true}],states:['drop','drop','land','clear']},
{id:'far-clear',steps:[{w:0,d:8},{w:0,d:5},{w:0,d:2}],states:['clear','clear','clear']},
]);

export function getExtendedTraversalScenario(id){return PLAYER_TRAVERSAL_EXTENDED_SCENARIOS.find(x=>x.id===id)??null;}
