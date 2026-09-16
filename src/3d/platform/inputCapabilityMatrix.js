/**
 * Unified input capability matrix.
 *
 * Keyboard, mouse, gamepad and touch already have separate owners. The problem is not missing input
 * support; it is that UI and gameplay code can make inconsistent assumptions about what a session can
 * actually provide. This module normalizes capability and interaction affordances without installing
 * listeners or owning any input state.
 */

const DEVICE_TYPES = Object.freeze({ DESKTOP: 'desktop', TABLET: 'tablet', MOBILE: 'mobile', UNKNOWN: 'unknown' });
const POINTER_TYPES = Object.freeze({ COARSE: 'coarse', FINE: 'fine', HYBRID: 'hybrid', UNKNOWN: 'unknown' });
const INPUT_METHODS = Object.freeze(['keyboard', 'mouse', 'gamepad', 'touch']);

const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};

function supported(value) { return value === true; }
function positive(value) { return Number.isFinite(value) && value > 0; }

function deviceType({ coarse, width, maxTouchPoints }) {
	if (coarse && width > 900 && maxTouchPoints > 0) return DEVICE_TYPES.TABLET;
	if (coarse) return DEVICE_TYPES.MOBILE;
	if (width > 0) return DEVICE_TYPES.DESKTOP;
	return DEVICE_TYPES.UNKNOWN;
}

function pointerType({ coarse, fine }) {
	if (coarse && fine) return POINTER_TYPES.HYBRID;
	if (coarse) return POINTER_TYPES.COARSE;
	if (fine) return POINTER_TYPES.FINE;
	return POINTER_TYPES.UNKNOWN;
}

export function createInputCapabilityMatrix(input = {}) {
	const media = input.media ?? (typeof window !== 'undefined' ? (query) => window.matchMedia?.(query)?.matches ?? false : null);
	const win = input.window ?? (typeof window !== 'undefined' ? window : null);
	const nav = input.navigator ?? win?.navigator ?? (typeof navigator !== 'undefined' ? navigator : null);
	const coarse = input.coarsePointer ?? Boolean(media?.('(pointer: coarse)'));
	const fine = input.finePointer ?? Boolean(media?.('(pointer: fine)'));
	const width = Number.isFinite(input.viewportWidth) ? input.viewportWidth : Number(win?.innerWidth ?? 0);
	const maxTouchPoints = Number.isFinite(input.maxTouchPoints) ? input.maxTouchPoints : Number(nav?.maxTouchPoints ?? 0);
	const keyboard = input.keyboard ?? Boolean(typeof KeyboardEvent !== 'undefined' || typeof window !== 'undefined');
	const mouse = input.mouse ?? Boolean(fine);
	const touch = input.touch ?? Boolean(coarse || maxTouchPoints > 0);
	const gamepad = input.gamepad ?? Boolean(nav?.getGamepads);
	const pointer = pointerType({ coarse, fine });
	const type = deviceType({ coarse: Boolean(coarse), width, maxTouchPoints });
	const primary = coarse ? 'touch' : fine ? 'mouse' : keyboard ? 'keyboard' : touch ? 'touch' : 'keyboard';
	const methods = {
		keyboard: supported(keyboard),
		mouse: supported(mouse),
		gamepad: supported(gamepad),
		touch: supported(touch),
	};
	const actionHints = {
		move: INPUT_METHODS.filter((method) => methods[method]),
		camera: ['mouse', 'gamepad', 'touch'].filter((method) => methods[method]),
		confirm: ['keyboard', 'gamepad', 'touch', 'mouse'].filter((method) => methods[method]),
		cancel: ['keyboard', 'gamepad', 'touch'].filter((method) => methods[method]),
		attack: ['mouse', 'gamepad', 'touch', 'keyboard'].filter((method) => methods[method]),
	};
	return freeze({
		version: 1,
		device: { type, pointer, primary, width: Math.max(0, Math.round(width)), maxTouchPoints: Math.max(0, Math.round(maxTouchPoints)) },
		methods,
		actionHints,
		features: {
			showTouchHud: Boolean(touch),
			showKeyboardHelp: Boolean(keyboard && !coarse),
			showGamepadHelp: Boolean(gamepad),
			allowHoverInteractions: Boolean(mouse),
			preferLargeControls: Boolean(coarse),
		},
	});
}

export function mergeInputCapabilityMatrix(base, patch) {
	if (!base || typeof base !== 'object') return createInputCapabilityMatrix(patch);
	return freeze({
		...base,
		device: { ...(base.device ?? {}), ...(patch?.device ?? {}) },
		methods: { ...(base.methods ?? {}), ...(patch?.methods ?? {}) },
		features: { ...(base.features ?? {}), ...(patch?.features ?? {}) },
		actionHints: { ...(base.actionHints ?? {}), ...(patch?.actionHints ?? {}) },
	});
}

export function inputCapabilityDigest(matrix) {
	if (!matrix?.methods) return 'input-capability-invalid';
	return [
		matrix.device?.type ?? 'unknown',
		matrix.device?.pointer ?? 'unknown',
		matrix.device?.primary ?? 'keyboard',
		...INPUT_METHODS.map((method) => `${method}:${Boolean(matrix.methods[method])}`),
		...Object.keys(matrix.features ?? {}).sort().map((key) => `${key}:${Boolean(matrix.features[key])}`),
	].join('|');
}

export function inputCapabilityConstants() {
	return freeze({ deviceTypes: DEVICE_TYPES, pointerTypes: POINTER_TYPES, methods: INPUT_METHODS.slice(), positive });
}
