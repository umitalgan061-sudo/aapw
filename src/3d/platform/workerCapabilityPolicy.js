/**
 * Worker/off-main-thread capability policy.
 *
 * Not every browser/device combination benefits from offloading small tasks. This policy considers
 * Worker/OffscreenCanvas support, CPU headroom, memory pressure and accessibility/network constraints
 * and returns explicit work classes that may be delegated by a future owner.
 */

const WORK_CLASSES = Object.freeze({ TERRAIN_ANALYSIS: 'terrain-analysis', ASSET_INDEX: 'asset-index', DIAGNOSTICS: 'diagnostics', PATH_PLANNING: 'path-planning', VISUAL_PREP: 'visual-prep' });
const MODES = Object.freeze({ DISABLED: 'disabled', OPTIONAL: 'optional', PREFERRED: 'preferred' });
const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};

function mode({ supported, cores, mobile, saveData, reducedMotion }) {
	if (!supported || cores < 4) return MODES.DISABLED;
	if (mobile || saveData || reducedMotion) return MODES.OPTIONAL;
	return cores >= 8 ? MODES.PREFERRED : MODES.OPTIONAL;
}

export function createWorkerCapabilityPolicy(capabilities = {}, compatibility = {}) {
	const supported = compatibility.features?.workerOffload === true || capabilities.worker === true;
	const cores = Math.max(1, Math.round(Number(capabilities.cpu?.logicalCores ?? 2)));
	const mobile = capabilities.pointer?.coarse === true;
	const saveData = capabilities.network?.saveData === true;
	const reducedMotion = capabilities.accessibility?.reducedMotion === true;
	const selectedMode = mode({ supported, cores, mobile, saveData, reducedMotion });
	const budgets = {
		maxConcurrentWorkers: selectedMode === MODES.PREFERRED ? Math.min(4, Math.floor(cores / 4)) : selectedMode === MODES.OPTIONAL ? 1 : 0,
		maxTaskMs: selectedMode === MODES.PREFERRED ? 12 : selectedMode === MODES.OPTIONAL ? 6 : 0,
		maxQueuedTasks: selectedMode === MODES.PREFERRED ? 24 : selectedMode === MODES.OPTIONAL ? 8 : 0,
	};
	return freeze({
		version: 1,
		supported,
		mode: selectedMode,
		budgets,
		classes: Object.fromEntries(Object.values(WORK_CLASSES).map((name) => [name, selectedMode])),
		rules: { neverBlockCriticalBoot: true, neverRequireWorker: true, preserveDeterminism: true, respectSaveData: saveData, respectReducedMotion: reducedMotion },
	});
}

export function workerTaskAllowed(policy, task, estimatedMs = 0) {
	if (!policy || policy.mode === MODES.DISABLED) return false;
	if (!Object.values(WORK_CLASSES).includes(task)) return false;
	if (Number.isFinite(estimatedMs) && estimatedMs > policy.budgets.maxTaskMs) return true;
	return policy.classes?.[task] !== MODES.DISABLED;
}

export function workerCapabilityConstants() { return freeze({ classes: WORK_CLASSES, modes: MODES }); }
