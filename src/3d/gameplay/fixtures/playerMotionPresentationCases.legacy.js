/** Composite motion presentation cases covering domain precedence. */
export const PLAYER_MOTION_PRESENTATION_CASES=Object.freeze([
{id:'normal-idle',input:{planarSpeedMps:0,traversalWeight:0,deltaSeconds:1/60},domain:'locomotion'},
{id:'normal-cruise',input:{planarSpeedMps:4,traversalWeight:0,deltaSeconds:1/60},domain:'locomotion'},
{id:'traversal-approach',input:{planarSpeedMps:3,traversalWeight:.4,traversalForwardDistance:4,deltaSeconds:1/60},domain:'locomotion'},
{id:'traversal-prepare',input:{planarSpeedMps:3,traversalWeight:.7,traversalForwardDistance:2.4,deltaSeconds:1/60},domain:'traversal'},
{id:'traversal-vault',input:{planarSpeedMps:3,traversalWeight:.9,traversalForwardDistance:1.2,deltaSeconds:1/60},domain:'traversal'},
{id:'traversal-climb',input:{planarSpeedMps:3,traversalWeight:.9,traversalForwardDistance:1.2,traversalHeight:1.2,grounded:false,deltaSeconds:1/60},domain:'traversal'},
{id:'traversal-drop',input:{planarSpeedMps:3,traversalWeight:.9,traversalForwardDistance:1.2,traversalHeight:-1,grounded:false,deltaSeconds:1/60},domain:'traversal'},
{id:'traversal-land',input:{planarSpeedMps:0,traversalWeight:.2,landingImpactMps:2,elapsedSeconds:.1,deltaSeconds:1/60},domain:'traversal'},
{id:'traversal-blocked',input:{planarSpeedMps:4,traversalWeight:.8,traversalBlocked:true,deltaSeconds:1/60},domain:'traversal'},
{id:'traversal-cancelled',input:{planarSpeedMps:4,traversalWeight:.8,cancelRequested:true,deltaSeconds:1/60},domain:'traversal'},
{id:'recovery',input:{planarSpeedMps:1,traversalWeight:0,grounded:false,deltaSeconds:1/60},domain:'locomotion'},
{id:'surface-low-confidence',input:{planarSpeedMps:3,traversalWeight:.9,traversalForwardDistance:1.2,surfaceConfidence:.1,deltaSeconds:1/60},domain:'traversal'},
{id:'blocked-cancelled',input:{planarSpeedMps:3,traversalWeight:.9,traversalBlocked:true,cancelRequested:true,deltaSeconds:1/60},domain:'traversal'},
{id:'airborne-positive',input:{planarSpeedMps:3,traversalWeight:.8,traversalForwardDistance:2,traversalHeight:1,grounded:false,deltaSeconds:1/60},domain:'traversal'},
{id:'airborne-negative',input:{planarSpeedMps:3,traversalWeight:.8,traversalForwardDistance:2,traversalHeight:-.8,grounded:false,deltaSeconds:1/60},domain:'traversal'},
{id:'far-obstacle-slow',input:{planarSpeedMps:1,traversalWeight:.2,traversalForwardDistance:6,deltaSeconds:1/60},domain:'locomotion'},
{id:'far-obstacle-fast',input:{planarSpeedMps:7,traversalWeight:.3,traversalForwardDistance:6,deltaSeconds:1/60},domain:'locomotion'},
{id:'near-obstacle-slow',input:{planarSpeedMps:1,traversalWeight:.8,traversalForwardDistance:1.3,deltaSeconds:1/60},domain:'traversal'},
{id:'near-obstacle-fast',input:{planarSpeedMps:7,traversalWeight:.8,traversalForwardDistance:1.3,deltaSeconds:1/60},domain:'traversal'},
{id:'clear-after-traversal',input:{planarSpeedMps:2,traversalWeight:0,deltaSeconds:1/60},domain:'locomotion'},
]);
export function getPlayerMotionCase(id){return PLAYER_MOTION_PRESENTATION_CASES.find(x=>x.id===id)??null;}
