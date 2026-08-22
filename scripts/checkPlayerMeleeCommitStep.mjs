import fs from 'node:fs';
import assert from 'node:assert/strict';
import { attackCommitBudget, computeAttackCommitStep } from '../src/3d/gameplay/playerCombatMath.js';

const player = fs.readFileSync('src/3d/gameplay/player.js', 'utf8');

assert.equal(attackCommitBudget(0.58, 1), 0.58);
assert.equal(Number(attackCommitBudget(0.58, 3).toFixed(4)), 0.6728);
assert.equal(computeAttackCommitStep({ previousElapsedSeconds: 0, nextElapsedSeconds: 0.13, activeEndSeconds: 0.26, totalCommitMeters: 0.58, remainingCommitMeters: 0.58 }), 0.29);
assert.equal(computeAttackCommitStep({ previousElapsedSeconds: 0.26, nextElapsedSeconds: 0.44, activeEndSeconds: 0.26, totalCommitMeters: 0.58, remainingCommitMeters: 0.29 }), 0);
assert.equal(computeAttackCommitStep({ previousElapsedSeconds: 0.2, nextElapsedSeconds: 0.4, activeEndSeconds: 0.26, totalCommitMeters: 0.58, remainingCommitMeters: 0.1 }), 0.1);
assert.equal(computeAttackCommitStep({ previousElapsedSeconds: 0, nextElapsedSeconds: 1, activeEndSeconds: 0.46, totalCommitMeters: 0.9, remainingCommitMeters: 0.9 }), 0.9);

assert.match(player, /from '\.\/playerCombatMath\.js'/);
assert.match(player, /LIGHT_ATTACK_COMMIT_METERS:\s*0\.58/);
assert.match(player, /HEAVY_ATTACK_COMMIT_METERS:\s*0\.9/);
assert.match(player, /attackCommitRemaining = attackCommitBudget/);
assert.match(player, /computeAttackCommitStep\(/);
assert.match(player, /moveBy\(Math\.sin\(model\.rotation\.y\), Math\.cos\(model\.rotation\.y\), commitStep \/ dt, dt\)/);
assert.match(player, /commitRemainingMeters/);
assert.ok(player.indexOf('computeAttackCommitStep(') < player.indexOf("const activeNow = attackElapsed"), 'commit motion must be integrated before attack-window transition telemetry');
assert.ok(!player.includes('EditorMaterialStudio'), 'gameplay runtime must remain DOM/editor independent');

console.log('[checkPlayerMeleeCommitStep] PASS: light/heavy combo attacks use deterministic bounded collider-aware forward commit during windup/active time only.');
