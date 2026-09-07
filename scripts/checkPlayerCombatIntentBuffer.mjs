import assert from 'node:assert/strict';
import { createPlayerCombatIntentBuffer } from '../src/3d/gameplay/playerCombatIntentBuffer.js';

const buffer = createPlayerCombatIntentBuffer({bufferWindowMs:120,maxQueueSize:3,staleAfterMs:300});
assert.equal(buffer.push('lightAttack',10,{comboStep:1}).accepted,true);
assert.equal(buffer.push('dodge',20).accepted,true);
assert.equal(buffer.push('unsupported',30).accepted,false);
assert.equal(buffer.peek(20).action,'lightAttack');
assert.equal(buffer.consume(20,(intent)=>intent.action==='dodge').action,'dodge');
assert.equal(buffer.consume(20).action,'lightAttack');
assert.equal(buffer.push('heavyAttack',100).accepted,true);
assert.equal(buffer.peek(221),null);

const bounded = createPlayerCombatIntentBuffer({maxQueueSize:2});
bounded.push('block',1); bounded.push('parry',2); bounded.push('lockOn',3);
assert.deepEqual(bounded.snapshot(3).queued.map((intent)=>intent.action),['parry','lockOn']);
assert.equal(bounded.snapshot(3).queued[0].sequence < bounded.snapshot(3).queued[1].sequence,true);

const deterministicA = createPlayerCombatIntentBuffer();
const deterministicB = createPlayerCombatIntentBuffer();
for (const [action,time] of [['lightAttack',1],['heavyAttack',2],['dodge',3]]) { deterministicA.push(action,time); deterministicB.push(action,time); }
assert.deepEqual(deterministicA.snapshot(3),deterministicB.snapshot(3));
console.log('playerCombatIntentBuffer: ok');