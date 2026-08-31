import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/3d/gameplay/player.js', import.meta.url), 'utf8');

function requirePattern(pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

requirePattern(/function moveBy\([\s\S]*?let travelledMeters = 0;[\s\S]*?playerCollider\.resolveXZ\(nextX, nextZ\)[\s\S]*?travelledMeters \+= Math\.hypot\(nextX - stepStartX, nextZ - stepStartZ\);[\s\S]*?return travelledMeters;/, 'player moveBy must accumulate every collider-resolved planar step as actual travelled distance');
if (/return Math\.hypot\(model\.position\.x - startX, model\.position\.z - startZ\);/.test(source)) throw new Error('player moveBy must not collapse a collider-sliding path into start-to-end chord distance');
requirePattern(/MAX_COLLISION_STEP_METERS:\s*0\.45/, 'player collision stepping budget changed without requalification');
requirePattern(/const steps = playerCollider \? Math\.max\(1, Math\.ceil\(travelMeters \/ PLAYER_ACTION_CONFIG\.MAX_COLLISION_STEP_METERS\)\) : 1;/, 'large attack locomotion must subdivide through collider-safe steps');
requirePattern(/const commitStep = computeAttackCommitStep\([\s\S]*?const committedMeters = moveBy\(Math\.sin\(model\.rotation\.y\), Math\.cos\(model\.rotation\.y\), commitStep \/ dt, dt\); attackCommitRemaining = Math\.max\(0, attackCommitRemaining - committedMeters\);/, 'attack commit must consume actual collider-resolved displacement, not requested displacement');
requirePattern(/model\.position\.y = groundCollider\.getGroundHeight\(model\.position\.x, model\.position\.z\) \+ heightAboveGround;/, 'player visual Y must remain bound to canonical ground height after planar combat motion');
requirePattern(/if \(attackRemaining <= 0 && dodgeRemaining <= 0[\s\S]*?jumpRequested && isGrounded\)/, 'jump must stay gated until committed attack motion is complete');
requirePattern(/LIGHT_ATTACK_COMMIT_METERS:\s*0\.58/, 'light attack commit distance changed without requalification');
requirePattern(/HEAVY_ATTACK_COMMIT_METERS:\s*0\.9/, 'heavy attack commit distance changed without requalification');

const moveByIndex = source.indexOf('function moveBy(');
const updateAttackIndex = source.indexOf('function updateAttack(');
const groundSnapIndex = source.indexOf('model.position.y = groundCollider.getGroundHeight');
if (!(moveByIndex >= 0 && updateAttackIndex > moveByIndex && groundSnapIndex > updateAttackIndex)) {
  throw new Error('combat movement ordering must remain moveBy -> attack update -> canonical ground snap');
}

if (/EditorMaterialStudio/.test(source)) throw new Error('runtime player must not import or reference EditorMaterialStudio');

console.log('PLAYER_ATTACK_COMMIT_GROUNDING_CONTRACT_OK');
