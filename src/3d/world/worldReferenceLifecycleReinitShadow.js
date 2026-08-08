/**
 * Run198 opt-in lifecycle coordinator for the proven Run197 canonical transaction.
 *
 * The default runtime never imports this module. A developer/preflight path may bind it to the
 * pagehide capture phase so an active canonical transaction is rolled back and disposed before the
 * unchanged game3d.js bubble-phase teardown starts disposing current scene/input/UI resources.
 * The coordinator itself owns exactly one removable listener and no timers, DOM, or GPU resources.
 * @module world/worldReferenceLifecycleReinitShadow
 */

export const LIFECYCLE_REINIT_SHADOW_POLICY = Object.freeze({
	key: 'run198-lifecycle-reinit-shadow-v1',
	modeCurrent: 'current',
	modeCanonical: 'canonical',
});

function assertEventTarget(eventTarget) {
	if (!eventTarget || typeof eventTarget.addEventListener !== 'function' || typeof eventTarget.removeEventListener !== 'function') {
		throw new TypeError('eventTarget must expose addEventListener/removeEventListener');
	}
}

function assertGate(gate) {
	for (const name of ['dispose', 'isDisposed', 'getMode']) {
		if (typeof gate?.[name] !== 'function') throw new TypeError(`gate.${name} is required`);
	}
}

/**
 * Binds Run197 disposal ahead of the unchanged current-runtime pagehide teardown.
 * Capture phase is intentional: game3d.js registers its existing pagehide handler without capture,
 * so this gate must finish rollback/disposal first when canonical ownership is active.
 */
export function createLifecycleReinitShadow({ eventTarget = globalThis.window, gate } = {}) {
	assertEventTarget(eventTarget);
	assertGate(gate);
	let disposed = false;
	let pagehideCount = 0;
	let gateDisposeCount = 0;
	let lastReason = null;
	let lastModeBeforeGateDispose = null;

	function disposeGate(reason) {
		if (gate.isDisposed()) return false;
		lastModeBeforeGateDispose = gate.getMode();
		gate.dispose();
		gateDisposeCount += 1;
		lastReason = reason;
		return true;
	}

	function onPagehide() {
		pagehideCount += 1;
		disposeGate('pagehide');
		eventTarget.removeEventListener('pagehide', onPagehide, true);
		disposed = true;
	}

	eventTarget.addEventListener('pagehide', onPagehide, { capture: true, once: true });

	function dispose() {
		if (disposed) return;
		eventTarget.removeEventListener('pagehide', onPagehide, true);
		disposeGate('manual');
		disposed = true;
	}

	function getStats() {
		return Object.freeze({
			pagehideCount,
			gateDisposeCount,
			lastReason,
			lastModeBeforeGateDispose,
			gateDisposed: gate.isDisposed(),
			coordinatorDisposed: disposed,
		});
	}

	return Object.freeze({
		version: LIFECYCLE_REINIT_SHADOW_POLICY.key,
		dispose,
		isDisposed: () => disposed,
		getStats,
	});
}
