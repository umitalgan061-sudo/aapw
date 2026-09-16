/**
 * Browser capability compatibility matrix.
 *
 * Browser APIs vary independently: WebGL2 can exist without OffscreenCanvas, a service worker can be
 * active while Cache Storage is unavailable in a private context, and Gamepad support can exist with
 * no connected device. This module turns those independent signals into explicit, testable compatibility
 * states without feature-detect side effects.
 */

const LEVELS = Object.freeze({ NONE: 'none', PARTIAL: 'partial', FULL: 'full' });
const REQUIRED = Object.freeze(['webgl', 'module', 'canvas']);
const OPTIONAL = Object.freeze(['offscreenCanvas', 'serviceWorker', 'cacheStorage', 'indexedDb', 'gamepad', 'webCodecs', 'worker', 'resizeObserver', 'performanceObserver']);

const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};

function support(value) { return value === true ? LEVELS.FULL : value === false ? LEVELS.NONE : LEVELS.PARTIAL; }
function toBoolean(value) { return value === true; }

export function createRuntimeCompatibilityMatrix(input = {}) {
	const canvas = input.canvasSupported ?? (typeof HTMLCanvasElement !== 'undefined');
	const moduleSupport = input.esModules ?? true;
	const webgl = input.webglSupported ?? Boolean(input.webglVersion > 0);
	const webgl2 = input.webgl2 ?? input.webglVersion === 2;
	const offscreen = input.offscreenCanvas ?? (typeof OffscreenCanvas !== 'undefined');
	const serviceWorker = input.serviceWorker ?? Boolean(globalThis.navigator?.serviceWorker);
	const cacheStorage = input.cacheStorage ?? Boolean(globalThis.caches);
	const indexedDb = input.indexedDb ?? typeof indexedDB !== 'undefined';
	const gamepad = input.gamepad ?? Boolean(globalThis.navigator?.getGamepads);
	const worker = input.worker ?? typeof Worker !== 'undefined';
	const webCodecs = input.webCodecs ?? typeof VideoDecoder !== 'undefined';
	const resizeObserver = input.resizeObserver ?? typeof ResizeObserver !== 'undefined';
	const performanceObserver = input.performanceObserver ?? typeof PerformanceObserver !== 'undefined';
	const requiredStates = { webgl: support(webgl ? true : false), module: support(moduleSupport), canvas: support(canvas) };
	const optionalStates = { offscreenCanvas: support(offscreen), serviceWorker: support(serviceWorker), cacheStorage: support(cacheStorage), indexedDb: support(indexedDb), gamepad: support(gamepad), webCodecs: support(webCodecs), worker: support(worker), resizeObserver: support(resizeObserver), performanceObserver: support(performanceObserver) };
	const missingRequired = REQUIRED.filter((key) => requiredStates[key] === LEVELS.NONE);
	const availableOptional = OPTIONAL.filter((key) => optionalStates[key] === LEVELS.FULL);
	const compatibility = missingRequired.length ? LEVELS.NONE : availableOptional.length >= 5 ? LEVELS.FULL : LEVELS.PARTIAL;
	return freeze({
		version: 1,
		level: compatibility,
		required: requiredStates,
		optional: optionalStates,
		webgl: { version: webgl2 ? 2 : webgl ? 1 : 0 },
		features: {
			workerOffload: toBoolean(worker && offscreen),
			offlineCache: toBoolean(serviceWorker && cacheStorage),
			persistentSave: toBoolean(indexedDb),
			inputGamepad: toBoolean(gamepad),
			performanceLongTasks: toBoolean(performanceObserver),
			modernVideoPipeline: toBoolean(webCodecs),
			responsiveObservers: toBoolean(resizeObserver),
		},
		missingRequired,
	});
}

export function compatibilityFeatureEnabled(matrix, feature) {
	return matrix?.features?.[feature] === true;
}

export function compatibilityDigest(matrix) {
	if (!matrix || typeof matrix !== 'object') return 'compatibility-invalid';
	return [matrix.version ?? 0, matrix.level ?? LEVELS.NONE, matrix.webgl?.version ?? 0, ...REQUIRED.map((key) => `${key}:${matrix.required?.[key] ?? LEVELS.NONE}`), ...OPTIONAL.map((key) => `${key}:${matrix.optional?.[key] ?? LEVELS.NONE}`)].join('|');
}

export function runtimeCompatibilityConstants() { return freeze({ levels: LEVELS, required: REQUIRED.slice(), optional: OPTIONAL.slice() }); }
