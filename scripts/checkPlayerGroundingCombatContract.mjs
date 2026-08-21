import fs from 'node:fs';

const playerPath = 'src/3d/gameplay/player.js';
const configPath = 'src/3d/gameplay/gameplayConfig.js';
const player = fs.readFileSync(playerPath, 'utf8');
const config = fs.readFileSync(configPath, 'utf8');

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
requireMatch(player, /movementState = 'dodge';/,
  'Dodge must remain inside the existing player state machine.');
requireMatch(player, /movementState = `attack-\$\{attackKind\}`;/,
  'Melee attacks must remain inside the existing player state machine.');
requireMatch(player, /gameEvents\.on\(EVENTS\.PLAYER_DAMAGED, onIncomingDamage\)/,
  'Defense must continue consuming the shared PLAYER_DAMAGED event.');
requireMatch(player, /publishAttackWindow\('active-start'\)/,
  'Melee hit timing must retain an explicit active-window event.');
requireMatch(config, /MODEL_URL:\s*['"][^'"]+\.fbx['"]/, 'Player must use a shipped FBX character asset.');
requireMatch(config, /idle:\s*['"][^'"]+\.fbx['"]/, 'Player must use a shipped idle animation asset.');
requireMatch(config, /walking:\s*['"][^'"]+\.fbx['"]/, 'Player must use a shipped walking animation asset.');
requireMatch(config, /running:\s*['"][^'"]+\.fbx['"]/, 'Player must use a shipped running animation asset.');

if (/EditorMaterialStudio/.test(player)) throw new Error('Runtime player code must not import editor-only Material Studio UI.');
if (!fs.existsSync('src/3d/materials/MaterialAssignmentCore.js')) throw new Error('Shared MaterialAssignmentCore successor must exist on main.');
if (!fs.existsSync('src/3d/world/WorldAssetPlacementPipeline.js')) throw new Error('Shared WorldAssetPlacementPipeline successor must exist on main.');

console.log('PLAYER_GROUNDING_COMBAT_CONTRACT_OK');
