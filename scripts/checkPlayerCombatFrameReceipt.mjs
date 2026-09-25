import assert from 'node:assert/strict';
import { createPlayerCombatFrameReceipt, validatePlayerCombatFrameReceipt, auditPlayerCombatFrameReceipt } from '../src/3d/gameplay/playerCombatFrameReceipt.ts';

const model = { traverse(visitor) { for (const name of ['Head','Chest','Back','RightHand','LeftHand']) visitor({name}); } };
const input = { playerObject:model, equipment:{mainHand:{id:'longsword'},offHand:{id:'shield'},chest:{id:'plate'}}, motion:{state:'move',speedMps:4,isGrounded:true,staminaRatio:.82,poiseRatio:.91}, attack:{kind:'heavy',phase:'active',comboStep:2,active:true,serial:7}, outcome:{outcome:'hit',rawAmount:30,appliedAmount:22,blockedAmount:8}, timestamp:120, revision:3 };
const a=createPlayerCombatFrameReceipt(input), b=createPlayerCombatFrameReceipt({...input});
assert.deepEqual(a,b);
assert.equal(a.phase,'active');
assert.equal(a.phaseValid,true);
assert.equal(a.attackKind,'heavy');
assert.equal(a.comboStep,2);
assert.equal(a.socketCount,5);
assert.equal(validatePlayerCombatFrameReceipt(a).ok,true);
assert.equal(auditPlayerCombatFrameReceipt(input).valid,true);
assert.equal(Object.isFrozen(a),true);
assert.equal(Object.isFrozen(a.equipment),true);
assert.equal(validatePlayerCombatFrameReceipt({...a,phase:'unknown',phaseValid:false}).ok,false);
assert.equal(validatePlayerCombatFrameReceipt({...a,staminaRatio:2}).ok,false);
console.log('player combat frame receipt proof: ok');
