import { createSettlementInteriorReceipt } from '../src/3d/gameplay/settlementInteriorReceipt.ts';
const assert=(value,message)=>{if(!value) throw new Error(message)};
const ready=createSettlementInteriorReceipt({role:'blacksmith',phase:'inside',action:'craft'});
assert(ready.result==='ready','inside craft');
assert(Object.isFrozen(ready),'frozen');
const blocked=createSettlementInteriorReceipt({role:'tavern',phase:'service',action:'acceptQuest',questBlocked:true});
assert(blocked.result==='blocked'&&blocked.reason==='quest-blocked','quest blocked');
console.log('settlement interior receipt proof: PASS');
