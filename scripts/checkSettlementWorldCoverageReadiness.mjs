import { strict as assert } from 'node:assert';
import { createSettlementWorldCoverageReadiness } from '../src/3d/gameplay/settlementWorldCoverageReadiness.js';
const input={snapshot:{settlementId:'canonical-settlement',locationId:'gate',inSettlement:true,settlementOpen:true,health:100,copper:80,saveEnabled:true},assets:[
  {family:'settlements',assetId:'door-north',status:'loaded',materialSlots:4,textured:true,grounded:true},
  {family:'settlements',assetId:'road-east',status:'loaded',materialSlots:3,textured:true,grounded:true},
]};
const first=createSettlementWorldCoverageReadiness(input); const second=createSettlementWorldCoverageReadiness(JSON.parse(JSON.stringify(input)));
assert(first.selected,'readiness must select a next action');
assert(first.selected.serviceId==='market','trade-capable market should win the deterministic readiness priority');
assert(first.selected.intent==='talk','market primary readiness intent drift');
assert(first.alternatives.some((row)=>row.serviceId==='gate'),'gate must remain an actionable alternative');
assert(first.fingerprint===second.fingerprint,'readiness fingerprint must be deterministic');
assert(first.summary.interactionable===true,'readiness should be interactionable'); assert(first.safeFallback==='gate','safe fallback drift');
assert(Object.isFrozen(first)&&Object.isFrozen(first.selected)&&Object.isFrozen(first.alternatives),'readiness output must be deeply frozen');
assert(first.alternatives.length<=7,'readiness alternative bound drift');
console.log(`Settlement World Coverage readiness PASS (${first.fingerprint})`);