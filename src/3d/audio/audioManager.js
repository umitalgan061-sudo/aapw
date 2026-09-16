/**
 * Production audio facade for the 3D mode.
 *
 * Keeps the established click/discovery API intact while adding a bounded immersive director for
 * procedural world ambience, spatial source policy, dynamic ducking, occlusion and accessibility.
 * The facade still owns the AudioListener lifecycle because that was already its responsibility; the
 * immersive director is a contained policy/graph layer beneath it and remains fail-closed when Web Audio
 * is unavailable.
 */

import * as THREE from 'three';
import { ASSET_PATHS, STORAGE_KEYS } from '../config.js';
import { createImmersiveAudioDirector } from './immersiveAudioDirector.js';
import { createAudioSnapshot, serializeAudioSnapshot } from './audioSnapshot.js';

const CLICK_SOUND_URL = `${ASSET_PATHS.AUDIO}ui-click.wav`;
const CLICK_VOLUME = 0.35;
const DISCOVERY_CHIME_VOLUME = 0.22;
const DISCOVERY_CHIME_PLAYBACK_RATE = 1.6;

export function readStoredMuted() {
	try { return globalThis.localStorage?.getItem(STORAGE_KEYS.SOUND_MUTED) === '1'; } catch { return false; }
}

/**
 * Existing callers only need the legacy four methods. New runtime callers can consume the additional
 * immersive methods without knowing anything about Web Audio internals. `quality`, accessibility and
 * environment options are optional so older scene bootstrap code remains source compatible.
 */
export function createAudioManager({ camera, initialMuted = false, quality = 'balanced', reducedMotion = false, coarsePointer = false, environment = 'plains' }) {
	let listener = null;
	let audioLoader = null;
	let muted = !!initialMuted;
	let clickBufferPromise = null;
	let audioDirector = null;

	try {
		listener = new THREE.AudioListener();
		camera.add(listener);
		listener.setMasterVolume(muted ? 0 : 1);
		try {
			audioDirector = createImmersiveAudioDirector({ listener, quality, reducedMotion, coarsePointer, environment });
		} catch (error) {
			console.warn('[audioManager] immersive audio director unavailable, legacy cues remain active', error);
			audioDirector = null;
		}
	} catch (error) {
		console.warn('[audioManager] AudioListener unavailable, sound disabled', error);
		listener = null;
	}

	function loadClickBuffer() {
		if (!clickBufferPromise) {
			audioLoader = audioLoader ?? new THREE.AudioLoader();
			clickBufferPromise = new Promise((resolve, reject) => audioLoader.load(CLICK_SOUND_URL, resolve, undefined, reject))
				.catch((error) => { console.warn('[audioManager] click sound failed to load', error); return null; });
		}
		return clickBufferPromise;
	}

	async function playBuffer(volume, playbackRate) {
		if (!listener) return;
		const context = listener.context;
		const resumePromise = context?.state === 'suspended' ? context.resume().catch(() => {}) : null;
		const buffer = await loadClickBuffer();
		if (resumePromise) await resumePromise;
		if (!buffer) return;
		try {
			const sound = new THREE.Audio(listener);
			sound.setBuffer(buffer);
			sound.setVolume(volume);
			sound.setPlaybackRate(playbackRate);
			const baseOnEnded = sound.onEnded.bind(sound);
			sound.onEnded = () => { baseOnEnded(); sound.disconnect(); };
			sound.play();
		} catch (error) { console.warn('[audioManager] sound playback failed', error); }
	}

	function playClick() { audioDirector?.triggerCue?.('ui', { gain: CLICK_VOLUME }) ; return playBuffer(CLICK_VOLUME, 1); }
	function playDiscoveryChime() { audioDirector?.triggerCue?.('ambience', { gain: DISCOVERY_CHIME_VOLUME }); return playBuffer(DISCOVERY_CHIME_VOLUME, DISCOVERY_CHIME_PLAYBACK_RATE); }
	function setMuted(next) { muted = !!next; if (listener) listener.setMasterVolume(muted ? 0 : 1); audioDirector?.setMasterVolume?.(muted ? 0 : 1); }
	function isMuted() { return muted; }

	function update(deltaSeconds, world = {}) { return audioDirector?.update?.(deltaSeconds, world) ?? null; }
	function setEnvironment(nextEnvironment, state = {}) { return audioDirector?.setEnvironment?.(nextEnvironment, state) ?? null; }
	function registerSpatialSource(source) { return audioDirector?.registerSource?.(source) ?? null; }
	function updateSpatialSource(id, patch) { return audioDirector?.updateSource?.(id, patch) ?? null; }
	function removeSpatialSource(id) { return audioDirector?.removeSource?.(id) ?? false; }
	function setAudioDuck(group, active, options = {}) { return audioDirector?.setDuck?.(group, active, options) ?? null; }
	function clearAudioDuck(id) { return audioDirector?.clearDuck?.(id) ?? false; }
	function applyAudioOcclusion(result) { return audioDirector?.applyOcclusion?.(result) ?? null; }
	function playWorldCue(kind, options = {}) { return audioDirector?.triggerCue?.(kind, options) ?? false; }
	function getImmersiveSnapshot() { return audioDirector?.snapshot?.() ?? null; }
	function getAudioSnapshot() { return createAudioSnapshot({ director: audioDirector }); }
	function getAudioSnapshotJson() { return serializeAudioSnapshot({ director: audioDirector }); }

	function dispose() {
		try { audioDirector?.dispose?.(); } catch (error) { console.warn('[audioManager] immersive audio dispose failed', error); }
		audioDirector = null;
		if (listener) camera.remove(listener);
		listener = null;
	}

	return {
		playClick,
		playDiscoveryChime,
		setMuted,
		isMuted,
		update,
		setEnvironment,
		registerSpatialSource,
		updateSpatialSource,
		removeSpatialSource,
		setAudioDuck,
		clearAudioDuck,
		applyAudioOcclusion,
		playWorldCue,
		getImmersiveSnapshot,
		getAudioSnapshot,
		getAudioSnapshotJson,
		dispose,
	};
}
