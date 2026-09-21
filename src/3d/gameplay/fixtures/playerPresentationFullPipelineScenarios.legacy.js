/**
 * Full-pipeline scenario corpus for player presentation integration.
 * Each case describes a realistic multi-frame path through locomotion, traversal, contact and recovery.
 */
export const PLAYER_FULL_PIPELINE_SCENARIOS=Object.freeze([
{id:'idle-to-walk',steps:[{speed:0,w:0,d:8},{speed:1,w:0,d:8},{speed:3,w:0,d:8},{speed:4,w:0,d:8}],states:['clear','clear','clear','clear']},
{id:'walk-to-approach',steps:[{speed:3,w:0,d:8},{speed:3,w:.2,d:6},{speed:3,w:.3,d:4}],states:['clear','approach','approach']},
{id:'approach-to-vault',steps:[{speed:3,w:.3,d:4},{speed:3,w:.5,d:2.8},{speed:3,w:.7,d:2.4},{speed:4,w:.9,d:1.2}],states:['approach','approach','prepare','vault']},
{id:'vault-contact-clear',steps:[{speed:4,w:.9,d:1.2},{speed:2,w:.3,d:1.2,impact:2,elapsed:.1},{speed:1,w:0,d:4,impact:0,elapsed:.4}],states:['vault','land','clear']},
{id:'climb-contact-clear',steps:[{speed:2,w:.6,d:2.8,h:1},{speed:2,w:.9,d:1.5,h:1.2,g:false},{speed:1,w:.2,impact:1.8,elapsed:.1,g:true},{speed:1,w:0}],states:['approach','climb','land','clear']},
{id:'drop-contact-clear',steps:[{speed:2,w:.6,d:2.8,h:-.6},{speed:2,w:.9,d:1.5,h:-1,g:false},{speed:1,w:.2,impact:1.5,elapsed:.1,g:true},{speed:1,w:0}],states:['approach','drop','land','clear']},
{id:'blocked-route',steps:[{speed:3,w:.3,d:4},{speed:3,w:.6,d:2.8},{speed:3,w:.8,d:2.2},{speed:3,w:.8,d:2.2,blocked:true},{speed:2,w:0,d:5}],states:['approach','approach','prepare','blocked','clear']},
{id:'cancelled-route',steps:[{speed:3,w:.3,d:4},{speed:3,w:.6,d:2.8},{speed:3,w:.9,d:1.3},{speed:3,w:.9,d:1.3,c:true},{speed:2,w:0}],states:['approach','approach','vault','cancelled','clear']},
{id:'surface-ice',steps:[{speed:2,w:.3,d:4,s:.9},{speed:2,w:.7,d:2.4,s:.7},{speed:3,w:.9,d:1.3,s:.3}],states:['approach','prepare','vault']},
{id:'surface-stone',steps:[{speed:2,w:.3,d:4,s:.95},{speed:2,w:.7,d:2.4,s:.95},{speed:3,w:.9,d:1.3,s:.95}],states:['approach','prepare','vault']},
{id:'confidence-recovery',steps:[{speed:3,w:.8,d:1.3,s:.2},{speed:3,w:.8,d:1.3,s:.35},{speed:3,w:.8,d:1.3,s:.8},{speed:3,w:.8,d:1.3,s:.95}],states:['vault','vault','vault','vault']},
{id:'hard-impact',steps:[{speed:3,w:.9,d:1.2},{speed:0,w:.2,impact:6,elapsed:.1},{speed:0,w:0,g:false},{speed:1,w:0,g:true}],states:['vault','land','recover','clear']},
{id:'soft-impact',steps:[{speed:3,w:.9,d:1.2},{speed:0,w:.2,impact:2,elapsed:.1},{speed:1,w:0}],states:['vault','land','clear']},
{id:'direction-redirect',steps:[{speed:3,w:.5,d:2.8,shift:5},{speed:4,w:.8,d:1.7,shift:30},{speed:4,w:.9,d:1.2,shift:45}],states:['approach','prepare','vault']},
{id:'speed-brake',steps:[{speed:8,w:.5,d:3.1},{speed:6,w:.6,d:2.7},{speed:3,w:.8,d:2.0}],states:['approach','approach','prepare']},
{id:'zero-speed-vault',steps:[{speed:0,w:.8,d:1.3}],states:['vault']},
{id:'numeric-string-input',steps:[{speed:'3',w:'0.8',d:'1.3'}],states:['vault']},
{id:'malformed-fallback',steps:[{speed:'bad',w:'bad',d:'bad'}],states:['clear']},
{id:'cancel-block-precedence',steps:[{speed:4,w:1,d:1,c:true,blocked:true}],states:['cancelled']},
{id:'block-impact-precedence',steps:[{speed:0,w:.8,impact:5,elapsed:.1,blocked:true}],states:['blocked']},
{id:'airborne-climb',steps:[{speed:3,w:.8,d:2,h:1.1,g:false},{speed:3,w:.9,d:1.5,h:1.4,g:false}],states:['climb','climb']},
{id:'airborne-drop',steps:[{speed:3,w:.8,d:2,h:-.7,g:false},{speed:3,w:.9,d:1.5,h:-1.2,g:false}],states:['drop','drop']},
{id:'prepare-persistence',steps:[{speed:3,w:.7,d:2.6},{speed:3,w:.7,d:2.6},{speed:3,w:.7,d:2.6}],states:['prepare','prepare','prepare']},
{id:'vault-persistence',steps:[{speed:3,w:.9,d:1.3},{speed:3,w:.9,d:1.3},{speed:3,w:.9,d:1.3}],states:['vault','vault','vault']},
{id:'blocked-persistence',steps:[{speed:3,w:.9,d:1.3,blocked:true},{speed:3,w:.9,d:1.3,blocked:true}],states:['blocked','blocked']},
{id:'cancel-persistence',steps:[{speed:3,w:.9,d:1.3,c:true},{speed:3,w:.9,d:1.3,c:true}],states:['cancelled','cancelled']},
{id:'recovery-loop',steps:[{speed:0,w:.2,impact:6,elapsed:.1},{speed:0,w:0,g:false},{speed:0,w:0,g:false},{speed:1,w:0,g:true}],states:['land','recover','recover','clear']},
]);

export function getPlayerFullPipelineScenario(id){return PLAYER_FULL_PIPELINE_SCENARIOS.find(x=>x.id===id)??null;}
export function listPlayerFullPipelineScenarioIds(){return Object.freeze(PLAYER_FULL_PIPELINE_SCENARIOS.map(x=>x.id));}
