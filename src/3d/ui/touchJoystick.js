/**
 * On-screen virtual joystick for touch-primary devices. Movement/run stay analog; jump and lock-on
 * are edge-triggered buttons, guard is held, and attacks feed the same Player contracts as desktop.
 * @module ui/touchJoystick
 */

import { TOUCH_JOYSTICK_CONFIG } from '../config.js';
import { emitPlayerCombatIntent } from '../input.js';

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

export class TouchJoystick {
	constructor(container = document.body) {
		this._radiusPx = TOUCH_JOYSTICK_CONFIG.RADIUS_PX;
		this._dragX = 0; this._dragY = 0; this._pointerId = null;
		this._jumpRequested = false; this._lockOnRequested = false; this._guardHeld = false;
		this._base = document.createElement('div'); this._base.className = 'g3d-joystick-base';
		this._knob = document.createElement('div'); this._knob.className = 'g3d-joystick-knob'; this._base.appendChild(this._knob); container.appendChild(this._base);
		this._jumpButton = document.createElement('button'); this._jumpButton.type = 'button'; this._jumpButton.className = 'g3d-touch-jump-button'; this._jumpButton.textContent = 'Zıpla'; this._jumpButton.setAttribute('aria-label', 'Zıpla');
		this._onJumpClick = () => { this._jumpRequested = true; }; this._jumpButton.addEventListener('click', this._onJumpClick); container.appendChild(this._jumpButton);
		this._guardButton = document.createElement('button'); this._guardButton.type = 'button'; this._guardButton.className = 'g3d-touch-guard-button'; this._guardButton.textContent = 'Savun'; this._guardButton.setAttribute('aria-label', 'Savun'); this._guardButton.setAttribute('aria-pressed', 'false');
		Object.assign(this._guardButton.style, { position: 'fixed', right: '112px', bottom: '96px', zIndex: '30', minWidth: '72px', minHeight: '48px', borderRadius: '999px', opacity: '0.86', touchAction: 'none' });
		this._onGuardDown = (event) => { this._guardHeld = true; this._guardButton.setAttribute('aria-pressed', 'true'); event.preventDefault(); };
		this._onGuardUp = (event) => { this._guardHeld = false; this._guardButton.setAttribute('aria-pressed', 'false'); event.preventDefault?.(); };
		this._guardButton.addEventListener('pointerdown', this._onGuardDown); this._guardButton.addEventListener('pointerup', this._onGuardUp); this._guardButton.addEventListener('pointercancel', this._onGuardUp); this._guardButton.addEventListener('pointerleave', this._onGuardUp); container.appendChild(this._guardButton);

		this._lockOnButton = document.createElement('button'); this._lockOnButton.type = 'button'; this._lockOnButton.className = 'g3d-touch-lock-on-button'; this._lockOnButton.textContent = 'Hedef'; this._lockOnButton.setAttribute('aria-label', 'Hedef kilidi');
		Object.assign(this._lockOnButton.style, { position: 'fixed', right: '196px', bottom: '96px', zIndex: '30', minWidth: '72px', minHeight: '48px', borderRadius: '999px', opacity: '0.86', touchAction: 'manipulation' });
		this._onLockOn = (event) => { this._lockOnRequested = true; event.preventDefault?.(); };
		this._lockOnButton.addEventListener('pointerdown', this._onLockOn); container.appendChild(this._lockOnButton);

		this._lightAttackButton = document.createElement('button'); this._lightAttackButton.type = 'button'; this._lightAttackButton.className = 'g3d-touch-light-attack-button'; this._lightAttackButton.textContent = 'Hafif'; this._lightAttackButton.setAttribute('aria-label', 'Hafif saldırı');
		Object.assign(this._lightAttackButton.style, { position: 'fixed', right: '28px', bottom: '156px', zIndex: '30', minWidth: '72px', minHeight: '48px', borderRadius: '999px', opacity: '0.9', touchAction: 'manipulation' });
		this._onLightAttack = (event) => { emitPlayerCombatIntent('light', 'touch'); event.preventDefault?.(); };
		this._lightAttackButton.addEventListener('pointerdown', this._onLightAttack); container.appendChild(this._lightAttackButton);

		this._heavyAttackButton = document.createElement('button'); this._heavyAttackButton.type = 'button'; this._heavyAttackButton.className = 'g3d-touch-heavy-attack-button'; this._heavyAttackButton.textContent = 'Ağır'; this._heavyAttackButton.setAttribute('aria-label', 'Ağır saldırı');
		Object.assign(this._heavyAttackButton.style, { position: 'fixed', right: '112px', bottom: '156px', zIndex: '30', minWidth: '72px', minHeight: '48px', borderRadius: '999px', opacity: '0.9', touchAction: 'manipulation' });
		this._onHeavyAttack = (event) => { emitPlayerCombatIntent('heavy', 'touch'); event.preventDefault?.(); };
		this._heavyAttackButton.addEventListener('pointerdown', this._onHeavyAttack); container.appendChild(this._heavyAttackButton);

		this._onPointerDown = this._handlePointerDown.bind(this); this._onPointerMove = this._handlePointerMove.bind(this); this._onPointerUp = this._handlePointerUp.bind(this);
		this._base.addEventListener('pointerdown', this._onPointerDown); this._base.addEventListener('pointermove', this._onPointerMove); this._base.addEventListener('pointerup', this._onPointerUp); this._base.addEventListener('pointercancel', this._onPointerUp);
	}
	_handlePointerDown(event) {
		if (this._pointerId !== null) return;
		this._pointerId = event.pointerId; this._base.setPointerCapture(event.pointerId); this._origin = { x: event.clientX, y: event.clientY }; this._dragX = 0; this._dragY = 0; this._base.classList.add('g3d-joystick-active'); event.preventDefault();
	}
	_handlePointerMove(event) {
		if (event.pointerId !== this._pointerId) return;
		const dx = event.clientX - this._origin.x, dy = event.clientY - this._origin.y, distance = Math.hypot(dx, dy), clampedDistance = Math.min(distance, this._radiusPx), scale = distance > 0 ? clampedDistance / distance : 0;
		this._dragX = dx * scale; this._dragY = dy * scale; this._knob.style.transform = `translate(${this._dragX}px, ${this._dragY}px)`; event.preventDefault();
	}
	_handlePointerUp(event) {
		if (event.pointerId !== this._pointerId) return;
		this._pointerId = null; this._dragX = 0; this._dragY = 0; this._knob.style.transform = ''; this._base.classList.remove('g3d-joystick-active');
	}
	getAxes() {
		const ratio = this._radiusPx > 0 ? Math.hypot(this._dragX, this._dragY) / this._radiusPx : 0;
		if (ratio < TOUCH_JOYSTICK_CONFIG.DEADZONE_RATIO) return { forward: 0, strafe: 0, running: false, guarding: this._guardHeld };
		return { forward: clamp(-this._dragY / this._radiusPx, -1, 1), strafe: clamp(this._dragX / this._radiusPx, -1, 1), running: ratio >= TOUCH_JOYSTICK_CONFIG.RUN_THRESHOLD_RATIO, guarding: this._guardHeld };
	}
	consumeJumpRequested() { const requested = this._jumpRequested; this._jumpRequested = false; return requested; }
	consumeLockOnRequested() { const requested = this._lockOnRequested; this._lockOnRequested = false; return requested; }
	dispose() {
		this._base.removeEventListener('pointerdown', this._onPointerDown); this._base.removeEventListener('pointermove', this._onPointerMove); this._base.removeEventListener('pointerup', this._onPointerUp); this._base.removeEventListener('pointercancel', this._onPointerUp);
		this._jumpButton.removeEventListener('click', this._onJumpClick); this._guardButton.removeEventListener('pointerdown', this._onGuardDown); this._guardButton.removeEventListener('pointerup', this._onGuardUp); this._guardButton.removeEventListener('pointercancel', this._onGuardUp); this._guardButton.removeEventListener('pointerleave', this._onGuardUp);
		this._lockOnButton.removeEventListener('pointerdown', this._onLockOn); this._lightAttackButton.removeEventListener('pointerdown', this._onLightAttack); this._heavyAttackButton.removeEventListener('pointerdown', this._onHeavyAttack);
		this._jumpRequested = false; this._lockOnRequested = false; this._guardHeld = false; this._guardButton.remove(); this._lockOnButton.remove(); this._jumpButton.remove(); this._lightAttackButton.remove(); this._heavyAttackButton.remove(); this._base.remove();
	}
}
