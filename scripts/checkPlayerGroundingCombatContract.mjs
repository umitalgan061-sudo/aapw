import fs from 'node:fs';

const playerPath = 'src/3d/gameplay/player.js';
const playerConfigPath = 'src/3d/gameplay/playerConfig.js';
const player = fs.readFileSync(playerPath, 'utf8');
const playerConfig = fs.readFileSync(playerConfigPath, 'utf8');

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

requireMatch(player, /const groundY = groundCollider\.getGroundHeight\(spawn\.x, spawn\.z\);\s*model\.position\.set\(spawn\.x, groundY, spawn\.z\);/s,
  'Player spawn must snap the visual root to canonical ground height.');
requireMatch(player, /model\.position\.y = groundCollider\.getGroundHeight\(model\.position\.x, model\.position\.z\) \+ heightAboveGround;/,
  'Player visual root must be re-grounded from the canonical collider every update.');
requireMatch(player, /integrateJumpArc\(heightAboveGround, velocityY, dt, PLAYER_CONFIG\.GRAVITY_MPS2\)/,
  'Airborne offset must remain separated from terrain height through integrateJumpArc.');
requireMatch(player, /MAX_COLLISION_STEP_METERS:\s*0\.45/,
  'Movement must retain bounded collision substeps.');
requireMatch(player, /Math\.ceil\(travelMeters \/ PLAYER_ACTION_CONFIG\.MAX_COLLISION_STEP_METERS\)/,
  'Movement must subdivide long frames before playerCollider resolution.');
requireMatch(player, /playerCollider\.resolveXZ\(nextX, nextZ\)/,
  'Movement must continue to use the existing composed player collider.');
requireMatch(player, /let travelledMeters = 0;[\s\S]*?const stepStartX = model\.position\.x, stepStartZ = model\.position\.z;[\s\S]*?playerCollider\.resolveXZ\(nextX, nextZ\)[\s\S]*?travelledMeters \+= Math\.hypot\(nextX - stepStartX, nextZ - stepStartZ\);[\s\S]*?return travelledMeters;/,
  'Movement must report accumulated collider-resolved X/Z path travel rather than start-to-end chord distance.');
if (/return Math\.hypot\(model\.position\.x - startX, model\.position\.z - startZ\);/.test(player)) throw new Error('Movement must not collapse a collider-sliding path into start-to-end chord distance.');
requireMatch(player, /const committedMeters = moveBy\([\s\S]*?attackCommitRemaining = Math\.max\(0, attackCommitRemaining - committedMeters\);/,
  'Melee commit budget must be consumed only by actual collider-resolved travel.');
requireMatch(player, /computeAttackCommitStep\(previousElapsed, attackElapsed, tuning\.activeEnd,[\s\S]*attackCommitRemaining\)/,
  'Melee commit must stay bounded by authored attack timing and remaining distance.');
requireMatch(player, /movementState = 'dodge';/,
  'Dodge must remain inside the existing player state machine.');
requireMatch(player, /movementState = `attack-\$\{attackKind\}`;/,
  'Melee attacks must remain inside the existing player state machine.');
requireMatch(player, /gameEvents\.on\(EVENTS\.PLAYER_DAMAGED, onIncomingDamage\)/,
  'Defense must continue consuming the shared PLAYER_DAMAGED event.');
requireMatch(player, /publishAttackWindow\('active-start'\)/,
  'Melee hit timing must retain an explicit active-window event.');
requireMatch(player, /HIT_POISE_DAMAGE_RATIO:\s*1/,
  'Unguarded hits must have an explicit bounded poise damage ratio.');
requireMatch(player, /HIT_STAGGER_SECONDS:\s*0\.32/,
  'Hit stagger must use a short bounded authored duration.');
requireMatch(player, /if \(!guarding \|\| stamina <= 0\) \{ spendPoise\(rawAmount \* PLAYER_ACTION_CONFIG\.HIT_POISE_DAMAGE_RATIO\);/,
  'Unguarded damage must consume poise without replacing health damage semantics.');
requireMatch(player, /function triggerHitStagger\(\)[\s\S]*interruptAttackForHit\(\)[\s\S]*movementState = 'hit-stagger'/,
  'Poise break must enter the existing player state machine and interrupt melee cleanly.');
requireMatch(player, /publishAttackWindow\('interrupted'\)/,
  'Interrupted melee must publish a terminal combat-window phase for existing consumers.');
requireMatch(player, /hitStaggerRemaining > 0\) \{ guarding = false; movementState = 'hit-stagger';/,
  'Hit stagger must suppress locomotion through the canonical update precedence.');
requireMatch(player, /hitStaggerRemaining: Number\(hitStaggerRemaining\.toFixed\(3\)\)/,
  'Hit stagger state must be exposed through existing player motion telemetry.');
if (/payload\.amount\s*=\s*0/.test(player.match(/if \(!guarding \|\| stamina <= 0\)[\s\S]*?return; \}/)?.[0] || '')) throw new Error('Unguarded stagger must not erase authoritative health damage.');
requireMatch(playerConfig, /MODEL_URL:\s*['"][^'"]+\.fbx['"]/, 'Player must use a shipped FBX character asset.');
requireMatch(playerConfig, /idle:\s*['"][^'"]+\.fbx['"]/, 'Player must use a shipped idle animation asset.');
requireMatch(playerConfig, /walking:\s*['"][^'"]+\.fbx['"]/, 'Player must use a shipped walking animation asset.');
requireMatch(playerConfig, /running:\s*['"][^'"]+\.fbx['"]/, 'Player must use a shipped running animation asset.');

for (const assetPath of [...playerConfig.matchAll(/['"](assets\/(?:models\/characters|animations\/peasant_girl)\/[^'"]+\.fbx)['"]/g)].map((match) => match[1])) {
  if (!fs.existsSync(assetPath)) throw new Error(`Configured shipped player asset is missing: ${assetPath}`);
}

if (/EditorMaterialStudio/.test(player)) throw new Error('Runtime player code must not import editor-only Material Studio UI.');
if (!fs.existsSync('src/3d/materials/MaterialAssignmentCore.js')) throw new Error('Shared MaterialAssignmentCore successor must exist on main.');
if (!fs.existsSync('src/3d/world/WorldAssetPlacementPipeline.js')) throw new Error('Shared WorldAssetPlacementPipeline successor must exist on main.');

console.log('PLAYER_GROUNDING_COMBAT_CONTRACT_OK');