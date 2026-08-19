/**
 * Minimal sound-effect playback for the 3D mode — the first audio in the game
 * (`GOVERNANCE_FULL_GAME_DIRECTIVE.md` §3 item 6: "Ses (müzik + efekt) — Yok. `assets/audio/`
 * fiilen boş." until this run).
 *
 * Scope, deliberately kept small for one bounded subtask, same "smallest first slice" pattern
 * `ui/pauseMenu.js` itself established for its own FAZ gap (run 339): a single UI click cued from
 * `ui/pauseMenu.js`'s open/close transitions. No music, no positional/spatial SFX, no volume
 * control yet — `ui/pauseMenu.js`'s own header already discloses "no volume control" as a deferred
 * scope edge tied to `assets/audio/` being empty; this run closes the "a real sound exists" half of
 * that gap without attempting the "a settings UI to control it" half in the same pass.
 *
 * **Browser autoplay policy.** An `AudioContext` starts `suspended` until a user gesture resumes
 * it. `playClick()` is only ever called from `ui/pauseMenu.js`'s button-click/Escape-keydown
 * handlers (via `game3d.js`'s `onOpenChange`) — both are trusted, synchronous DOM events — so
 * `context.resume()` is fired synchronously at the top of `playClick()`, before any `await`, to
 * stay inside that gesture's call stack instead of losing "user activation" across a microtask
 * boundary.
 *
 * **Error boundary (§8.13).** Every failure mode (no Web Audio support, the file failing to load,
 * playback throwing) is caught and logged, never thrown past this module — one missing UI click
 * must not crash the rest of the game.
 * @module audio/audioManager
 */

import * as THREE from 'three';
import { ASSET_PATHS } from '../config.js';

/** `ASSET_PATHS.AUDIO` has been in `config.js` since Phase 0 ("no magic numbers... add them here
 * instead") but had no reader anywhere in `src/` until this run — same "finally consume a
 * since-Phase-0 config value" pattern `renderQuality.js`'s `shadowMapSize`/`pixelRatioCap` wiring
 * already established (ADR-0288/ADR-0291). */
const CLICK_SOUND_URL = `${ASSET_PATHS.AUDIO}ui-click.wav`;

/** Quiet enough to read as a UI accent, not a jarring beep — picked by ear against the source
 * file (CC0, see `CREDITS.md`), no formula behind this number. */
const CLICK_VOLUME = 0.35;

/**
 * @param {object} options
 * @param {THREE.Camera} options.camera Real scene camera — the `AudioListener` is added as its
 *   child so `THREE.Audio` has an output to route through. This project doesn't use positional
 *   audio yet, so the listener's tracked position/orientation goes unused today but is harmless
 *   (three.js updates it once per frame as part of the camera's own `updateMatrixWorld`).
 * @returns {{playClick: () => Promise<void>, dispose: () => void}}
 */
export function createAudioManager({ camera }) {
	let listener = null;
	let audioLoader = null;
	/** @type {Promise<AudioBuffer|null>|null} */
	let clickBufferPromise = null;

	try {
		listener = new THREE.AudioListener();
		camera.add(listener);
	} catch (error) {
		// A device/browser without usable Web Audio must not take the rest of the game down over
		// one UI click — every method below already treats `listener === null` as "sound disabled".
		console.warn('[audioManager] AudioListener unavailable, sound disabled', error);
		listener = null;
	}

	/** Lazily fetches+decodes the click buffer once, memoized (including the failure case, so a
	 * broken/missing file doesn't retry a network request on every future click). */
	function loadClickBuffer() {
		if (!clickBufferPromise) {
			audioLoader = audioLoader ?? new THREE.AudioLoader();
			clickBufferPromise = new Promise((resolve, reject) => {
				audioLoader.load(CLICK_SOUND_URL, resolve, undefined, reject);
			}).catch((error) => {
				console.warn('[audioManager] click sound failed to load', error);
				return null;
			});
		}
		return clickBufferPromise;
	}

	/** Plays the click once. Safe to call even if audio is unavailable or the buffer hasn't
	 * resolved yet (early-returns; never throws). */
	async function playClick() {
		if (!listener) return;
		const context = listener.context;
		// Initiated before the `await` below on purpose — see the module doc's autoplay-policy note.
		const resumePromise = context.state === 'suspended' ? context.resume().catch(() => {}) : null;
		const buffer = await loadClickBuffer();
		if (resumePromise) await resumePromise;
		if (!buffer) return;
		try {
			const sound = new THREE.Audio(listener);
			sound.setBuffer(buffer);
			sound.setVolume(CLICK_VOLUME);
			// Wrap rather than replace the prototype's `onEnded` (which flips `isPlaying` back to
			// false) so this still disconnects the finished source's audio-graph nodes, without
			// losing that base bookkeeping.
			const baseOnEnded = sound.onEnded.bind(sound);
			sound.onEnded = () => { baseOnEnded(); sound.disconnect(); };
			sound.play();
		} catch (error) {
			console.warn('[audioManager] click sound playback failed', error);
		}
	}

	/** Removes the listener from the camera. No timers/DOM/global listeners were ever added, so
	 * this is the entire memory-leak surface. */
	function dispose() {
		if (listener) camera.remove(listener);
		listener = null;
	}

	return { playClick, dispose };
}
