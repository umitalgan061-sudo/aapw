/** Production TypeScript owner for touch controls; legacy JS path remains compatibility-only. */
/**
 * On-screen virtual joystick for touch-primary devices. Movement/run stay analog; jump and lock-on
 * are edge-triggered buttons, guard is held, and attacks feed the same Player contracts as desktop.
 * @module ui/touchJoystick
 */

import { TOUCH_JOYSTICK_CONFIG } from '../config.ts';
import { PlayerInputActionBuffer, createPlayerInputFrame, emitPlayerCombatIntent, emitPlayerInputAction, normalizePlayerInputAxis, type PlayerInputAction, type PlayerInputFrame, type PlayerInputActionRecord } from '../input.ts';

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }




export interface TouchControlLayout {
	readonly scale: number;
	readonly buttonWidthPx: number;
	readonly buttonHeightPx: number;
	readonly sideInsetPx: number;
	readonly bottomInsetPx: number;
	readonly verticalGapPx: number;
	readonly compact: boolean;
	readonly orientation: 'portrait' | 'landscape';
}

export function resolveTouchControlLayout(
	viewportWidth: unknown,
	viewportHeight: unknown,
	safeAreaBottomPx: unknown = 0,
): TouchControlLayout {
	const width = Math.max(240, finiteTouchNumber(viewportWidth, 390));
	const height = Math.max(240, finiteTouchNumber(viewportHeight, 844));
	const compact = width < 520;
	const orientation: TouchControlLayout['orientation'] = width >= height ? 'landscape' : 'portrait';
	const scale = clamp(width / 430, 0.82, 1.12);
	const baseButton = compact ? 68 : 76;
	const gap = compact ? 10 : 14;
	const bottom = Math.max(72, Math.min(128, finiteTouchNumber(safeAreaBottomPx, 0) + (orientation === 'landscape' ? 58 : 88)));
	return Object.freeze({
		scale: Number(scale.toFixed(3)),
		buttonWidthPx: Math.round(baseButton * scale),
		buttonHeightPx: Math.round((baseButton * 0.68) * scale),
		sideInsetPx: Math.round((compact ? 18 : 26) * scale),
		bottomInsetPx: Math.round(bottom),
		verticalGapPx: Math.round(gap * scale),
		compact,
		orientation,
	});
}

function finiteTouchNumber(value: unknown, fallback: number): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : fallback;
}

export interface TouchJoystickAxes {
	readonly forward: number;
	readonly strafe: number;
	readonly running: boolean;
	readonly guarding: boolean;
}

export interface TouchJoystickOptions {
	readonly container?: HTMLElement;
	readonly haptics?: boolean;
	readonly actionBufferMaxEntries?: number;
	readonly actionTtlSeconds?: number;
}

interface TouchVector { readonly x: number; readonly y: number; }
type TouchPointerEvent = PointerEvent;

export class TouchJoystick {
	private readonly _container: HTMLElement;
	private readonly _actionBuffer: PlayerInputActionBuffer;
	private _hapticsEnabled: boolean;
	private _layout: TouchControlLayout;
	private readonly _onViewportChange: () => void;
	private _radiusPx: number;
	private _deadzoneRatio: number;
	private _runThresholdRatio: number;
	private _dragX = 0;
	private _dragY = 0;
	private _pointerId: number | null = null;
	private _origin: TouchVector = { x: 0, y: 0 };
	private _jumpRequested = false;
	private _lockOnRequested = false;
	private _guardHeld = false;
	private _dodgeRequested = false;
	private _parryRequested = false;
	private _enabled = true;
	private _lastFrameSequence = 0;
	private _base: HTMLDivElement;
	private _knob: HTMLDivElement;
	private _jumpButton: HTMLButtonElement;
	private _guardButton: HTMLButtonElement;
	private _lockOnButton: HTMLButtonElement;
	private _lightAttackButton: HTMLButtonElement;
	private _heavyAttackButton: HTMLButtonElement;
	private _dodgeButton: HTMLButtonElement;
	private _parryButton: HTMLButtonElement;
	private readonly _onJumpClick: (event: MouseEvent) => void;
	private readonly _onGuardDown: (event: TouchPointerEvent) => void;
	private readonly _onGuardUp: (event: TouchPointerEvent) => void;
	private readonly _onLockOn: (event: TouchPointerEvent) => void;
	private readonly _onLightAttack: (event: TouchPointerEvent) => void;
	private readonly _onHeavyAttack: (event: TouchPointerEvent) => void;
	private readonly _onDodge: (event: TouchPointerEvent) => void;
	private readonly _onParry: (event: TouchPointerEvent) => void;
	private readonly _onPointerDown: (event: TouchPointerEvent) => void;
	private readonly _onPointerMove: (event: TouchPointerEvent) => void;
	private readonly _onPointerUp: (event: TouchPointerEvent) => void;

	constructor({ container = document.body, haptics = true, actionBufferMaxEntries = 48, actionTtlSeconds = 0.36 }: TouchJoystickOptions = {}) {
		this._container = container;
		this._hapticsEnabled = Boolean(haptics && typeof navigator !== 'undefined' && 'vibrate' in navigator);
		this._layout = resolveTouchControlLayout(globalThis.innerWidth, globalThis.innerHeight);
		this._onViewportChange = () => { this.refreshLayout(); };
		this._actionBuffer = new PlayerInputActionBuffer({ maxEntries: actionBufferMaxEntries, ttlSeconds: actionTtlSeconds });
		this._radiusPx = TOUCH_JOYSTICK_CONFIG.RADIUS_PX;
		this._deadzoneRatio = TOUCH_JOYSTICK_CONFIG.DEADZONE_RATIO;
		this._runThresholdRatio = TOUCH_JOYSTICK_CONFIG.RUN_THRESHOLD_RATIO;
		this._dragX = 0; this._dragY = 0; this._pointerId = null;
		this._jumpRequested = false; this._lockOnRequested = false; this._guardHeld = false;
		this._base = document.createElement('div'); this._base.className = 'g3d-joystick-base'; this._applyLayout();
		this._knob = document.createElement('div'); this._knob.className = 'g3d-joystick-knob'; this._base.appendChild(this._knob); container.appendChild(this._base);
		this._jumpButton = document.createElement('button'); this._jumpButton.type = 'button'; this._jumpButton.className = 'g3d-touch-jump-button'; this._jumpButton.textContent = 'Zıpla'; this._jumpButton.setAttribute('aria-label', 'Zıpla');
		this._onJumpClick = (event: MouseEvent) => { if (!this._enabled) return; this._jumpRequested = true; this._queueAction('jump'); event.preventDefault?.(); }; this._jumpButton.addEventListener('click', this._onJumpClick); container.appendChild(this._jumpButton);
		this._guardButton = document.createElement('button'); this._guardButton.type = 'button'; this._guardButton.className = 'g3d-touch-guard-button'; this._guardButton.textContent = 'Savun'; this._guardButton.setAttribute('aria-label', 'Savun'); this._guardButton.setAttribute('aria-pressed', 'false');
		Object.assign(this._guardButton.style, { position: 'fixed', right: '112px', bottom: '96px', zIndex: '30', minWidth: '72px', minHeight: '48px', borderRadius: '999px', opacity: '0.86', touchAction: 'none' });
		this._onGuardDown = (event: TouchPointerEvent) => { if (!this._enabled) return; this._guardHeld = true; this._guardButton.setAttribute('aria-pressed', 'true'); event.preventDefault(); };
		this._onGuardUp = (event: TouchPointerEvent) => { this._guardHeld = false; this._guardButton.setAttribute('aria-pressed', 'false'); event.preventDefault?.(); };
		this._guardButton.addEventListener('pointerdown', this._onGuardDown); this._guardButton.addEventListener('pointerup', this._onGuardUp); this._guardButton.addEventListener('pointercancel', this._onGuardUp); this._guardButton.addEventListener('pointerleave', this._onGuardUp); container.appendChild(this._guardButton);

		this._lockOnButton = document.createElement('button'); this._lockOnButton.type = 'button'; this._lockOnButton.className = 'g3d-touch-lock-on-button'; this._lockOnButton.textContent = 'Hedef'; this._lockOnButton.setAttribute('aria-label', 'Hedef kilidi'); this._lockOnButton.setAttribute('aria-pressed', 'false');
		Object.assign(this._lockOnButton.style, { position: 'fixed', right: '196px', bottom: '96px', zIndex: '30', minWidth: '72px', minHeight: '48px', borderRadius: '999px', opacity: '0.86', touchAction: 'manipulation' });
		this._onLockOn = (event: TouchPointerEvent) => { if (!this._enabled) return; this._lockOnRequested = true; this._queueAction('lock-on'); event.preventDefault?.(); this._vibrate(18); };
		this._lockOnButton.addEventListener('pointerdown', this._onLockOn); container.appendChild(this._lockOnButton);

		this._lightAttackButton = document.createElement('button'); this._lightAttackButton.type = 'button'; this._lightAttackButton.className = 'g3d-touch-light-attack-button'; this._lightAttackButton.textContent = 'Hafif'; this._lightAttackButton.setAttribute('aria-label', 'Hafif saldırı');
		Object.assign(this._lightAttackButton.style, { position: 'fixed', right: '28px', bottom: '156px', zIndex: '30', minWidth: '72px', minHeight: '48px', borderRadius: '999px', opacity: '0.9', touchAction: 'manipulation' });
		this._onLightAttack = (event: TouchPointerEvent) => { if (!this._enabled) return; this._queueAction('light', false); emitPlayerCombatIntent('light', 'touch'); event.preventDefault?.(); this._vibrate(28); };
		this._lightAttackButton.addEventListener('pointerdown', this._onLightAttack); container.appendChild(this._lightAttackButton);

		this._heavyAttackButton = document.createElement('button'); this._heavyAttackButton.type = 'button'; this._heavyAttackButton.className = 'g3d-touch-heavy-attack-button'; this._heavyAttackButton.textContent = 'Ağır'; this._heavyAttackButton.setAttribute('aria-label', 'Ağır saldırı');
		Object.assign(this._heavyAttackButton.style, { position: 'fixed', right: '112px', bottom: '156px', zIndex: '30', minWidth: '72px', minHeight: '48px', borderRadius: '999px', opacity: '0.9', touchAction: 'manipulation' });
		this._onHeavyAttack = (event: TouchPointerEvent) => { if (!this._enabled) return; this._queueAction('heavy', false); emitPlayerCombatIntent('heavy', 'touch'); event.preventDefault?.(); this._vibrate(42); };
		this._heavyAttackButton.addEventListener('pointerdown', this._onHeavyAttack); container.appendChild(this._heavyAttackButton);
		this._dodgeButton = document.createElement('button'); this._dodgeButton.type = 'button'; this._dodgeButton.className = 'g3d-touch-dodge-button'; this._dodgeButton.textContent = 'Kaçın'; this._dodgeButton.setAttribute('aria-label', 'Kaçın');
		Object.assign(this._dodgeButton.style, { position: 'fixed', right: '28px', bottom: '96px', zIndex: '30', minWidth: '72px', minHeight: '48px', borderRadius: '999px', opacity: '0.9', touchAction: 'manipulation' });
		this._onDodge = (event: TouchPointerEvent) => { if (!this._enabled) return; this._dodgeRequested = true; this._queueAction('dodge'); event.preventDefault?.(); this._vibrate(34); };
		this._dodgeButton.addEventListener('pointerdown', this._onDodge); container.appendChild(this._dodgeButton);

		this._parryButton = document.createElement('button'); this._parryButton.type = 'button'; this._parryButton.className = 'g3d-touch-parry-button'; this._parryButton.textContent = 'Karşıla'; this._parryButton.setAttribute('aria-label', 'Karşıla');
		Object.assign(this._parryButton.style, { position: 'fixed', right: '196px', bottom: '156px', zIndex: '30', minWidth: '72px', minHeight: '48px', borderRadius: '999px', opacity: '0.9', touchAction: 'manipulation' });
		this._onParry = (event: TouchPointerEvent) => { if (!this._enabled) return; this._parryRequested = true; this._queueAction('parry'); event.preventDefault?.(); this._vibrate(22); };
		this._parryButton.addEventListener('pointerdown', this._onParry); container.appendChild(this._parryButton);


		this._onPointerDown = this._handlePointerDown.bind(this); this._onPointerMove = this._handlePointerMove.bind(this); this._onPointerUp = this._handlePointerUp.bind(this);
		this._base.addEventListener('pointerdown', this._onPointerDown); this._base.addEventListener('pointermove', this._onPointerMove); this._base.addEventListener('pointerup', this._onPointerUp); this._base.addEventListener('pointercancel', this._onPointerUp); window.addEventListener('resize', this._onViewportChange, { passive: true }); window.addEventListener('orientationchange', this._onViewportChange, { passive: true });
	}
	private _handlePointerDown(event: TouchPointerEvent): void {
		if (!this._enabled || this._pointerId !== null) return;
		this._pointerId = event.pointerId; this._base.setPointerCapture(event.pointerId); this._origin = { x: event.clientX, y: event.clientY }; this._dragX = 0; this._dragY = 0; this._base.classList.add('g3d-joystick-active'); event.preventDefault();
	}
	private _handlePointerMove(event: TouchPointerEvent): void {
		if (event.pointerId !== this._pointerId) return;
		const dx = event.clientX - this._origin.x, dy = event.clientY - this._origin.y, distance = Math.hypot(dx, dy), clampedDistance = Math.min(distance, this._radiusPx), scale = distance > 0 ? clampedDistance / distance : 0;
		this._dragX = dx * scale; this._dragY = dy * scale; this._knob.style.transform = `translate(${this._dragX}px, ${this._dragY}px)`; event.preventDefault();
	}
	private _handlePointerUp(event: TouchPointerEvent): void {
		if (event.pointerId !== this._pointerId) return;
		this._pointerId = null; this._dragX = 0; this._dragY = 0; this._knob.style.transform = ''; this._base.classList.remove('g3d-joystick-active');
	}

	private _applyLayout(): void {
		const layout = this._layout;
		const buttons: readonly HTMLElement[] = [this._jumpButton, this._guardButton, this._lockOnButton, this._lightAttackButton, this._heavyAttackButton, this._dodgeButton, this._parryButton];
		this._base.style.setProperty('--g3d-touch-scale', String(layout.scale));
		this._base.style.setProperty('--g3d-touch-side-inset', `${layout.sideInsetPx}px`);
		this._base.style.setProperty('--g3d-touch-bottom-inset', `calc(${layout.bottomInsetPx}px + env(safe-area-inset-bottom))`);
		this._base.style.touchAction = 'none';
		for (const button of buttons) {
			button.style.minWidth = `${layout.buttonWidthPx}px`;
			button.style.minHeight = `${layout.buttonHeightPx}px`;
			button.style.transformOrigin = 'center';
			button.style.transform = `scale(${layout.scale})`;
		}
	}

	refreshLayout(): TouchControlLayout {
		const safeAreaBottom = Number.parseFloat(getComputedStyle(this._base).getPropertyValue('padding-bottom')) || 0;
		this._layout = resolveTouchControlLayout(globalThis.innerWidth, globalThis.innerHeight, safeAreaBottom);
		this._applyLayout();
		return this._layout;
	}

	getLayout(): TouchControlLayout { return this._layout; }

	setHapticsEnabled(enabled: boolean): void {
		this._hapticsEnabled = Boolean(enabled);
	}

	isHapticsEnabled(): boolean { return this._hapticsEnabled; }

	private _nowSeconds(): number { return Number(((globalThis.performance?.now?.() ?? Date.now()) / 1000).toFixed(6)); }
	private _queueAction(action: PlayerInputAction, emitEvent = true): PlayerInputActionRecord {
		const record = this._actionBuffer.enqueue(action, 'touch', 'touch', this._nowSeconds());
		if (emitEvent) emitPlayerInputAction(action, 'touch', 'touch');
		this._lastFrameSequence = record.sequence;
		return record;
	}
	private _vibrate(duration: number): void {
		if (!this._hapticsEnabled) return;
		try { navigator.vibrate?.(Math.max(8, Math.min(70, Math.floor(duration)))); } catch { /* optional mobile haptics */ }
	}
	getAxes(): TouchJoystickAxes {
		const ratio = this._radiusPx > 0 ? Math.hypot(this._dragX, this._dragY) / this._radiusPx : 0;
		const axis = normalizePlayerInputAxis(this._dragX / Math.max(1, this._radiusPx), -this._dragY / Math.max(1, this._radiusPx), this._deadzoneRatio);
		if (ratio < this._deadzoneRatio || !this._enabled) { const result = Object.freeze({ forward: 0, strafe: 0, running: this._dodgeRequested, guarding: (this._guardHeld || this._parryRequested) && this._enabled }); this._dodgeRequested = false; this._parryRequested = false; return result; }
		const result = Object.freeze({
			forward: clamp(axis.y, -1, 1),
			strafe: clamp(axis.x, -1, 1),
			running: ratio >= this._runThresholdRatio || this._dodgeRequested,
			guarding: (this._guardHeld || this._parryRequested) && this._enabled,
		});
		this._dodgeRequested = false;
		this._parryRequested = false;
		return result;
	}
	getInputFrame(): PlayerInputFrame {
		const dodgeRequested = this._dodgeRequested;
		const parryRequested = this._parryRequested;
		const axes = this.getAxes();
		this._dodgeRequested = false;
		this._parryRequested = false;
		const now = this._nowSeconds();
		const pending = this._actionBuffer.peek(now);
		return createPlayerInputFrame({
			...axes,
			device: 'touch',
			sequence: pending.at(-1)?.sequence ?? this._lastFrameSequence,
			timestampSeconds: now,
			actionCount: pending.length,
			jumpRequested: this._jumpRequested || dodgeRequested,
			lockOnRequested: this._lockOnRequested,
			dodgeRequested: dodgeRequested || pending.some((action) => action.action === 'dodge'),
			parryRequested: parryRequested || pending.some((action) => action.action === 'parry'), pending.some((action) => action.action === 'parry'),
			lightRequested: pending.some((action) => action.action === 'light'),
			heavyRequested: pending.some((action) => action.action === 'heavy'),
		});
	}
	consumeActionBuffer(nowSeconds = this._nowSeconds(), limit = 8): readonly PlayerInputActionRecord[] {
		return this._actionBuffer.drain(nowSeconds, limit);
	}
	setEnabled(enabled: boolean): void {
		this._enabled = Boolean(enabled);
		if (!this._enabled) {
			this._guardHeld = false;
			this._dodgeRequested = false;
			this._parryRequested = false;
			this._jumpRequested = false;
			this._lockOnRequested = false;
			this._resetPointerState();
			this._actionBuffer.clear();
			this._guardButton.setAttribute('aria-pressed', 'false');
		}
		this._base.toggleAttribute('aria-disabled', !this._enabled);
		this._base.classList.toggle('g3d-joystick-disabled', !this._enabled);
		for (const button of [this._jumpButton, this._guardButton, this._lockOnButton, this._lightAttackButton, this._heavyAttackButton, this._dodgeButton, this._parryButton]) button.disabled = !this._enabled;
	}
	isEnabled(): boolean { return this._enabled; }
	private _resetPointerState(): void {
		this._pointerId = null;
		this._dragX = 0;
		this._dragY = 0;
		this._knob.style.transform = '';
		this._base.classList.remove('g3d-joystick-active');
	}
	consumeJumpRequested(): boolean { const requested = this._jumpRequested || this._dodgeRequested; this._jumpRequested = false; this._dodgeRequested = false; return requested; }
	consumeLockOnRequested(): boolean { const requested = this._lockOnRequested; this._lockOnRequested = false; return requested; }
	setLockOnActive(active: boolean): void {
		const locked = Boolean(active);
		this._lockOnButton.setAttribute('aria-pressed', String(locked));
		this._lockOnButton.classList.toggle('g3d-touch-lock-on-active', locked);
		this._lockOnButton.textContent = locked ? 'Kilitli' : 'Hedef';
	}
	dispose(): void { this.setEnabled(false);
		window.removeEventListener('resize', this._onViewportChange); window.removeEventListener('orientationchange', this._onViewportChange);
		this._base.removeEventListener('pointerdown', this._onPointerDown); this._base.removeEventListener('pointermove', this._onPointerMove); this._base.removeEventListener('pointerup', this._onPointerUp); this._base.removeEventListener('pointercancel', this._onPointerUp);
		this._jumpButton.removeEventListener('click', this._onJumpClick); this._guardButton.removeEventListener('pointerdown', this._onGuardDown); this._guardButton.removeEventListener('pointerup', this._onGuardUp); this._guardButton.removeEventListener('pointercancel', this._onGuardUp); this._guardButton.removeEventListener('pointerleave', this._onGuardUp);
		this._lockOnButton.removeEventListener('pointerdown', this._onLockOn); this._lightAttackButton.removeEventListener('pointerdown', this._onLightAttack); this._heavyAttackButton.removeEventListener('pointerdown', this._onHeavyAttack); this._dodgeButton.removeEventListener('pointerdown', this._onDodge); this._parryButton.removeEventListener('pointerdown', this._onParry);
		this._jumpRequested = false; this._lockOnRequested = false; this._guardHeld = false; this._guardButton.remove(); this._lockOnButton.remove(); this._jumpButton.remove(); this._lightAttackButton.remove(); this._heavyAttackButton.remove(); this._base.remove();
	}
}

