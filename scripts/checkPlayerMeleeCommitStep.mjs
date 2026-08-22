import fs from 'node:fs';
import assert from 'node:assert/strict';

const player = fs.readFileSync('src/3d/gameplay/player.js', 'utf8');
const budgetStart = player.indexOf('function attackCommitBudget(');
const stepStart = player.indexOf('function computeAttackCommitStep(');
const createPlayerStart = player.indexOf('export async function createPlayer(');
assert.ok(budgetStart >= 0 && stepStart > budgetStart && createPlayerStart > stepStart, 'inline commit math must exist before createPlayer');

const budgetSource = player.slice(budgetStart, stepStart);
const stepSource = player.slice(stepStart, createPlayerStart);
const buildMath = new Function(`
  const PLAYER_ACTION_CONFIG = { ATTACK_COMBO_COMMIT_BONUS_PER_STEP: 0.08 };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  ${budgetSource}
  ${stepSource}
  return { attackCommitBudget, computeAttackCommitStep };
`);
const { attackCommitBudget, computeAttackCommitStep } = buildMath();

assert.equal(attackCommitBudget(0.58, 1), 0.58);
assert.equal(Number(attackCommitBudget(0.58, 3).toFixed(4)), 0.6728);
assert.equal(computeAttackCommitStep(0, 0.13, 0.26, 0.58, 0.58), 0.29);
assert.equal(computeAttackCommitStep(0.26, 0.44, 0.26, 0.58, 0.29), 0);
assert.equal(computeAttackCommitStep(0.2, 0.4, 0.26, 0.58, 0.1), 0.1);
assert.equal(computeAttackCommitStep(0, 1, 0.46, 0.9, 0.9), 0.9);

assert.match(player, /LIGHT_ATTACK_COMMIT_METERS:\s*0\.58/);
assert.match(player, /HEAVY_ATTACK_COMMIT_METERS:\s*0\.9/);
assert.match(player, /attackCommitRemaining = attackCommitBudget/);
assert.match(player, /const startX = model\.position\.x, startZ = model\.position\.z;/);
assert.match(player, /return Math\.hypot\(model\.position\.x - startX, model\.position\.z - startZ\);/);
assert.match(player, /const committedMeters = moveBy\(Math\.sin\(model\.rotation\.y\), Math\.cos\(model\.rotation\.y\), commitStep \/ dt, dt\)/);
assert.match(player, /attackCommitRemaining = Math\.max\(0, attackCommitRemaining - committedMeters\)/);
assert.doesNotMatch(player, /attackCommitRemaining = Math\.max\(0, attackCommitRemaining - commitStep\)/, 'blocked collision travel must not consume untraveled attack commit budget');
assert.match(player, /commitRemainingMeters/);
assert.ok(player.indexOf('const commitStep = computeAttackCommitStep') < player.indexOf('const activeNow = attackElapsed'), 'commit motion must be integrated before attack-window transition telemetry');
assert.ok(!player.includes('EditorMaterialStudio'), 'gameplay runtime must remain DOM/editor independent');

console.log('[checkPlayerMeleeCommitStep] PASS: melee commit budget follows actual collider-resolved travel and never consumes blocked distance.');
