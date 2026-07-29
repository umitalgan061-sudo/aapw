/**
 * On-screen virtual joystick for touch-primary (mobile-class) devices — FAZ 4's other input
 * requirement alongside `input.js`'s keyboard support (see 3D_GAME_PROGRESS.md's Known Issues).
 * Renders its own fixed-position DOM element (base + knob) rather than a canvas draw, so it costs
 * nothing from the render budget and composes with the rest of the page via plain CSS
 * (`game3d.css`). Exposes the same `{forward, strafe, running}` shape as `input.js`'s
 * `KeyboardInput.getAxes()` so `game3d.js` can combine both without any camera-relative-move code
 * needing to know which input source produced them.
 * @module ui/touchJoystick
 */

import { TOUCH_JOYSTICK_CONFIG } from '../config.js';

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

export class TouchJoystick {
	/**
	 * @param {HTMLElement} [container] Parent element the joystick's DOM is appended to. Defaults
	 *   to `document.body`.
	 */
	constructor(container = document.body) {
		this._radiusPx = TOUCH_JOYSTICK_CONFIG.RADIUS_PX;
		this._dragX = 0;
		this._dragY = 0;
		this._pointerId = null;

		this._base = document.createElement('div');
		this._base.className = 'g3d-joystick-base';
		this._knob = document.createElement('div');
		this._knob.className = 'g3d-joystick-knob';
		this._base.appendChild(this._knob);
		container.appendChild(this._base);

		this._onPointerDown = this._handlePointerDown.bind(this);
		this._onPointerMove = this._handlePointerMove.bind(this);
		this._onPointerUp = this._handlePointerUp.bind(this);
		this._base.addEventListener('pointerdown', this._onPointerDown);
		// Move/up listen on the base itself (via setPointerCapture) so dragging past the base's own
		// bounds still tracks — capture routes subsequent pointer events to this element regardless
		// of what's visually underneath the finger.
		this._base.addEventListener('pointermove', this._onPointerMove);
		this._base.addEventListener('pointerup', this._onPointerUp);
		this._base.addEventListener('pointercancel', this._onPointerUp);
	}

	/** @param {PointerEvent} event */
	_handlePointerDown(event) {
		if (this._pointerId !== null) return; // already tracking a finger — ignore a second one
		this._pointerId = event.pointerId;
		this._base.setPointerCapture(event.pointerId);
		this._origin = { x: event.clientX, y: event.clientY };
		this._dragX = 0;
		this._dragY = 0;
		this._base.classList.add('g3d-joystick-active');
		event.preventDefault();
	}

	/** @param {PointerEvent} event */
	_handlePointerMove(event) {
		if (event.pointerId !== this._pointerId) return;
		const dx = event.clientX - this._origin.x;
		const dy = event.clientY - this._origin.y;
		const distance = Math.hypot(dx, dy);
		const clampedDistance = Math.min(distance, this._radiusPx);
		const scale = distance > 0 ? clampedDistance / distance : 0;
		this._dragX = dx * scale;
		this._dragY = dy * scale;
		this._knob.style.transform = `translate(${this._dragX}px, ${this._dragY}px)`;
		event.preventDefault();
	}

	/** @param {PointerEvent} event */
	_handlePointerUp(event) {
		if (event.pointerId !== this._pointerId) return;
		this._pointerId = null;
		this._dragX = 0;
		this._dragY = 0;
		this._knob.style.transform = '';
		this._base.classList.remove('g3d-joystick-active');
	}

	/**
	 * @returns {{forward: number, strafe: number, running: boolean}} Same shape as
	 *   `KeyboardInput.getAxes()` — `forward`/`strafe` are continuous in [-1, 1] here (an analog
	 *   stick, unlike keyboard's discrete -1/0/1), which `game3d.js`'s existing camera-relative-move
	 *   math already normalizes correctly either way.
	 */
	getAxes() {
		const ratio = this._radiusPx > 0 ? Math.hypot(this._dragX, this._dragY) / this._radiusPx : 0;
		if (ratio < TOUCH_JOYSTICK_CONFIG.DEADZONE_RATIO) {
			return { forward: 0, strafe: 0, running: false };
		}
		return {
			forward: clamp(-this._dragY / this._radiusPx, -1, 1),
			strafe: clamp(this._dragX / this._radiusPx, -1, 1),
			running: ratio >= TOUCH_JOYSTICK_CONFIG.RUN_THRESHOLD_RATIO,
		};
	}

	/** Removes DOM elements and listeners. Call on teardown (memory-leak checklist). */
	dispose() {
		this._base.removeEventListener('pointerdown', this._onPointerDown);
		this._base.removeEventListener('pointermove', this._onPointerMove);
		this._base.removeEventListener('pointerup', this._onPointerUp);
		this._base.removeEventListener('pointercancel', this._onPointerUp);
		this._base.remove();
	}
}
