import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/3d/gameplay/player.js', import.meta.url), 'utf8');
const fail = (message) => { throw new Error(message); };
const requireMatch = (regex, message) => { if (!regex.test(source)) fail(message); };

requireMatch(/ATTACK_WINDUP_TURN_MULTIPLIER:\s*0\.68/, 'bounded windup steering multiplier missing');
requireMatch(/function updateAttack\(dt,\s*moveDirectionXZ\)/, 'attack update must receive live movement intent');
requireMatch(/previousElapsed\s*<\s*tuning\.activeStart\s*&&\s*hasMovementInput/, 'steering must be limited to pre-active windup');
requireMatch(/turnToward\(moveDirectionXZ\.x,\s*moveDirectionXZ\.z,\s*dt\s*\*\s*PLAYER_ACTION_CONFIG\.ATTACK_WINDUP_TURN_MULTIPLIER\)/, 'windup steering must reuse canonical turnToward path');
requireMatch(/else if \(attackRemaining > 0\) \{ guarding = false; updateAttack\(dt, moveDirectionXZ\); \}/, 'runtime update must forward the same input vector into the existing attack state machine');
requireMatch(/moveBy\(Math\.sin\(model\.rotation\.y\),\s*Math\.cos\(model\.rotation\.y\)/, 'melee commit must continue to use resolved facing after windup steering');

if (/activeNow[^\n]*turnToward/.test(source)) fail('active frames must not gain free attack steering');
if (/recovery[^\n]*turnToward/.test(source)) fail('recovery frames must not gain free attack steering');
if (!/playerCollider\.resolveXZ/.test(source)) fail('canonical collider-resolved movement was lost');
if (!/groundCollider\.getGroundHeight/.test(source)) fail('canonical ground coupling was lost');

const math = source.match(/const targetYaw = Math\.atan2\(directionX, directionZ\);[\s\S]*?Math\.min\(1, PLAYER_CONFIG\.TURN_RATE_RADIANS_PER_SECOND \* delta\)\);/);
if (!math) fail('canonical shortest-angle turn math missing');

console.log('PLAYER_ATTACK_WINDUP_STEERING_OK');
