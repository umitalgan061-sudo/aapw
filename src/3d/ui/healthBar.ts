/** Strict TypeScript owner for player vitals HUD. */
import { EventBus } from '../eventBus.ts';

const FLASH_SECONDS = 0.3;
const DEFENSE_FEEDBACK_SECONDS = 0.65;
const TARGET_FEEDBACK_SECONDS = 0.9;

const STAMINA_STATE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  idle: 'Hazır', walk: 'Yürüme', sprint: 'Depar', dodge: 'Kaçınma', airborne: 'Havada',
  exhausted: 'Tükendi', guard: 'Savunma', parry: 'Karşılama', 'guard-break': 'Savunma kırıldı',
  'attack-light': 'Hafif saldırı', 'attack-heavy': 'Ağır saldırı',
});
const ATTACK_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({ light: 'Hafif', heavy: 'Ağır' });
const ATTACK_PHASE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  start: 'Hazırlık', 'active-start': 'VURUŞ', 'active-end': 'Toparlanma',
});
const DEFENSE_LABELS: Readonly<Record<string, string>> = Object.freeze({ guard: 'BLOK', parry: 'PARRY' });

interface HealthChangedPayload { readonly current: number; readonly maxHealth: number; }
interface DamagePayload { readonly mitigation?: string; readonly blockedAmount?: number; readonly amount?: number; }
interface MotionPayload {
  readonly stamina?: number; readonly maxStamina?: number; readonly poise?: number; readonly maxPoise?: number;
  readonly state?: string; readonly guardBreakRemaining?: number;
}
interface LockOnPayload { readonly locked?: boolean; readonly targetId?: string | number; readonly distanceMeters?: number; readonly reason?: string; }
interface AttackPayload {
  readonly kind?: string; readonly phase?: string; readonly comboStep?: number; readonly reachMeters?: number; readonly damageScale?: number;
}
interface CombatLock { readonly targetId: string; readonly distanceMeters: number | null; }
interface CombatAttack {
  readonly kind: string; readonly phase: string; readonly comboStep: number; readonly reachMeters: number | null; readonly damageScale: number | null;
}
interface CombatDefense { readonly mitigation: string; readonly blockedAmount: number | null; readonly appliedAmount: number | null; }

export interface HealthBarOptions {
  readonly eventsBus: EventBus;
  readonly healthChangedEventName: string;
  readonly damageEventName: string;
  readonly container?: HTMLElement;
}

function detailOf<T>(event: Event): T { return (event as CustomEvent<T>).detail; }

export class HealthBar {
  private readonly _el: HTMLDivElement;
  private readonly _fillEl: HTMLDivElement;
  private readonly _textEl: HTMLParagraphElement;
  private readonly _staminaEl: HTMLDivElement;
  private readonly _staminaFillEl: HTMLDivElement;
  private readonly _staminaTextEl: HTMLParagraphElement;
  private readonly _poiseEl: HTMLDivElement;
  private readonly _poiseFillEl: HTMLDivElement;
  private readonly _poiseTextEl: HTMLParagraphElement;
  private readonly _combatEl: HTMLDivElement;
  private readonly _combatTextEl: HTMLParagraphElement;
  private readonly _eventsBus: EventBus;
  private readonly _healthChangedEventName: string;
  private readonly _damageEventName: string;
  private readonly _onHealthChanged: (payload: HealthChangedPayload) => void;
  private readonly _onDamage: (payload: DamagePayload) => void;
  private readonly _motionEventTarget: EventTarget | null;
  private readonly _onPlayerMotion: (event: Event) => void;
  private readonly _onPlayerLockOn: (event: Event) => void;
  private readonly _onAttackWindow: (event: Event) => void;
  private _combatLock: CombatLock | null = null;
  private _combatAttack: CombatAttack | null = null;
  private _combatDefense: CombatDefense | null = null;
  private _flashTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private _defenseTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private _targetTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor({ eventsBus, healthChangedEventName, damageEventName, container = document.body }: HealthBarOptions) {
    this._el = document.createElement('div');
    this._el.className = 'g3d-health-bar g3d-player-vitals';
    this._el.setAttribute('role', 'meter');
    this._el.setAttribute('aria-label', 'Can');
    this._el.setAttribute('aria-valuemin', '0');
    Object.assign(this._el.style, { width: '440px', display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gridTemplateRows: 'auto auto auto', columnGap: '10px' });

    const label = document.createElement('p');
    label.className = 'g3d-health-bar-label';
    label.textContent = 'Can';
    Object.assign(label.style, { gridColumn: '1', gridRow: '1' });
    this._el.appendChild(label);

    const track = document.createElement('div');
    track.className = 'g3d-health-bar-track';
    Object.assign(track.style, { gridColumn: '1', gridRow: '2' });
    this._fillEl = document.createElement('div');
    this._fillEl.className = 'g3d-health-bar-fill';
    track.appendChild(this._fillEl);
    this._el.appendChild(track);

    this._textEl = document.createElement('p');
    this._textEl.className = 'g3d-health-bar-text';
    Object.assign(this._textEl.style, { gridColumn: '1', gridRow: '3' });
    this._el.appendChild(this._textEl);

    this._staminaEl = document.createElement('div');
    this._staminaEl.className = 'g3d-stamina-bar';
    this._staminaEl.setAttribute('role', 'meter');
    this._staminaEl.setAttribute('aria-label', 'Dayanıklılık');
    this._staminaEl.setAttribute('aria-valuemin', '0');
    Object.assign(this._staminaEl.style, { gridColumn: '2', gridRow: '1 / 4', display: 'grid', gridTemplateRows: 'auto auto auto', paddingLeft: '10px', borderLeft: '1px solid rgba(200, 150, 10, 0.32)' });
    const staminaLabel = document.createElement('p');
    staminaLabel.className = 'g3d-health-bar-label g3d-stamina-bar-label';
    staminaLabel.textContent = 'Dayanıklılık';
    staminaLabel.style.gridRow = '1';
    this._staminaEl.appendChild(staminaLabel);
    const staminaTrack = document.createElement('div');
    staminaTrack.className = 'g3d-health-bar-track g3d-stamina-bar-track';
    staminaTrack.style.gridRow = '2';
    this._staminaFillEl = document.createElement('div');
    this._staminaFillEl.className = 'g3d-health-bar-fill g3d-stamina-bar-fill';
    staminaTrack.appendChild(this._staminaFillEl);
    this._staminaEl.appendChild(staminaTrack);
    this._staminaTextEl = document.createElement('p');
    this._staminaTextEl.className = 'g3d-health-bar-text g3d-stamina-bar-text';
    this._staminaTextEl.style.gridRow = '3';
    this._staminaTextEl.textContent = '—';
    this._staminaEl.appendChild(this._staminaTextEl);
    this._el.appendChild(this._staminaEl);

    this._poiseEl = document.createElement('div');
    this._poiseEl.className = 'g3d-poise-bar';
    this._poiseEl.setAttribute('role', 'meter');
    this._poiseEl.setAttribute('aria-label', 'Denge');
    this._poiseEl.setAttribute('aria-valuemin', '0');
    Object.assign(this._poiseEl.style, { gridColumn: '3', gridRow: '1 / 4', display: 'grid', gridTemplateRows: 'auto auto auto', paddingLeft: '10px', borderLeft: '1px solid rgba(125, 170, 210, 0.32)' });
    const poiseLabel = document.createElement('p');
    poiseLabel.className = 'g3d-health-bar-label g3d-poise-bar-label';
    poiseLabel.textContent = 'Denge';
    poiseLabel.style.gridRow = '1';
    this._poiseEl.appendChild(poiseLabel);
    const poiseTrack = document.createElement('div');
    poiseTrack.className = 'g3d-health-bar-track g3d-poise-bar-track';
    poiseTrack.style.gridRow = '2';
    this._poiseFillEl = document.createElement('div');
    this._poiseFillEl.className = 'g3d-health-bar-fill g3d-poise-bar-fill';
    poiseTrack.appendChild(this._poiseFillEl);
    this._poiseEl.appendChild(poiseTrack);
    this._poiseTextEl = document.createElement('p');
    this._poiseTextEl.className = 'g3d-health-bar-text g3d-poise-bar-text';
    this._poiseTextEl.style.gridRow = '3';
    this._poiseTextEl.textContent = '—';
    this._poiseEl.appendChild(this._poiseTextEl);
    this._el.appendChild(this._poiseEl);

    this._combatEl = document.createElement('div');
    this._combatEl.className = 'g3d-combat-status';
    this._combatEl.setAttribute('role', 'status');
    this._combatEl.setAttribute('aria-live', 'polite');
    this._combatEl.setAttribute('aria-label', 'Çatışma durumu');
    Object.assign(this._combatEl.style, { gridColumn: '4', gridRow: '1 / 4', display: 'grid', gridTemplateRows: 'auto auto', alignContent: 'start', paddingLeft: '10px', borderLeft: '1px solid rgba(180, 90, 75, 0.34)' });
    const combatLabel = document.createElement('p');
    combatLabel.className = 'g3d-health-bar-label g3d-combat-status-label';
    combatLabel.textContent = 'Çatışma';
    combatLabel.style.gridRow = '1';
    this._combatEl.appendChild(combatLabel);
    this._combatTextEl = document.createElement('p');
    this._combatTextEl.className = 'g3d-health-bar-text g3d-combat-status-text';
    this._combatTextEl.style.gridRow = '2';
    this._combatTextEl.textContent = 'Serbest';
    this._combatEl.appendChild(this._combatTextEl);
    this._el.appendChild(this._combatEl);
    container.appendChild(this._el);

    this._eventsBus = eventsBus;
    this._healthChangedEventName = healthChangedEventName;
    this._damageEventName = damageEventName;
    this._onHealthChanged = (payload) => this._paint(payload);
    this._onDamage = (payload) => { this._flash(); this._paintDefense(payload); };
    this._eventsBus.on<HealthChangedPayload>(healthChangedEventName, this._onHealthChanged);
    this._eventsBus.on<DamagePayload>(damageEventName, this._onDamage);

    this._motionEventTarget = typeof globalThis.addEventListener === 'function' ? globalThis : null;
    this._onPlayerMotion = (event) => this._paintMotion(detailOf<MotionPayload>(event));
    this._onPlayerLockOn = (event) => this._paintLockOn(detailOf<LockOnPayload>(event));
    this._onAttackWindow = (event) => this._paintAttack(detailOf<AttackPayload>(event));
    this._motionEventTarget?.addEventListener('aapw:player-motion', this._onPlayerMotion);
    this._motionEventTarget?.addEventListener('aapw:player-lock-on', this._onPlayerLockOn);
    this._motionEventTarget?.addEventListener('aapw:player-attack-window', this._onAttackWindow);
  }

  private _paint({ current, maxHealth }: HealthChangedPayload): void {
    const ratio = maxHealth > 0 ? Math.max(0, Math.min(1, current / maxHealth)) : 0;
    const clampedCurrent = Math.max(0, Math.min(maxHealth, Math.ceil(current)));
    this._fillEl.style.width = `${(ratio * 100).toFixed(1)}%`;
    this._textEl.textContent = `${Math.ceil(current)} / ${maxHealth}`;
    this._el.setAttribute('aria-valuemax', String(maxHealth));
    this._el.setAttribute('aria-valuenow', String(clampedCurrent));
    this._el.setAttribute('aria-valuetext', `${Math.ceil(current)} / ${maxHealth}`);
    this._el.classList.toggle('g3d-health-bar-low', ratio > 0 && ratio <= 0.25);
  }

  private _paintMotion(motion: MotionPayload): void {
    const { stamina: current, maxStamina, poise, maxPoise } = motion;
    if (Number.isFinite(current) && Number.isFinite(maxStamina) && maxStamina > 0) {
      const clamped = Math.max(0, Math.min(maxStamina, current));
      const ratio = clamped / maxStamina;
      const rounded = Math.ceil(clamped);
      const state = motion.state ?? 'idle';
      const stateLabel = STAMINA_STATE_LABELS[state] ?? state;
      this._staminaFillEl.style.width = `${(ratio * 100).toFixed(1)}%`;
      this._staminaTextEl.textContent = `${rounded} / ${maxStamina}`;
      this._staminaEl.setAttribute('aria-valuemax', String(maxStamina));
      this._staminaEl.setAttribute('aria-valuenow', String(rounded));
      this._staminaEl.setAttribute('aria-valuetext', `${rounded} / ${maxStamina} · ${stateLabel}`);
      this._staminaEl.dataset.state = state;
      this._staminaEl.classList.toggle('g3d-stamina-bar-low', ratio > 0 && ratio <= 0.25);
      this._staminaEl.classList.toggle('g3d-stamina-bar-exhausted', state === 'exhausted');
      this._staminaFillEl.style.filter = state === 'dodge' ? 'brightness(1.22)' : '';
    }
    if (!Number.isFinite(poise) || !Number.isFinite(maxPoise) || !(maxPoise > 0)) return;
    const poiseClamped = Math.max(0, Math.min(maxPoise, poise));
    const poiseRatio = poiseClamped / maxPoise;
    const poiseRounded = Math.ceil(poiseClamped);
    const state = motion.state ?? 'idle';
    const broken = state === 'guard-break' || (motion.guardBreakRemaining ?? 0) > 0;
    this._poiseFillEl.style.width = `${(poiseRatio * 100).toFixed(1)}%`;
    this._poiseTextEl.textContent = broken ? 'KIRILDI' : `${poiseRounded} / ${maxPoise}`;
    this._poiseEl.setAttribute('aria-valuemax', String(maxPoise));
    this._poiseEl.setAttribute('aria-valuenow', String(poiseRounded));
    this._poiseEl.setAttribute('aria-valuetext', broken ? `Savunma kırıldı · ${poiseRounded} / ${maxPoise}` : `${poiseRounded} / ${maxPoise}`);
    this._poiseEl.dataset.state = broken ? 'guard-break' : 'stable';
    this._poiseEl.classList.toggle('g3d-poise-bar-broken', broken);
    this._poiseFillEl.style.opacity = broken ? '0.45' : '1';
  }

  private _paintLockOn(detail: LockOnPayload): void {
    if (this._targetTimeoutId !== null) { clearTimeout(this._targetTimeoutId); this._targetTimeoutId = null; }
    if (detail.locked) {
      this._combatLock = {
        targetId: String(detail.targetId ?? 'hedef'),
        distanceMeters: Number.isFinite(detail.distanceMeters) ? detail.distanceMeters ?? null : null,
      };
      this._renderCombatStatus();
      return;
    }
    if (detail.reason === 'no-target') {
      this._renderCombatStatus('Hedef yok');
      this._targetTimeoutId = setTimeout(() => {
        this._targetTimeoutId = null;
        this._renderCombatStatus();
      }, TARGET_FEEDBACK_SECONDS * 1000);
      return;
    }
    this._combatLock = null;
    this._renderCombatStatus();
  }

  private _paintAttack(detail: AttackPayload): void {
    if (detail.kind !== 'light' && detail.kind !== 'heavy') return;
    if (detail.phase === 'finish') {
      this._combatAttack = null;
    } else if (detail.phase && ATTACK_PHASE_LABELS[detail.phase]) {
      this._combatAttack = {
        kind: detail.kind,
        phase: detail.phase,
        comboStep: Number.isFinite(detail.comboStep) ? detail.comboStep ?? 1 : 1,
        reachMeters: Number.isFinite(detail.reachMeters) && (detail.reachMeters ?? 0) > 0 ? detail.reachMeters ?? null : null,
        damageScale: Number.isFinite(detail.damageScale) && (detail.damageScale ?? 0) > 0 ? detail.damageScale ?? null : null,
      };
    }
    this._renderCombatStatus();
  }

  private _paintDefense(payload: DamagePayload): void {
    const mitigation = payload.mitigation;
    if (!mitigation || !DEFENSE_LABELS[mitigation]) return;
    this._combatDefense = {
      mitigation,
      blockedAmount: Number.isFinite(payload.blockedAmount) ? Math.max(0, payload.blockedAmount ?? 0) : null,
      appliedAmount: Number.isFinite(payload.amount) ? Math.max(0, payload.amount ?? 0) : null,
    };
    this._renderCombatStatus();
    if (this._defenseTimeoutId !== null) clearTimeout(this._defenseTimeoutId);
    this._defenseTimeoutId = setTimeout(() => {
      this._combatDefense = null;
      this._defenseTimeoutId = null;
      this._renderCombatStatus();
    }, DEFENSE_FEEDBACK_SECONDS * 1000);
  }

  private _renderCombatStatus(transient: string | null = null): void {
    const lockText = this._combatLock
      ? `Kilit · ${this._combatLock.targetId}${this._combatLock.distanceMeters !== null ? ` · ${this._combatLock.distanceMeters.toFixed(1)} m` : ''}`
      : null;
    const attackText = this._combatAttack
      ? `${ATTACK_KIND_LABELS[this._combatAttack.kind]} · ${ATTACK_PHASE_LABELS[this._combatAttack.phase]} · Seri x${this._combatAttack.comboStep}${this._combatAttack.reachMeters !== null ? ` · Erişim ${this._combatAttack.reachMeters.toFixed(1)} m` : ''}${this._combatAttack.damageScale !== null ? ` · Güç x${this._combatAttack.damageScale.toFixed(2)}` : ''}`
      : null;
    const hasRangeComparison = Number.isFinite(this._combatAttack?.reachMeters) && Number.isFinite(this._combatLock?.distanceMeters);
    const targetInRange = hasRangeComparison ? this._combatLock!.distanceMeters! <= this._combatAttack!.reachMeters! : null;
    const rangeText = targetInRange === null ? null : targetInRange ? 'MENZİLDE' : 'UZAK';
    const defenseBlocked = this._combatDefense?.blockedAmount;
    const defenseApplied = this._combatDefense?.appliedAmount;
    const defenseText = this._combatDefense
      ? `${DEFENSE_LABELS[this._combatDefense.mitigation]}${Number.isFinite(defenseBlocked) ? ` · ${defenseBlocked!.toFixed(1)} ${this._combatDefense.mitigation === 'parry' ? 'savuşturuldu' : 'engellendi'}` : ''}${this._combatDefense.mitigation === 'guard' && Number.isFinite(defenseApplied) ? ` · ${defenseApplied!.toFixed(1)} hasar` : ''}`
      : null;
    const primary = defenseText ?? attackText;
    const text = primary ? `${primary}${lockText ? ` · ${lockText}` : ''}${rangeText ? ` · ${rangeText}` : ''}` : (transient ?? lockText ?? 'Serbest');
    this._combatTextEl.textContent = text;
    this._combatEl.dataset.state = this._combatDefense
      ? `defense-${this._combatDefense.mitigation}`
      : this._combatAttack
        ? `attack-${this._combatAttack.phase}`
        : this._combatLock ? 'locked' : transient ? 'no-target' : 'free';
    this._combatEl.dataset.range = targetInRange === null ? 'unknown' : targetInRange ? 'in-range' : 'out-of-range';
    this._combatEl.classList.toggle('g3d-combat-status-active', Boolean(this._combatAttack || this._combatDefense));
    this._combatEl.classList.toggle('g3d-combat-status-locked', Boolean(this._combatLock));
  }

  private _flash(): void {
    this._el.classList.add('g3d-health-bar-flash');
    if (this._flashTimeoutId !== null) clearTimeout(this._flashTimeoutId);
    this._flashTimeoutId = setTimeout(() => {
      this._el.classList.remove('g3d-health-bar-flash');
      this._flashTimeoutId = null;
    }, FLASH_SECONDS * 1000);
  }

  dispose(): void {
    this._eventsBus.off<HealthChangedPayload>(this._healthChangedEventName, this._onHealthChanged);
    this._eventsBus.off<DamagePayload>(this._damageEventName, this._onDamage);
    this._motionEventTarget?.removeEventListener('aapw:player-motion', this._onPlayerMotion);
    this._motionEventTarget?.removeEventListener('aapw:player-lock-on', this._onPlayerLockOn);
    this._motionEventTarget?.removeEventListener('aapw:player-attack-window', this._onAttackWindow);
    if (this._flashTimeoutId !== null) clearTimeout(this._flashTimeoutId);
    if (this._defenseTimeoutId !== null) clearTimeout(this._defenseTimeoutId);
    if (this._targetTimeoutId !== null) clearTimeout(this._targetTimeoutId);
    this._el.remove();
  }
}
