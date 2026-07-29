/**
 * Minimal publish/subscribe event bus used as the backbone of inter-system communication.
 *
 * Systems (terrain, weather, player, NPCs, ...) should not hold direct references to each
 * other. Instead they emit/listen on a shared bus. This keeps the architecture open to a
 * future ECS/multiplayer split, where systems could run in different modules/workers and
 * only ever talk through serializable events.
 * @module eventBus
 */

export class EventBus {
	constructor() {
		/** @type {Map<string, Set<Function>>} */
		this._listeners = new Map();
	}

	/**
	 * Subscribe to an event.
	 * @param {string} eventName
	 * @param {(payload?: any) => void} handler
	 * @returns {() => void} Unsubscribe function.
	 */
	on(eventName, handler) {
		if (!this._listeners.has(eventName)) {
			this._listeners.set(eventName, new Set());
		}
		this._listeners.get(eventName).add(handler);
		return () => this.off(eventName, handler);
	}

	/**
	 * Subscribe to an event for a single firing, then auto-unsubscribe.
	 * @param {string} eventName
	 * @param {(payload?: any) => void} handler
	 */
	once(eventName, handler) {
		const wrapped = (payload) => {
			this.off(eventName, wrapped);
			handler(payload);
		};
		this.on(eventName, wrapped);
	}

	/**
	 * @param {string} eventName
	 * @param {(payload?: any) => void} handler
	 */
	off(eventName, handler) {
		this._listeners.get(eventName)?.delete(handler);
	}

	/**
	 * Emit an event to all current subscribers. Handler exceptions are caught and logged so
	 * one broken listener can never stop the rest of the world from ticking.
	 * @param {string} eventName
	 * @param {any} [payload]
	 */
	emit(eventName, payload) {
		const handlers = this._listeners.get(eventName);
		if (!handlers) return;
		for (const handler of [...handlers]) {
			try {
				handler(payload);
			} catch (error) {
				console.error(`[EventBus] listener for "${eventName}" threw:`, error);
			}
		}
	}

	/** Remove every listener for every event. Call on full scene teardown to avoid leaks. */
	clear() {
		this._listeners.clear();
	}
}

/** Shared singleton bus for the whole 3D mode. Individual systems may still create scoped buses. */
export const gameEvents = new EventBus();
