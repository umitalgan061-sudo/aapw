import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../src/3d/gameplay/player.js', import.meta.url), 'utf8');

function numberConstant(name) {
  const match = source.match(new RegExp(`${name}:\\s*([0-9.]+)`));
  assert.ok(match, `missing ${name}`);
  return Number(match[1]);
}

const duration = numberConstant('DODGE_DURATION_SECONDS');
const start = numberConstant('DODGE_IFRAME_START_SECONDS');
const end = numberConstant('DODGE_IFRAME_END_SECONDS');

assert.ok(start > 0, 'iframe window must not begin on the input frame');
assert.ok(end > start, 'iframe end must follow start');
assert.ok(end < duration, 'iframe window must leave recovery vulnerability');
assert.ok(start >= 0.04, 'startup vulnerability must remain meaningfully punishable');
assert.ok(duration - end >= 0.08, 'recovery vulnerability must remain meaningfully punishable');
assert.match(source, /let dodgeRemaining = 0, dodgeElapsed = 0,/);
assert.match(source, /dodgeElapsed = 0;\s*\n\s*dodgeRemaining = PLAYER_ACTION_CONFIG\.DODGE_DURATION_SECONDS;/);
assert.match(source, /function isDodgeInvulnerable\(\)[\s\S]*dodgeElapsed >= PLAYER_ACTION_CONFIG\.DODGE_IFRAME_START_SECONDS[\s\S]*dodgeElapsed < PLAYER_ACTION_CONFIG\.DODGE_IFRAME_END_SECONDS/);
assert.match(source, /if \(isDodgeInvulnerable\(\)\) \{[\s\S]*payload\.rawAmount = rawAmount; payload\.blockedAmount = rawAmount; payload\.amount = 0; payload\.mitigation = 'dodge';/);
assert.match(source, /if \(isDodgeInvulnerable\(\)\) \{[\s\S]*publishMotionTelemetry\(true\); return;/);
assert.match(source, /isDodgeInvulnerable: isDodgeInvulnerable\(\), dodgeElapsed:/);
assert.match(source, /dodgeElapsed \+= dt; dodgeRemaining = Math\.max\(0, dodgeRemaining - dt\);/);

console.log(`PLAYER_DODGE_IFRAMES_OK start=${start.toFixed(2)} end=${end.toFixed(2)} duration=${duration.toFixed(2)} startupVulnerability=${start.toFixed(2)} recoveryVulnerability=${(duration - end).toFixed(2)}`);
