/**
 * Runtime recovery plan policy.
 *
 * Converts health signals into a small ordered list of safe recovery actions. Actions are descriptive,
 * not commands: the owning subsystem decides whether it can apply a given action. The policy never
 * resets gameplay state, clears persistence, or reloads the page on its own.
 */

const ACTIONS = Object.freeze({
	REDUCE_RENDER_SCALE: 'reduce-render-scale',
	REDUCE_STREAM_RADIUS: 'reduce-stream-radius',
	DEFER_PREFETCH: 'defer-prefetch',
	DEFER_OPTIONAL_ASSETS: 'defer-optional-assets',
	PAUSE_AMBIENT_ANIMATION: 'pause-ambient-animation',
	ENTER_MEMORY_ONLY: 'enter-memory-only',
	RESTART_OPTIONAL_WORKER: 'restart-optional-worker',
	RECONNECT_PWA: 'reconnect-pwa',
	SHOW_RECOVERY_HINT: 'show-recovery-hint',
});
const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};

export function createRuntimeRecoveryPlan({ health, performance, offline, storage, compatibility, governor } = {}) {
	const actions = [];
	const add = (action, priority, reason) => actions.push({ action, priority, reason });
	if (performance?.pressure === 'critical') {
		add(ACTIONS.REDUCE_RENDER_SCALE, 100, 'critical-frame-pressure');
		add(ACTIONS.REDUCE_STREAM_RADIUS, 90, 'critical-frame-pressure');
		add(ACTIONS.DEFER_OPTIONAL_ASSETS, 80, 'critical-frame-pressure');
		add(ACTIONS.PAUSE_AMBIENT_ANIMATION, 70, 'critical-frame-pressure');
	}
	if (performance?.pressure === 'elevated') add(ACTIONS.REDUCE_RENDER_SCALE, 60, 'elevated-frame-pressure');
	if (offline?.network?.state === 'offline') add(ACTIONS.DEFER_PREFETCH, 95, 'offline');
	if (storage?.state === 'critical') add(ACTIONS.ENTER_MEMORY_ONLY, 100, 'critical-storage');
	else if (storage?.state === 'elevated') add(ACTIONS.DEFER_OPTIONAL_ASSETS, 75, 'elevated-storage');
	if (compatibility?.features?.workerOffload === false) add(ACTIONS.RESTART_OPTIONAL_WORKER, 10, 'worker-unavailable');
	if (offline?.update?.state === 'error') add(ACTIONS.RECONNECT_PWA, 25, 'pwa-update-error');
	if (governor?.action === 'degrade') add(ACTIONS.SHOW_RECOVERY_HINT, 15, 'adaptive-quality-degrade');
	const unique = new Map();
	for (const item of actions.sort((a, b) => b.priority - a.priority)) if (!unique.has(item.action)) unique.set(item.action, item);
	return freeze({ version: 1, healthStatus: health?.status ?? 'unknown', actions: [...unique.values()], count: unique.size });
}

export function recoveryActionConstants() { return freeze({ actions: ACTIONS }); }
