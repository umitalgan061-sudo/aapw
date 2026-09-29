/** Strict TypeScript owner for the nearest-settlement compass HUD. */
export interface SettlementSeat {
  readonly id?: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
}

export interface SettlementCompassOptions {
  readonly seats: readonly SettlementSeat[];
  readonly container?: HTMLElement;
}

export type SettlementSeatFilter = (seat: SettlementSeat) => boolean;

export interface PlayerPlanarPosition {
  readonly x: number;
  readonly z: number;
}

export class SettlementCompass {
  private readonly _seats: readonly SettlementSeat[];
  private readonly _root: HTMLElement;
  private readonly _arrow: HTMLSpanElement;
  private readonly _name: HTMLElement;
  private readonly _distance: HTMLSpanElement;
  private _lastSeat: SettlementSeat | null = null;
  private _lastDistanceBucket = -1;
  private _seatFilter: SettlementSeatFilter | null = null;

  constructor({ seats, container = document.body }: SettlementCompassOptions) {
    this._seats = seats;
    this._root = document.createElement('aside');
    this._root.className = 'g3d-settlement-compass';
    this._root.setAttribute('aria-label', 'En yakın yerleşim');
    this._root.setAttribute('role', 'status');
    this._root.setAttribute('aria-live', 'off');
    this._root.setAttribute('aria-atomic', 'true');

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
  }

  setSeatFilter(filter: SettlementSeatFilter | null): void {
    this._seatFilter = filter;
  }

  update(playerPosition: PlayerPlanarPosition, playerYawRadians: number): void {
    let nearest: SettlementSeat | null = null;
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
    const bearing = Math.atan2(
      nearest.x - playerPosition.x,
      nearest.z - playerPosition.z,
    );
    this._arrow.style.transform = `rotate(${bearing - playerYawRadians}rad)`;

    const distanceBucket = Math.round(nearestDistance / 10) * 10;
    const settlementChanged =
      this._lastSeat !== nearest || this._lastDistanceBucket !== distanceBucket;

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

    if (settlementChanged) {
      this._root.setAttribute(
        'aria-label',
        `En yakın yerleşim: ${this._name.textContent ?? nearest.name}, ${this._distance.textContent ?? ''}`,
      );
    }
  }

  dispose(): void {
    this._root.remove();
  }
}
