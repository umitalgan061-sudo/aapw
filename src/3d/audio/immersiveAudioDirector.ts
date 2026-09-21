// @ts-nocheck
/**
 * Immersive audio director.
 *
 * This is the integration layer between the pure audio policies and the existing AudioListener owned by
 * `audioManager.js`. It deliberately does not own requestAnimationFrame, DOM listeners, game state or
 * EventBus subscriptions. The game loop calls `update()` and event owners call the cue helpers.
 *
 * The director coordinates a procedural sound bank, spatial registry, duck bus, soundscape and
 * accessibility profile. Its public snapshots are immutable and its graph allocation is bounded by the
 * selected quality tier. When Web Audio is missing, every method degrades to a valid no-op snapshot.
 */

import { createImmersiveAudioPolicy, evaluateAudioSource, allocateAudioSources } from './immersiveAudioPolicy.js';
import { createSpatialAudioRegistry } from './spatialAudioRegistry.js';
import { createAudioDuckBus } from './audioDuckBus.js';
import { createProceduralSoundBank } from './proceduralSoundBank.js';
import { createEnvironmentSoundscape } from './environmentSoundscape.js';
import { createAudioAccessibilityPolicy, applyAudioAccessibilityGain } from './audioAccessibilityPolicy.js';
import { evaluateAudioOcclusion, smoothOcclusion } from './audioOcclusionPolicy.js';

const GROUPS = Object.freeze(['music', 'ambience', 'weather', 'water', 'npc', 'player', 'combat', 'dialogue', 'ui', 'debug']);
const QUALITY = Object.freeze(['minimal', 'balanced', 'high', 'ultra']);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };

function safeTier(tier) { return QUALITY.includes(tier) ? tier : 'balanced'; }
function point(position) { return { x: finiteOr(position?.x, 0), y: finiteOr(position?.y, 0), z: finiteOr(position?.z, 0) }; }

export class ImmersiveAudioDirector {
	constructor({ listener = null, quality = 'balanced', environment = 'unknown', reducedMotion = false, coarsePointer = false, accessibility = null, context = null, seed = 1337, maxDistance = 120 } = {}) {
		this.listener = listener;
		this.context = context ?? listener?.context ?? null;
		this.quality = safeTier(quality);
		this.policy = createImmersiveAudioPolicy({ quality: this.quality, environment, reducedMotion, coarsePointer, maxDistance });
		this.accessibility = accessibility ?? createAudioAccessibilityPolicy();
		this.registry = createSpatialAudioRegistry({ maxSources: this.policy.limits.maxSources, maxPositionalSources: this.policy.limits.maxPositionalSources, maxDistance: this.policy.listener.maxDistance });
		this.bank = createProceduralSoundBank({ context: this.context, seed, masterGain: this.policy.listener.masterVolume });
		this.duckBus = createAudioDuckBus();
		this.soundscape = createEnvironmentSoundscape({ bank: this.bank, policy: this.policy });
		this.listenerPosition = { x: 0, y: 0, z: 0 };
		this.listenerForward = { x: 0, y: 0, z: -1 };
		this.latestAdmissions = null;
		this.latestOcclusion = { blocked: false, gain: 1, cutoffHz: 18000, reverbSend: 0, severity: 0 };
		this.enabled = Boolean(this.context?.createGain && this.context?.destination) || Boolean(listener);
		this.disposed = false;
		this.sequence = 0;
	}

	setListenerPose(position, forward = this.listenerForward) {
		if (this.disposed) return this.snapshot();
		this.listenerPosition = point(position);
		this.listenerForward = point(forward);
		try {
			this.listener?.positionX?.setValueAtTime?.(this.listenerPosition.x, this.context?.currentTime ?? 0);
			this.listener?.positionY?.setValueAtTime?.(this.listenerPosition.y, this.context?.currentTime ?? 0);
			this.listener?.positionZ?.setValueAtTime?.(this.listenerPosition.z, this.context?.currentTime ?? 0);
			this.listener?.forwardX?.setValueAtTime?.(this.listenerForward.x, this.context?.currentTime ?? 0);
			this.listener?.forwardY?.setValueAtTime?.(this.listenerForward.y, this.context?.currentTime ?? 0);
			this.listener?.forwardZ?.setValueAtTime?.(this.listenerForward.z, this.context?.currentTime ?? 0);
		} catch {}
		this.sequence += 1;
		return this.snapshot();
	}

	setEnvironment(environment, state = {}) {
		if (this.disposed) return this.snapshot();
		this.soundscape.setEnvironment(environment, state);
		this.sequence += 1;
		return this.snapshot();
	}

	registerSource(request) {
		const normalized = { ...request, gain: applyAudioAccessibilityGain(request?.gain ?? 1, this.accessibility, { transient: request?.transient, dialogue: request?.class === 'dialogue' }) };
		return this.registry.register(normalized);
	}

	updateSource(id, patch) { return this.registry.update(id, patch); }
	removeSource(id) { return this.registry.unregister(id); }

	setDuck(group, active, options = {}) {
		return this.duckBus.request(group, { ...options, active });
	}

	clearDuck(id) { return this.duckBus.clear(id); }

	applyOcclusion(result) {
		const target = evaluateAudioOcclusion(result);
		this.latestOcclusion = smoothOcclusion(this.latestOcclusion, target, finiteOr(result?.deltaSeconds, 0.016));
		this.sequence += 1;
		return this.latestOcclusion;
	}

	triggerCue(kind, options = {}) {
		if (this.disposed) return false;
		const normalizedKind = String(kind ?? 'ambience');
		if (normalizedKind === 'dragon') return this.soundscape.triggerDragonPulse(options);
		if (normalizedKind === 'combat') return this.soundscape.triggerCombatPulse(options);
		if (normalizedKind === 'footstep') return this.soundscape.triggerFootstep(options);
		if (normalizedKind === 'storm') return this.soundscape.triggerStormPulse(options);
		if (normalizedKind === 'ui') return this.bank.triggerPulse('ui', { gain: options.gain ?? 0.15, frequency: 520, duration: 0.05 });
		return this.bank.triggerPulse('ambience', { gain: options.gain ?? 0.1, frequency: options.frequency ?? 260, duration: options.duration ?? 0.12 });
	}

	update(deltaSeconds = 0.016, world = {}) {
		if (this.disposed) return this.snapshot();
		const dt = clamp(finiteOr(deltaSeconds, 0), 0, 0.25);
		this.duckBus.update(dt);
		this.soundscape.update(dt);
		const listener = point(world.listenerPosition ?? this.listenerPosition);
		this.listenerPosition = listener;
		if (world.listenerForward) this.listenerForward = point(world.listenerForward);
		const admissions = this.registry.selectAdmissions({ listenerPosition: listener, maxSources: this.policy.limits.maxSources, maxPositionalSources: this.policy.limits.maxPositionalSources });
		this.latestAdmissions = admissions;
		this.sequence += 1;
		return this.snapshot();
	}

	allocate(requests = []) {
		const decisions = allocateAudioSources(requests, this.policy);
		this.sequence += 1;
		return decisions;
	}

	evaluateSource(request = {}) { return evaluateAudioSource(request, this.policy); }

	setMasterVolume(volume) {
		const safe = clamp(finiteOr(volume, 1), 0, 1);
		this.bank.setMasterGain(safe);
		try { this.listener?.setMasterVolume?.(safe); } catch {}
		this.sequence += 1;
		return safe;
	}

	setAccessibility(accessibility) { this.accessibility = accessibility ?? createAudioAccessibilityPolicy(); this.sequence += 1; return this.snapshot(); }

	snapshot() {
		return freeze({
			version: 1,
			disposed: this.disposed,
			enabled: this.enabled,
			sequence: this.sequence,
			quality: this.quality,
			listener: { position: { ...this.listenerPosition }, forward: { ...this.listenerForward } },
			policy: this.policy,
			accessibility: this.accessibility,
			registry: this.registry.snapshot(),
			duck: this.duckBus.snapshot(),
			soundscape: this.soundscape.snapshot(),
			bank: this.bank.snapshot(),
			admissions: this.latestAdmissions,
			occlusion: this.latestOcclusion,
		});
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.registry.dispose();
		this.duckBus.dispose();
		this.soundscape.dispose();
		this.bank.dispose();
	}
}

export function createImmersiveAudioDirector(options) { return new ImmersiveAudioDirector(options); }
export function immersiveAudioDirectorConstants() { return freeze({ groups: GROUPS, quality: QUALITY }); }
