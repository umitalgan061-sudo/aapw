import { strict as assert } from 'node:assert';
import { buildSettlementServiceDashboard, serializeSettlementServiceDashboard, validateSettlementServiceDashboard } from '../src/3d/gameplay/settlementServiceDashboard.js';
const view={revision:7,locationId:'north-settlement',insideSettlement:true,copper:420,fatigueBand:'steady',services:[
{id:'market',label:'Market',enabled:true,actions:['trade']},
{id:'tavern',label:'Tavern',unlocked:true,enabled:true,actions:['talk','rest'],primaryAction:'talk'},
{id:'blacksmith',label:'Blacksmith',unlocked:false,enabled:true,actions:['craft'],reason:'quest-required'},
{id:'stable',label:'Stable',completed:true,actions:['travel']},
],quests:[{id:'q1'}]};
const a=buildSettlementServiceDashboard(view,{selectedService:'tavern'});const b=buildSettlementServiceDashboard(view,{selectedService:'tavern'});
assert.deepEqual(a,b,'deterministic');assert.equal(validateSettlementServiceDashboard(a).ok,true,'valid');assert.equal(a.activeService,'tavern');assert.equal(a.rows.find(r=>r.id==='blacksmith').status,'blocked');assert.equal(a.rows.find(r=>r.id==='stable').status,'complete');assert.equal(a.rows.find(r=>r.id==='tavern').selected,true);assert.equal(Object.isFrozen(a),true);assert.equal(Object.isFrozen(a.rows[0]),true);assert.equal(serializeSettlementServiceDashboard(a),serializeSettlementServiceDashboard(b),'stable serialization');
const malformed=buildSettlementServiceDashboard({services:[{id:'market',enabled:'yes'}],copper:'bad',revision:'bad'});assert.equal(validateSettlementServiceDashboard(malformed).ok,true,'malformed finite fallback');assert.equal(malformed.context.copper,0);assert.equal(malformed.revision,0);
console.log('settlement-service-dashboard: ok');
