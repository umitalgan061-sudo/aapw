#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createAudioMusicStatePolicy } from '../src/3d/audio/audioMusicStatePolicy.js';
import { normalizeAudioLoudness, loudnessBalance, applyLoudnessGain } from '../src/3d/audio/audioLoudnessPolicy.js';
import { resolveAudioEnvironment, blendAudioEnvironments } from '../src/3d/audio/audioEnvironmentResolver.js';
import { createAudioPerformanceBudget, audioPerformanceAdmission } from '../src/3d/audio/audioPerformanceBudget.js';
import { createRuntimeDebugContract } from '../src/3d/audio/../platform/runtimeDebugContract.js';

const music = createAudioMusicStatePolicy({ initialState: 'exploration', minimumHoldSeconds: 0.2 });
assert.equal(music.snapshot().current, 'exploration');
music.updateSignals({ settlement: true }, 0.1);
assert.equal(music.snapshot().target, 'settlement');
music.updateSignals({ settlement: true }, 0.2);
assert.equal(music.snapshot().current, 'settlement');
music.updateSignals({ combatIntensity: 0.9 }, 0.02);
assert.equal(music.snapshot().target, 'combat');
music.updateSignals({ combatIntensity: 0.0 }, 0.5);
assert.ok(['settlement', 'combat'].includes(music.snapshot().current));

const quiet = normalizeAudioLoudness({ class: 'ambience', measuredPeakDb: -10, measuredRmsDb: -35, gain: 1 });
const dialogue = normalizeAudioLoudness({ class: 'dialogue', measuredPeakDb: -16, measuredRmsDb: -26, gain: 1, critical: true });
assert.ok(quiet.outputGain <= 0.8);
assert.ok(dialogue.outputGain > 0);
assert.ok(applyLoudnessGain(0.5, dialogue) <= 1);
assert.equal(loudnessBalance([{ class: 'ui', measuredRmsDb: -20 }, { class: 'music', measuredRmsDb: -18 }]).count, 2);

const river = resolveAudioEnvironment({ biome: 'plains', nearWater: 1, stormIntensity: 0, nightFactor: 0 });
assert.equal(river.environment, 'river');
const storm = resolveAudioEnvironment({ biome: 'forest', nearWater: 0, stormIntensity: 0.9, nightFactor: 0 });
assert.equal(storm.environment, 'storm');
const blend = blendAudioEnvironments(river, storm, 0.5);
assert.ok(blend.signals.stormIntensity > 0);

for (const quality of ['minimal', 'balanced', 'high', 'ultra']) {
	const budget = createAudioPerformanceBudget({ quality, measuredCpuMs: 2, measuredSources: 2, measuredTransientRate: 2 });
	assert.ok(budget.budget.maxSources >= 1);
	assert.equal(audioPerformanceAdmission(budget, { kind: 'source', current: budget.budget.maxSources, estimatedCost: 1 }).allowed, false);
	assert.equal(audioPerformanceAdmission(budget, { kind: 'source', current: budget.budget.maxSources, estimatedCost: 1, critical: true }).allowed, true);
}

const debugContract = createRuntimeDebugContract({
	health: { status: 'healthy', capabilities: { tier: 'high', score: 7, cpu: { logicalCores: 8 }, memory: { deviceGb: 8 }, display: { dpr: 1.5 }, pointer: { coarse: false }, accessibility: { reducedMotion: false }, network: { class: 'fast' }, webgl: { version: 2 }, featureMatrix: { quality: { tier: 'high' }, budget: {}, features: {} }, performance: { pressure: 'relaxed', p95: 16, frameBudgetMs: 18, pressureScore: 0.4 }, issues: [] }) },
	governor: { tier: 'high', action: 'hold', sequence: 1 },
	telemetry: { retained: 0, sequence: 0, recent: () => [] },
	offline: { network: { state: 'online' }, storage: { state: 'available' }, update: { state: 'idle' }, resilience: { canPlayOffline: false } },
	lifecycle: { state: 'running', sequence: 1 }, compatibility: { level: 'full', webgl: { version: 2 } },
});
assert.equal(debugContract.status, 'healthy');
assert.equal(debugContract.version, 1);

console.log('IMMERSIVE_AUDIO_POLICIES_PASS');
