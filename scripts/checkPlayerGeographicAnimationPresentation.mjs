#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PLAYER_GEOGRAPHIC_ANIMATION_PRESENTATION_POLICY,
  auditAnimationFamily,
  createPlayerAnimationPresentationState,
  resolvePlayerGeographicAnimationPresentation,
  selectAvailableAnimationFamily,
} from '../src/3d/gameplay/playerGeographicAnimationPresentation.js';

const ANIMATION_ROOT = 'assets/animations/peasant_girl';
const REQUIRED_ANIMATIONS = ['idle.fbx', 'walking.fbx', 'running.fbx'];
const source = fs.readFileSync(new URL('../src/3d/gameplay/playerGeographicAnimationPresentation.js', import.meta.url), 'utf8');

assert.equal(source.includes('EditorMaterialStudio'), false);
assert.equal(source.includes("node:fs"), false, 'browser animation presentation must not import node fs');
assert.match(source, /playerStateOwnerUnchanged/);
assert.match(source, /materialOwnerUnchanged/);
assert.match(source, /worldTerrainOwnerUnchanged/);
assert.equal(PLAYER_GEOGRAPHIC_ANIMATION_PRESENTATION_POLICY.domFree, true);
assert.equal(PLAYER_GEOGRAPHIC_ANIMATION_PRESENTATION_POLICY.playerStateOwnerUnchanged, true);

for (const file of REQUIRED_ANIMATIONS) {
  assert.equal(fs.existsSync(new URL(`../${ANIMATION_ROOT}/${file}`, import.meta.url)), true, `missing shipped player animation: ${file}`);
}

const visualContexts = [
  { profileKey: 'snow', biomeKind: 'snow', condition: { climate: 'frost', frost: 0.82, wet: 0.12 } },
  { profileKey: 'marsh', biomeKind: 'marsh', condition: { climate: 'wet', frost: 0.04, wet: 0.86 } },
  { profileKey: 'desert', biomeKind: 'desert', condition: { climate: 'dry', frost: 0, wet: 0.02 } },
  { profileKey: 'lush', biomeKind: 'lush-grassland', condition: { climate: 'temperate', frost: 0.01, wet: 0.29 } },
];

const presentations = visualContexts.flatMap((visualState, index) => [
  resolvePlayerGeographicAnimationPresentation({ visualState, speedMps: 0, slopeDegrees: 2, staminaRatio: 1, poiseRatio: 1, comboStep: 1 }),
  resolvePlayerGeographicAnimationPresentation({ visualState, speedMps: 3.2, slopeDegrees: 8, staminaRatio: 0.9, poiseRatio: 0.8, comboStep: 2 }),
  resolvePlayerGeographicAnimationPresentation({ visualState, speedMps: 7.8, slopeDegrees: 18, staminaRatio: 0.7, poiseRatio: 0.6, attacking: index % 2 === 0, attackKind: index % 2 === 0 ? 'light' : 'heavy', comboStep: 3 }),
]);

for (const [index, presentation] of presentations.entries()) {
  assert.equal(['idle', 'walk', 'run'].includes(presentation.phase), true, `invalid locomotion phase ${index}`);
  assert.equal(presentation.animationFamily.idle.required, true);
  assert.equal(presentation.animationFamily.walk.required, true);
  assert.equal(presentation.animationFamily.run.required, true);
  for (const key of ['locomotionTimescale', 'turnMultiplier', 'attackTimescale', 'footPlantBias']) {
    assert.ok(Number.isFinite(Number(presentation[key])), `${key} must be finite`);
  }
  assert.ok(presentation.locomotionTimescale >= 0.55 && presentation.locomotionTimescale <= 1.65);
  assert.ok(presentation.turnMultiplier >= 0.45 && presentation.turnMultiplier <= 1);
  assert.ok(presentation.attackTimescale >= 0.82 && presentation.attackTimescale <= 1.18);
}

const snowRun = resolvePlayerGeographicAnimationPresentation({ visualState: visualContexts[0], speedMps: 7.8, slopeDegrees: 0 });
const lushRun = resolvePlayerGeographicAnimationPresentation({ visualState: visualContexts[3], speedMps: 7.8, slopeDegrees: 0 });
assert.ok(snowRun.locomotionTimescale < lushRun.locomotionTimescale, 'snow should not animate faster than lush terrain at the same speed');
assert.ok(snowRun.footPlantBias > lushRun.footPlantBias, 'frost should increase foot planting bias');

const marshAttack = resolvePlayerGeographicAnimationPresentation({ visualState: visualContexts[1], speedMps: 2.5, slopeDegrees: 6, staminaRatio: 0.55, poiseRatio: 0.45, attacking: true, attackKind: 'heavy', comboStep: 3 });
assert.equal(marshAttack.attackKind, 'heavy');
assert.ok(marshAttack.attackTimescale < 1.0);
assert.equal(marshAttack.comboStep, 3);
assert.equal(marshAttack.attackCommitMultiplier, 1.16);

const available = { idle: {}, walk: {}, run: {}, lightAttack: {}, guard: {} };
assert.equal(auditAnimationFamily(available).ok, true);
assert.equal(selectAvailableAnimationFamily(available, { preferredPhase: 'run' }), 'run');
assert.equal(selectAvailableAnimationFamily(available, { preferredPhase: 'run', attackKind: 'light' }), 'lightAttack');
assert.equal(selectAvailableAnimationFamily(available, { preferredPhase: 'run', dodging: true }), 'run');
assert.equal(selectAvailableAnimationFamily({ idle: {}, walk: {}, run: {} }, { preferredPhase: 'run', attackKind: 'heavy' }), 'run');
assert.equal(auditAnimationFamily({ idle: {}, walk: {} }).ok, false);
assert.deepEqual(auditAnimationFamily({ idle: {}, walk: {} }).missingRequired, ['run']);

const state = createPlayerAnimationPresentationState({ source: 'acceptance' });
const first = state.update(0.016, { visualState: visualContexts[3], speedMps: 0.1, slopeDegrees: 2 });
assert.equal(first.phase, 'idle');
assert.equal(first.phaseChanged, true);
const second = state.update(0.016, { visualState: visualContexts[3], speedMps: 6.5, slopeDegrees: 4 });
assert.equal(second.phase, 'run');
assert.equal(second.phaseChanged, true);
assert.ok(second.phaseTransitionAge <= 0.001);
const third = state.update(0.016, { visualState: visualContexts[3], speedMps: 6.8, slopeDegrees: 4 });
assert.equal(third.phase, 'run');
assert.equal(third.phaseChanged, false);
assert.ok(third.phaseTransitionAge > 0);
state.dispose();
assert.throws(() => state.update(0.016, { visualState: visualContexts[3], speedMps: 1 }), /disposed/);

for (const sample of [[0, 0, 0], [3.3, 5, 1], [7.5, 17, 2]]) {
  const [speedMps, slopeDegrees, comboStep] = sample;
  const a = resolvePlayerGeographicAnimationPresentation({ visualState: visualContexts[2], speedMps, slopeDegrees, comboStep });
  const b = resolvePlayerGeographicAnimationPresentation({ visualState: visualContexts[2], speedMps, slopeDegrees, comboStep });
  assert.deepEqual(a, b, `animation presentation is not deterministic for sample ${JSON.stringify(sample)}`);
}

const report = {
  ok: true,
  version: PLAYER_GEOGRAPHIC_ANIMATION_PRESENTATION_POLICY.version,
  shippedAnimations: REQUIRED_ANIMATIONS.map((file) => `${ANIMATION_ROOT}/${file}`),
  sampleCount: presentations.length,
  snowRunTimescale: snowRun.locomotionTimescale,
  lushRunTimescale: lushRun.locomotionTimescale,
  frostFootPlantBias: snowRun.footPlantBias,
  lushFootPlantBias: lushRun.footPlantBias,
  heavyAttackTimescaleInMarsh: marshAttack.attackTimescale,
  comboCommitMultiplier: marshAttack.attackCommitMultiplier,
  missingAssets: 0,
  consoleErrors: 0,
};

console.log(JSON.stringify(report, null, 2));
console.log('PLAYER_GEOGRAPHIC_ANIMATION_PRESENTATION_OK');
