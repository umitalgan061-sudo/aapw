/** Persistent FAZ 8 settlement-discovery notifications for desktop, mobile, and PWA play. */

const DEFAULT_DISCOVERY_RADIUS_METERS = 55;
const DEFAULT_VISIBLE_MILLISECONDS = 5_000;
const STORAGE_KEY = 'westeros-pwa:settlement-discoveries:v1';

function readDiscoveries(storage) {
	if (!storage) return new Set();
	try {
		const saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]');
		return new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : []);
	} catch {
		return new Set();
	}
}

function getDefaultStorage() {
	try {
		return globalThis.localStorage;
	} catch {
		return null;
	}
}

export class SettlementDiscovery {
	/**
	 * @param {{seats: {id: string, name: string, x: number, z: number}[], container?: HTMLElement,
	 * storage?: Storage|null, radiusMeters?: number, visibleMilliseconds?: number}} options
	 */
	constructor({
		seats,
		container = document.body,
		storage,
		radiusMeters = DEFAULT_DISCOVERY_RADIUS_METERS,
		visibleMilliseconds = DEFAULT_VISIBLE_MILLISECONDS,
	}) {
		this._seats = seats;
		this._storage = storage === undefined ? getDefaultStorage() : storage;
		this._radiusMeters = radiusMeters;
		this._visibleMilliseconds = visibleMilliseconds;
		this._discovered = readDiscoveries(this._storage);
		this._hideTimeoutId = null;

		this._root = document.createElement('aside');
		this._root.className = 'g3d-settlement-discovery';
		this._root.hidden = true;
		this._root.setAttribute('role', 'status');
		this._root.setAttribute('aria-live', 'polite');
		this._eyebrow = document.createElement('span');
		this._eyebrow.className = 'g3d-settlement-discovery-eyebrow';
		this._eyebrow.textContent = 'Yeni yer keşfedildi';
		this._name = document.createElement('strong');
		this._root.append(this._eyebrow, this._name);
		this._progress = document.createElement('span');
		this._progress.className = 'g3d-settlement-discovery-progress';
		this._progress.setAttribute('aria-label', 'Keşif ilerlemesi');
		this._root.append(this._progress);
		container.appendChild(this._root);
	}

	/** @param {{x: number, z: number}} playerPosition */
	update(playerPosition) {
		for (const seat of this._seats) {
			if (this._discovered.has(seat.id)) continue;
			if (Math.hypot(seat.x - playerPosition.x, seat.z - playerPosition.z) > this._radiusMeters) continue;
			this._discover(seat);
			break;
		}
	}

	_discover(seat) {
		this._discovered.add(seat.id);
		try {
			this._storage?.setItem(STORAGE_KEY, JSON.stringify([...this._discovered]));
		} catch {
			// Storage can be unavailable in private/restricted PWA contexts; session discovery still works.
		}
		this._name.textContent = seat.name;
		this._progress.textContent = `${this._discovered.size} / ${this._seats.length} yerleşim keşfedildi`;
		this._root.hidden = false;
		if (this._hideTimeoutId !== null) clearTimeout(this._hideTimeoutId);
		this._hideTimeoutId = setTimeout(() => {
			this._root.hidden = true;
			this._hideTimeoutId = null;
		}, this._visibleMilliseconds);
	}

	dispose() {
		if (this._hideTimeoutId !== null) clearTimeout(this._hideTimeoutId);
		this._root.remove();
	}
}
