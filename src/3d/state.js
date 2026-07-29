/**
 * Tiny reactive-ish state store for cross-system values (loading progress, quality level,
 * current phase, last error). Systems read via `get`, write via `set`, and anyone can react
 * by subscribing to the bus for `state:<key>` events instead of polling.
 * @module state
 */

import { gameEvents } from './eventBus.js';
import { WORLD_DEFAULTS } from './config.js';

export class GameState {
	/**
	 * @param {object} [options]
	 * @param {import('./eventBus.js').EventBus} [options.events]
	 */
	constructor({ events = gameEvents } = {}) {
		this.events = events;
		/** @private */
		this._state = {
			quality: WORLD_DEFAULTS.DEFAULT_QUALITY,
			isLoading: true,
			loadProgress: 0,
			currentPhase: 'boot',
			error: null,
		};
	}

	/**
	 * @param {string} key
	 * @returns {*}
	 */
	get(key) {
		return this._state[key];
	}

	/**
	 * Sets a value and emits `state:<key>` with `{ value, previous }` if it actually changed.
	 * @param {string} key
	 * @param {*} value
	 */
	set(key, value) {
		const previous = this._state[key];
		if (previous === value) return;
		this._state[key] = value;
		this.events.emit(`state:${key}`, { value, previous });
	}

	/** @returns {Record<string, *>} A shallow copy of the current state, for debug panels/saves. */
	snapshot() {
		return { ...this._state };
	}
}

/** Shared singleton store for the whole 3D mode. */
export const gameState = new GameState();
