/**
 * Offline/PWA resilience coordinator.
 *
 * Service-worker installation is deliberately kept outside the gameplay bootstrap, but runtime code
 * still needs a safe way to understand online/offline state, update availability and storage pressure.
 * This module provides a side-effect-light coordinator. It never blocks gameplay on a network request,
 * never uploads diagnostics, and never clears caches automatically.
 *
 * Browser capabilities are injected where possible so the contract is usable in Node and headless tests.
 */

const STATES = Object.freeze({ ONLINE: 'online', OFFLINE: 'offline', UNKNOWN: 'unknown' });
const UPDATE_STATES = Object.freeze({ UNSUPPORTED: 'unsupported', IDLE: 'idle', CHECKING: 'checking', AVAILABLE: 'available', ERROR: 'error' });
const STORAGE_STATES = Object.freeze({ AVAILABLE: 'available', LIMITED: 'limited', UNAVAILABLE: 'unavailable', UNKNOWN: 'unknown' });

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};

function readNetworkState(win, nav) {
	if (typeof nav?.onLine === 'boolean') return nav.onLine ? STATES.ONLINE : STATES.OFFLINE;
	if (typeof win?.navigator?.onLine === 'boolean') return win.navigator.onLine ? STATES.ONLINE : STATES.OFFLINE;
	return STATES.UNKNOWN;
}

function estimateStorage(storageEstimate) {
	const usage = Number(storageEstimate?.usage);
	const quota = Number(storageEstimate?.quota);
	if (!Number.isFinite(quota) || quota <= 0) return { state: STORAGE_STATES.UNKNOWN, usageBytes: null, quotaBytes: null, ratio: null };
	const ratio = clamp((Number.isFinite(usage) ? usage : 0) / quota, 0, 1);
	const state = ratio >= 0.9 ? STORAGE_STATES.LIMITED : STORAGE_STATES.AVAILABLE;
	return { state, usageBytes: Number.isFinite(usage) ? usage : 0, quotaBytes: quota, ratio: Number(ratio.toFixed(4)) };
}

function registrationState(registration) {
	if (!registration) return UPDATE_STATES.UNSUPPORTED;
	if (registration.waiting) return UPDATE_STATES.AVAILABLE;
	return UPDATE_STATES.IDLE;
}

export function createOfflineResilience(input = {}) {
	const win = input.window ?? (typeof window !== 'undefined' ? window : null);
	const nav = input.navigator ?? win?.navigator ?? (typeof navigator !== 'undefined' ? navigator : null);
	const cachesApi = input.caches ?? globalThis.caches;
	let registration = input.registration ?? null;
	let updateState = registrationState(registration);
	let onlineState = input.onlineState ?? readNetworkState(win, nav);
	let storage = input.storageEstimate ?? { state: STORAGE_STATES.UNKNOWN, usageBytes: null, quotaBytes: null, ratio: null };
	let sequence = 0;
	let disposed = false;

	async function refreshStorage() {
		if (disposed) return snapshot();
		try {
			const estimate = await nav?.storage?.estimate?.();
			storage = estimateStorage(estimate);
		} catch {
			storage = { state: STORAGE_STATES.UNKNOWN, usageBytes: null, quotaBytes: null, ratio: null };
		}
		sequence += 1;
		return snapshot();
	}

	async function inspectCaches(cacheName = null) {
		if (!cachesApi?.keys) return freeze({ supported: false, cacheCount: 0, names: [] });
		try {
			const names = await cachesApi.keys();
			const filtered = cacheName ? names.filter((name) => name === cacheName) : names;
			return freeze({ supported: true, cacheCount: filtered.length, names: filtered.slice().sort() });
		} catch (error) {
			return freeze({ supported: true, cacheCount: 0, names: [], error: String(error).slice(0, 160) });
		}
	}

	async function checkForUpdate() {
		if (disposed) return snapshot();
		if (!registration?.update) {
			updateState = UPDATE_STATES.UNSUPPORTED;
			return snapshot();
		}
		updateState = UPDATE_STATES.CHECKING;
		sequence += 1;
		try {
			await registration.update();
			updateState = registration.waiting ? UPDATE_STATES.AVAILABLE : UPDATE_STATES.IDLE;
		} catch {
			updateState = UPDATE_STATES.ERROR;
		}
		sequence += 1;
		return snapshot();
	}

	function setOnline(value) {
		onlineState = value === true ? STATES.ONLINE : value === false ? STATES.OFFLINE : STATES.UNKNOWN;
		sequence += 1;
		return snapshot();
	}

	function attachRegistration(value) {
		registration = value ?? null;
		updateState = registrationState(registration);
		sequence += 1;
		return snapshot();
	}

	function snapshot() {
		return freeze({
			version: 1,
			sequence,
			network: { state: onlineState },
			update: { state: updateState, controller: Boolean(nav?.serviceWorker?.controller), supported: Boolean(nav?.serviceWorker) },
			storage: { ...storage },
			cacheApi: { supported: Boolean(cachesApi?.keys) },
			resilience: {
				canPlayOffline: onlineState !== STATES.ONLINE || Boolean(nav?.serviceWorker?.controller),
				shouldDeferHeavyPrefetch: onlineState !== STATES.ONLINE || storage.state === STORAGE_STATES.LIMITED,
				shouldAvoidCacheMutation: storage.state === STORAGE_STATES.LIMITED || onlineState === STATES.OFFLINE,
			},
		});
	}

	function dispose() {
		disposed = true;
	}

	return { snapshot, setOnline, attachRegistration, refreshStorage, inspectCaches, checkForUpdate, dispose, get isDisposed() { return disposed; } };
}

export function offlineResilienceConstants() {
	return freeze({ states: STATES, updates: UPDATE_STATES, storage: STORAGE_STATES });
}
