/**
 * Routes normalized cross-device combat actions into the existing player event contract.
 * No state machine or input ownership is created here; `player.js` remains authoritative.
 * @module gameplay/playerCombatActionRouter
 */

const EVENT_NAME = 'aapw:player-combat-input';
const ACTIONS = new Set(['light', 'heavy']);

function normalizeAction(action) {
	if (action === 'lightAttack') return 'light';
	if (action === 'heavyAttack') return 'heavy';
	return action;
}

function normalizeSource(source) {
	return typeof source === 'string' && source.trim() ? source.trim().slice(0, 32) : 'unknown';
}

export function createPlayerCombatActionRouter({ target = globalThis, now = () => Date.now() } = {}) {
	const queue = [];
	let sequence = 0;
	const maxQueue = 16;
	const ttlMs = 750;

	function enqueue(action, source = 'unknown', timestamp = now()) {
		const kind = normalizeAction(action);
		if (!ACTIONS.has(kind)) return false;
		const event = Object.freeze({ kind, source: normalizeSource(source), sequence: ++sequence, timestamp: Number.isFinite(timestamp) ? timestamp : now() });
		queue.push(event);
		if (queue.length > maxQueue) queue.splice(0, queue.length - maxQueue);
		return true;
	}

	function drain({ currentTime = now(), max = maxQueue } = {}) {
		const cutoff = (Number.isFinite(currentTime) ? currentTime : now()) - ttlMs;
		while (queue.length && queue[0].timestamp < cutoff) queue.shift();
		return Object.freeze(queue.splice(0, Math.max(0, Math.min(maxQueue, Math.floor(Number(max) || maxQueue)))));
	}

	function emit(action, source = 'unknown', timestamp = now()) {
		if (!enqueue(action, source, timestamp)) return false;
		const [event] = drain({ currentTime: timestamp, max: 1 });
		if (!event || typeof target?.dispatchEvent !== 'function' || typeof target?.CustomEvent !== 'function') return false;
		target.dispatchEvent(new target.CustomEvent(EVENT_NAME, { detail: event }));
		return true;
	}

	function reset() { queue.length = 0; sequence = 0; }
	return Object.freeze({ enqueue, drain, emit, reset });
}

export { EVENT_NAME as PLAYER_COMBAT_INPUT_EVENT };
