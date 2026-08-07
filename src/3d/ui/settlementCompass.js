/** Nearest-settlement compass for discoverability in the FAZ 8 HUD. */

export class SettlementCompass {
	/**
	 * @param {{seats: {name: string, x: number, z: number}[], container?: HTMLElement}} options
	 */
	constructor({ seats, container = document.body }) {
		this._seats = seats;
		this._root = document.createElement('aside');
		this._root.className = 'g3d-settlement-compass';
		this._root.setAttribute('aria-label', 'En yakın yerleşim');
		this._arrow = document.createElement('span');
		this._arrow.className = 'g3d-settlement-compass-arrow';
		this._arrow.textContent = '↑';
		this._name = document.createElement('strong');
		this._distance = document.createElement('span');
		this._distance.className = 'g3d-settlement-compass-distance';
		const text = document.createElement('span');
		text.className = 'g3d-settlement-compass-text';
		text.append(this._name, this._distance);
		this._root.append(this._arrow, text);
		container.appendChild(this._root);
		this._lastSeat = null;
		this._lastDistanceBucket = -1;
		this._seatFilter = null;
	}

	/** @param {((seat: {id?: string, name: string, x: number, z: number}) => boolean)|null} filter */
	setSeatFilter(filter) {
		this._seatFilter = typeof filter === 'function' ? filter : null;
	}

	/** @param {{x: number, z: number}} playerPosition @param {number} playerYawRadians */
	update(playerPosition, playerYawRadians) {
		let nearest = null;
		let nearestDistance = Infinity;
		for (const seat of this._seats) {
			if (this._seatFilter && !this._seatFilter(seat)) continue;
			const distance = Math.hypot(seat.x - playerPosition.x, seat.z - playerPosition.z);
			if (distance < nearestDistance) {
				nearest = seat;
				nearestDistance = distance;
			}
		}
		if (!nearest) {
			this._root.hidden = true;
			return;
		}
		this._root.hidden = false;
		const bearing = Math.atan2(nearest.x - playerPosition.x, nearest.z - playerPosition.z);
		this._arrow.style.transform = `rotate(${bearing - playerYawRadians}rad)`;
		const distanceBucket = Math.round(nearestDistance / 10) * 10;
		if (this._lastSeat !== nearest) {
			this._name.textContent = nearest.name;
			this._lastSeat = nearest;
		}
		if (this._lastDistanceBucket !== distanceBucket) {
			this._distance.textContent = distanceBucket < 1000
				? `${distanceBucket} m`
				: `${(distanceBucket / 1000).toFixed(1)} km`;
			this._lastDistanceBucket = distanceBucket;
		}
	}

	dispose() {
		this._root.remove();
	}
}
