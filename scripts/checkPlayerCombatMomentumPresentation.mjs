import assert from 'node:assert/strict';
import { createPlayerCombatMomentumDirector } from '../src/3d/gameplay/playerCombatMomentumDirector.js';
import { createPlayerCombatPresentationBridge } from '../src/3d/gameplay/playerCombatMomentumPresentation.js';

const director = createPlayerCombatMomentumDirector({ emit: false });
director.applyOutcome('heavy-hit', { comboStep: 2 }, 1);
const bridge = createPlayerCombatPresentationBridge({ director });
const packet = bridge.read();
assert.equal(packet.version, '2026-09-14-v1');
assert.equal(packet.channels.hud.score, director.read().score);
assert.ok(packet.channels.vfx.intensity > 0);
assert.equal(packet.channels.sfx.cue, 'heavy-hit');
assert.ok(packet.channels.additiveAnimation.weight >= 0);
console.log('PLAYER_COMBAT_MOMENTUM_PRESENTATION_PASS');
