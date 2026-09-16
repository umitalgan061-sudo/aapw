/**
 * Runtime lifecycle coordinator.
 *
 * Provides an explicit state machine for boot, running, suspended, recovering and disposed states.
 * It does not subscribe to the DOM or own a timer. Existing game3d lifecycle code can feed lifecycle
 * intents into this coordinator and keep all cleanup decisions visible in one immutable state record.
 */

const STATES = Object.freeze({ CREATED: 'created', BOOTING: 'booting', RUNNING: 'running', SUSPENDED: 'suspended', RECOVERING: 'recovering', FAILED: 'failed', DISPOSED: 'disposed' });
const EVENTS = Object.freeze({ BOOT: 'boot', READY: 'ready', SUSPEND: 'suspend', RESUME: 'resume', RECOVER: 'recover', FAIL: 'fail', DISPOSE: 'dispose', RESET: 'reset' });
const TRANSITIONS = Object.freeze({
	[STATES.CREATED]: { boot: STATES.BOOTING, dispose: STATES.DISPOSED, fail: STATES.FAILED },
	[STATES.BOOTING]: { ready: STATES.RUNNING, fail: STATES.FAILED, dispose: STATES.DISPOSED },
	[STATES.RUNNING]: { suspend: STATES.SUSPENDED, fail: STATES.FAILED, dispose: STATES.DISPOSED },
	[STATES.SUSPENDED]: { resume: STATES.RUNNING, recover: STATES.RECOVERING, dispose: STATES.DISPOSED, fail: STATES.FAILED },
	[STATES.RECOVERING]: { ready: STATES.RUNNING, fail: STATES.FAILED, dispose: STATES.DISPOSED },
	[STATES.FAILED]: { recover: STATES.RECOVERING, reset: STATES.CREATED, dispose: STATES.DISPOSED },
	[STATES.DISPOSED]: {},
});
const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};

export class RuntimeLifecycleCoordinator {
	constructor({ clock = () => 0 } = {}) {
		this.clock = typeof clock === 'function' ? clock : () => 0;
		this.state = STATES.CREATED;
		this.sequence = 0;
		this.history = [];
		this.lastError = null;
	}

	transition(event, metadata = {}) {
		const next = TRANSITIONS[this.state]?.[event];
		if (!next) return freeze({ accepted: false, state: this.state, event });
		const previous = this.state;
		this.state = next;
		this.sequence += 1;
		const record = freeze({ sequence: this.sequence, timestamp: Number.isFinite(this.clock()) ? this.clock() : 0, previous, event, next, metadata: sanitizeMetadata(metadata) });
		this.history = [...this.history.slice(-31), record];
		if (event === 'fail') this.lastError = record.metadata.message ?? 'runtime-failure';
		if (event === 'reset') this.lastError = null;
		return freeze({ accepted: true, state: this.state, event, record });
	}

	can(event) { return Boolean(TRANSITIONS[this.state]?.[event]); }
	getState() { return this.state; }
	getHistory(limit = 16) { return this.history.slice(-Math.max(1, Math.min(32, Math.round(limit)))); }
	isTerminal() { return this.state === STATES.DISPOSED; }

	snapshot() {
		return freeze({ version: 1, state: this.state, sequence: this.sequence, lastError: this.lastError, history: this.getHistory() });
	}
}

function sanitizeMetadata(metadata) {
	if (!metadata || typeof metadata !== 'object') return {};
	const output = {};
	for (const key of ['phase', 'reason', 'message', 'source', 'code']) {
		if (typeof metadata[key] === 'string') output[key] = metadata[key].slice(0, 160);
	}
	return output;
}

export function createRuntimeLifecycleCoordinator(options) { return new RuntimeLifecycleCoordinator(options); }
export function runtimeLifecycleConstants() { return freeze({ states: STATES, events: EVENTS, transitions: TRANSITIONS }); }
