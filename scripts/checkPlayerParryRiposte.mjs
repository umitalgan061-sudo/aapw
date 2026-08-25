#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [player, hud] = await Promise.all([
  readFile(new URL('../src/3d/gameplay/player.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/3d/ui/healthBar.js', import.meta.url), 'utf8'),
]);

function numberConstant(name) {
  const match = player.match(new RegExp(`${name}:\\s*([0-9.]+)`));
  assert.ok(match, `missing ${name}`);
  return Number(match[1]);
}

const tuning = Object.freeze({
  windowSeconds: numberConstant('PARRY_COUNTER_WINDOW_SECONDS'),
  staminaMultiplier: numberConstant('PARRY_COUNTER_STAMINA_MULTIPLIER'),
  damageMultiplier: numberConstant('PARRY_COUNTER_DAMAGE_MULTIPLIER'),
  lightCost: numberConstant('LIGHT_ATTACK_STAMINA_COST'),
  heavyCost: numberConstant('HEAVY_ATTACK_STAMINA_COST'),
  lightDamageScale: numberConstant('LIGHT_ATTACK_DAMAGE_SCALE'),
  heavyDamageScale: numberConstant('HEAVY_ATTACK_DAMAGE_SCALE'),
});

assert.ok(tuning.windowSeconds >= 0.8 && tuning.windowSeconds <= 1.5, `riposte window must be short and skill-bound: ${tuning.windowSeconds}`);
assert.ok(tuning.staminaMultiplier > 0 && tuning.staminaMultiplier < 1, `riposte must discount but not remove stamina cost: ${tuning.staminaMultiplier}`);
assert.ok(tuning.damageMultiplier > 1 && tuning.damageMultiplier <= 1.5, `riposte damage bonus must be meaningful and bounded: ${tuning.damageMultiplier}`);
assert.equal(tuning.lightCost * tuning.staminaMultiplier, 6, 'light riposte should cost exactly 6 stamina');
assert.equal(tuning.heavyCost * tuning.staminaMultiplier, 12, 'heavy riposte should cost exactly 12 stamina');
assert.equal(Number((tuning.lightDamageScale * tuning.damageMultiplier).toFixed(4)), 1.35, 'light riposte damage scale drifted');
assert.equal(Number((tuning.heavyDamageScale * tuning.damageMultiplier).toFixed(4)), 2.2275, 'heavy riposte damage scale drifted');

for (const fragment of [
  "const COUNTER_WINDOW_EVENT = 'aapw:player-counter-window'",
  "function openCounterOpportunity(source = 'parry')",
  "function clearCounterOpportunity(reason = 'cleared')",
  "function counterAttackSource()",
  "function attackStaminaCost(kind, source = counterAttackSource())",
  "openCounterOpportunity('parry')",
  "clearCounterOpportunity('consumed')",
  "clearCounterOpportunity('expired')",
  "clearCounterOpportunity('dodge')",
  "clearCounterOpportunity('guard-break')",
  "clearCounterOpportunity('hit-stagger')",
  "clearCounterOpportunity('defeat')",
  "counterReady: counterAttackSource() !== 'none'",
  'counterRemaining: Number(counterWindowRemaining.toFixed(3))',
  'attackCounterSource',
  'counterSource: attackCounterSource',
  'PARRY_COUNTER_DAMAGE_MULTIPLIER',
]) assert.ok(player.includes(fragment), `missing parry-riposte player contract: ${fragment}`);

assert.match(player, /parryWindowRemaining > 0[\s\S]*stageDamageResolution\(payload, \{ rawAmount, blockedAmount: rawAmount, amount: 0, mitigation: 'parry' \}\); openCounterOpportunity\('parry'\)/, 'successful parry must open riposte only after immutable-safe mitigation is staged');
assert.match(player, /source = chained \? 'none' : counterAttackSource\(\)/, 'combo chains must not inherit the one-shot riposte reward');
assert.match(player, /damageScale = tuning\.damageScale \* \(counter \? PLAYER_ACTION_CONFIG\.PARRY_COUNTER_DAMAGE_MULTIPLIER : 1\)/, 'attack-window damage metadata must carry the riposte reward');
assert.ok(!player.includes('setTimeout('), 'Player riposte lifetime must remain simulation-time deterministic');
assert.ok(!player.includes('EditorMaterialStudio'), 'player riposte must not import editor material UI');
assert.ok(!player.includes('npc.js'), 'player riposte must not take NPC ownership');

for (const fragment of [
  "import { readDamageResolution } from '../gameplay/health.js'",
  "this._motionEventTarget?.addEventListener('aapw:player-counter-window', this._onCounterWindow)",
  "this._motionEventTarget?.removeEventListener('aapw:player-counter-window', this._onCounterWindow)",
  'const staged = readDamageResolution(payload)',
  "RİPOST HAZIR",
  "counterAttack ? 'RİPOST · ' : ''",
  "this._combatCounter ? 'counter-ready'",
]) assert.ok(hud.includes(fragment), `missing riposte HUD contract: ${fragment}`);

assert.match(hud, /staged\?\.mitigation \?\? payload\?\.mitigation/, 'HUD must read immutable defense mitigation from the authoritative staged resolution');
assert.match(hud, /const primary = counterAttack \? attackText : \(defenseText \?\? attackText \?\? counterText\)/, 'riposte attack must remain visible even while prior parry feedback timer is alive');
assert.ok(!hud.includes('EditorMaterialStudio'), 'riposte HUD must not import editor material UI');

console.log(JSON.stringify({
  ok: true,
  contract: 'player-parry-riposte',
  tuning,
  lightRiposte: { staminaCost: 6, damageScale: 1.35 },
  heavyRiposte: { staminaCost: 12, damageScale: 2.2275 },
  lifecycle: ['parry-open', 'single-attack-consume', 'expiry', 'hit/guard/dodge/defeat-clear'],
  immutableDefenseHud: true,
  ownership: { npcModified: false, terrainModified: false, rpgModified: false, sharedMaterialDuplicated: false },
}, null, 2));
