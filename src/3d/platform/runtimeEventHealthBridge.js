/**
 * Event-driven bridge between existing EventBus lifecycle signals and runtime health telemetry.
 *
 * This bridge is deliberately optional. It subscribes only to the public event names supplied by the
 * caller and returns an explicit unsubscribe function. No gameplay event is rewritten, replayed or
 * persisted. It translates failures into a compact health vocabulary while leaving the originating
 * subsystem authoritative.
 */

const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};

function safeEmit(telemetry, level, name, fields) {
	if (!telemetry || typeof telemetry[level] !== 'function') return;
	telemetry[level](name, fields);
}

export function connectRuntimeEventHealth({ events, names = {}, telemetry, health, now = () => 0 } = {}) {
	if (!events || typeof events.on !== 'function') return () => {};
	const unsubs = [];
	const on = (eventName, handler) => {
		if (!eventName) return;
		const unsubscribe = events.on(eventName, handler);
		if (typeof unsubscribe === 'function') unsubs.push(unsubscribe);
	};
	const emitHealth = (kind, payload = {}) => {
		safeEmit(telemetry, kind === 'error' ? 'error' : 'info', `runtime.event.${kind}`, {
			phase: typeof payload.phase === 'string' ? payload.phase : undefined,
			id: typeof payload.id === 'string' ? payload.id : undefined,
		});
	};

	on(names.assetError, (payload) => emitHealth('asset-error', payload));
	on(names.assetProgress, (payload) => {
		const ratio = Number(payload?.ratio);
		if (Number.isFinite(ratio)) safeEmit(telemetry, 'debug', 'runtime.asset-progress', { ratio: Math.max(0, Math.min(1, ratio)) });
	});
	on(names.assetsReady, (payload) => emitHealth('assets-ready', payload));
	on(names.gameReady, (payload) => emitHealth('game-ready', payload));
	on(names.gameError, (payload) => emitHealth('game-error', payload));
	on(names.playerDied, (payload) => emitHealth('player-died', payload));

	const result = freeze({ version: 1, connected: true, eventCount: unsubs.length, connectedAt: Number.isFinite(now()) ? now() : 0 });
	safeEmit(telemetry, 'info', 'runtime.health-bridge-connected', { eventCount: result.eventCount });

	return () => {
		for (const unsubscribe of unsubs.splice(0)) {
			try { unsubscribe(); } catch { /* EventBus implementations may already be disposed. */ }
		}
		safeEmit(telemetry, 'info', 'runtime.health-bridge-disconnected', {});
	};
}

export function runtimeEventHealthBridgeConstants() {
	return freeze({ version: 1, supported: ['asset-error', 'asset-progress', 'assets-ready', 'game-ready', 'game-error', 'player-died'] });
}
