/** Production TypeScript input boundary: keyboard, pointer, standard gamepad and haptics. */

const FORWARD_KEYS = new Set(['KeyW', 'ArrowUp']);
const BACK_KEYS = new Set(['KeyS', 'ArrowDown']);
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);
const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const RUN_KEYS = new Set(['ShiftLeft', 'ShiftRight']);
const JUMP_KEYS = new Set(['Space']);
const GUARD_KEYS = new Set(['KeyQ']);
const LIGHT_ATTACK_KEYS = new Set(['KeyE']);
const HEAVY_ATTACK_KEYS = new Set(['KeyR']);
const LOCK_ON_KEYS = new Set(['Tab']);
const GUARD_POINTER_BUTTON = 2;
const LIGHT_ATTACK_POINTER_BUTTON = 0;
const COMBAT_INPUT_EVENT = 'aapw:player-combat-input';
const COMBAT_FEEDBACK_EVENT = 'aapw:player-combat-feedback';
const INPUT_DEVICE_EVENT = 'aapw:player-input-device';
const GAMEPAD_DEADZONE = 0.18;
const GAMEPAD_TRIGGER_DEADZONE = 0.08;
const GAMEPAD_SPRINT_MIN_MAGNITUDE = 0.72;
const GAMEPAD_SPRINT_RELEASE_MAGNITUDE = 0.55;
const GAMEPAD_DODGE_MIN_MAGNITUDE = 0.45;
const GAMEPAD_CAMERA_MAX_FRAME_SECONDS = 0.3;

const GAMEPAD_BUTTON = Object.freeze({
  JUMP: 0, DODGE: 1, LIGHT: 2, HEAVY: 3, GUARD: 4, PARRY: 5,
  ZOOM_OUT: 6, ZOOM_IN: 7, SPRINT: 10, LOCK_ON: 11,
  DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
} as const);

type GamepadButtonKind = 'jump' | 'dodge' | 'light' | 'heavy' | 'parry' | 'lockOn';

export interface GamepadButtonState {
  readonly jump: boolean;
  readonly dodge: boolean;
  readonly light: boolean;
  readonly heavy: boolean;
  readonly parry: boolean;
  readonly lockOn: boolean;
}

export interface GamepadSample extends GamepadButtonState {
  readonly forward: number;
  readonly strafe: number;
  readonly magnitude: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly lookMagnitude: number;
  readonly cameraZoom: number;
  readonly running: boolean;
  readonly guarding: boolean;
  readonly jumpPressed: boolean;
  readonly dodgePressed: boolean;
  readonly lightPressed: boolean;
  readonly heavyPressed: boolean;
  readonly parryPressed: boolean;
  readonly lockOnPressed: boolean;
  readonly buttons: GamepadButtonState;
}

export interface PlayerInputAxes {
  readonly forward: number;
  readonly strafe: number;
  readonly running: boolean;
  readonly jumpRequested: boolean;
  readonly lockOnRequested: boolean;
  readonly guarding: boolean;
  readonly lookX: number;
  readonly lookY: number;
  readonly cameraZoom: number;
  readonly lookDeltaSeconds: number;
}

export interface CombatFeedback {
  readonly outcome?: string;
  readonly appliedAmount?: number;
  readonly blockedAmount?: number;
  readonly serial?: number;
}

interface HapticProfile {
  readonly duration: number;
  readonly weakMagnitude: number;
  readonly strongMagnitude: number;
}

const GAMEPAD_ACTION_HAPTICS: Readonly<Record<string, HapticProfile>> = Object.freeze({
  dodge: Object.freeze({ duration: 45, weakMagnitude: 0.3, strongMagnitude: 0.55 }),
  parry: Object.freeze({ duration: 38, weakMagnitude: 0.18, strongMagnitude: 0.68 }),
  light: Object.freeze({ duration: 55, weakMagnitude: 0.22, strongMagnitude: 0.48 }),
  heavy: Object.freeze({ duration: 90, weakMagnitude: 0.38, strongMagnitude: 0.82 }),
});

const GAMEPAD_COMBAT_FEEDBACK_HAPTICS: Readonly<Record<string, HapticProfile>> = Object.freeze({
  dodge: Object.freeze({ duration: 34, weakMagnitude: 0.1, strongMagnitude: 0.24 }),
  parry: Object.freeze({ duration: 72, weakMagnitude: 0.18, strongMagnitude: 0.86 }),
  guard: Object.freeze({ duration: 54, weakMagnitude: 0.34, strongMagnitude: 0.56 }),
  'guard-break': Object.freeze({ duration: 135, weakMagnitude: 0.58, strongMagnitude: 0.96 }),
  hit: Object.freeze({ duration: 78, weakMagnitude: 0.44, strongMagnitude: 0.74 }),
  'hit-stagger': Object.freeze({ duration: 128, weakMagnitude: 0.62, strongMagnitude: 0.92 }),
});

const EMPTY_BUTTONS: GamepadButtonState = Object.freeze({
  jump: false, dodge: false, light: false, heavy: false, parry: false, lockOn: false,
});

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    ? Boolean(target.closest('button, a, input, textarea, select, [contenteditable="true"]'))
    : false;
}

function buttonPressed(gamepad: Gamepad | null | undefined, index: number): boolean {
  return Boolean(gamepad?.buttons?.[index]?.pressed);
}

function buttonValue(gamepad: Gamepad | null | undefined, index: number): number {
  const value = gamepad?.buttons?.[index]?.value;
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : (buttonPressed(gamepad, index) ? 1 : 0);
}

export function applyGamepadTriggerDeadzone(value: number, deadzone = GAMEPAD_TRIGGER_DEADZONE): number {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const safeDeadzone = Math.max(0, Math.min(0.99, deadzone));
  if (normalized <= safeDeadzone) return 0;
  return Math.min(1, (normalized - safeDeadzone) / (1 - safeDeadzone));
}

export function applyGamepadRadialDeadzone(x: number, y: number, deadzone = GAMEPAD_DEADZONE) {
  const nx = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
  const ny = Number.isFinite(y) ? Math.max(-1, Math.min(1, y)) : 0;
  const magnitude = Math.min(1, Math.hypot(nx, ny));
  const safeDeadzone = Math.max(0, Math.min(0.99, deadzone));
  if (magnitude <= safeDeadzone || magnitude === 0) return { x: 0, y: 0, magnitude: 0 };
  const remappedMagnitude = Math.min(1, (magnitude - safeDeadzone) / (1 - safeDeadzone));
  const scale = remappedMagnitude / Math.hypot(nx, ny);
  return { x: (nx * scale) || 0, y: (ny * scale) || 0, magnitude: remappedMagnitude };
}

function readActionButtons(gamepad: Gamepad | null): GamepadButtonState {
  return Object.freeze({
    jump: buttonPressed(gamepad, GAMEPAD_BUTTON.JUMP),
    dodge: buttonPressed(gamepad, GAMEPAD_BUTTON.DODGE),
    light: buttonPressed(gamepad, GAMEPAD_BUTTON.LIGHT),
    heavy: buttonPressed(gamepad, GAMEPAD_BUTTON.HEAVY),
    parry: buttonPressed(gamepad, GAMEPAD_BUTTON.PARRY),
    lockOn: buttonPressed(gamepad, GAMEPAD_BUTTON.LOCK_ON),
  });
}

function readGamepadDpad(gamepad: Gamepad | null) {
  const x = Number(buttonPressed(gamepad, GAMEPAD_BUTTON.DPAD_RIGHT)) - Number(buttonPressed(gamepad, GAMEPAD_BUTTON.DPAD_LEFT));
  const y = Number(buttonPressed(gamepad, GAMEPAD_BUTTON.DPAD_DOWN)) - Number(buttonPressed(gamepad, GAMEPAD_BUTTON.DPAD_UP));
  const length = Math.hypot(x, y);
  if (length === 0) return { x: 0, y: 0, magnitude: 0 };
  return { x: x / length, y: y / length, magnitude: 1 };
}

export function resolveGamepadSprintIntent(magnitude: number, sprintPressed: boolean, wasRunning = false): boolean {
  if (!sprintPressed) return false;
  const threshold = wasRunning ? GAMEPAD_SPRINT_RELEASE_MAGNITUDE : GAMEPAD_SPRINT_MIN_MAGNITUDE;
  return Number.isFinite(magnitude) && magnitude >= threshold;
}

export function selectPlayerGamepad(
  gamepads: ArrayLike<Gamepad | null> | readonly (Gamepad | null)[],
  preferredIndex: number | null = null,
): Gamepad | null {
  const standard = Array.from(gamepads ?? []).filter(
    (pad): pad is Gamepad => Boolean(pad?.connected && pad.mapping === 'standard'),
  );
  if (preferredIndex !== null) {
    const sticky = standard.find((pad) => pad.index === preferredIndex);
    if (sticky) return sticky;
  }
  return standard.sort((a, b) => a.index - b.index)[0] ?? null;
}

export function samplePlayerGamepad(
  gamepad: Gamepad | null,
  previousButtons: Partial<GamepadButtonState> = EMPTY_BUTTONS,
  previousRunning = false,
): GamepadSample {
  if (!gamepad?.connected || gamepad.mapping !== 'standard') {
    return Object.freeze({
      forward: 0, strafe: 0, magnitude: 0, lookX: 0, lookY: 0, lookMagnitude: 0,
      cameraZoom: 0, running: false, guarding: false,
      jumpPressed: false, dodgePressed: false, lightPressed: false, heavyPressed: false,
      parryPressed: false, lockOnPressed: false, buttons: EMPTY_BUTTONS,
      ...EMPTY_BUTTONS,
    });
  }

  const stick = applyGamepadRadialDeadzone(gamepad.axes?.[0] ?? 0, gamepad.axes?.[1] ?? 0);
  const dpad = readGamepadDpad(gamepad);
  const locomotion = stick.magnitude > 0 ? stick : dpad;
  const look = applyGamepadRadialDeadzone(gamepad.axes?.[2] ?? 0, gamepad.axes?.[3] ?? 0);
  const buttons = readActionButtons(gamepad);
  const zoomIn = applyGamepadTriggerDeadzone(buttonValue(gamepad, GAMEPAD_BUTTON.ZOOM_IN));
  const zoomOut = applyGamepadTriggerDeadzone(buttonValue(gamepad, GAMEPAD_BUTTON.ZOOM_OUT));
  return Object.freeze({
    forward: (-locomotion.y) || 0,
    strafe: locomotion.x,
    magnitude: locomotion.magnitude,
    lookX: look.x,
    lookY: look.y,
    lookMagnitude: look.magnitude,
    cameraZoom: zoomIn - zoomOut,
    running: resolveGamepadSprintIntent(locomotion.magnitude, buttonPressed(gamepad, GAMEPAD_BUTTON.SPRINT), previousRunning),
    guarding: buttonPressed(gamepad, GAMEPAD_BUTTON.GUARD),
    jumpPressed: buttons.jump && !Boolean(previousButtons.jump),
    dodgePressed: buttons.dodge && !Boolean(previousButtons.dodge),
    lightPressed: buttons.light && !Boolean(previousButtons.light),
    heavyPressed: buttons.heavy && !Boolean(previousButtons.heavy),
    parryPressed: buttons.parry && !Boolean(previousButtons.parry),
    lockOnPressed: buttons.lockOn && !Boolean(previousButtons.lockOn),
    buttons,
    ...buttons,
  });
}

interface HapticActuatorLike {
  playEffect: (type: string, params: HapticProfile & { startDelay?: number }) => PromiseLike<unknown> | unknown;
}

function readGamepadHapticActuator(gamepad: Gamepad | null): HapticActuatorLike | null {
  const candidate = gamepad as (Gamepad & {
    readonly vibrationActuator?: HapticActuatorLike | null;
    readonly hapticActuators?: readonly HapticActuatorLike[];
  }) | null;
  const vibrationActuator = candidate?.vibrationActuator;
  if (typeof vibrationActuator?.playEffect === 'function') return vibrationActuator;
  const fallbackActuator = candidate?.hapticActuators?.[0];
  return typeof fallbackActuator?.playEffect === 'function' ? fallbackActuator : null;
}

function requestGamepadHaptic(gamepad: Gamepad | null, profile: HapticProfile | null): Promise<boolean> | null {
  const actuator = readGamepadHapticActuator(gamepad);
  if (!profile || gamepad?.mapping !== 'standard' || !gamepad?.connected || !actuator) return null;
  try {
    return Promise.resolve(actuator.playEffect('dual-rumble', { startDelay: 0, ...profile }))
      .then(() => true, () => false);
  } catch {
    return null;
  }
}

function playGamepadHaptic(gamepad: Gamepad | null, profile: HapticProfile | null): boolean {
  return Boolean(requestGamepadHaptic(gamepad, profile));
}

function readGamepadHapticProfile(
  profiles: Readonly<Record<string, HapticProfile>>,
  kind: string | undefined,
): HapticProfile | null {
  return typeof kind === 'string' && Object.hasOwn(profiles, kind) ? profiles[kind] ?? null : null;
}

function readCombatFeedbackAmount(value: number | undefined): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : 0;
}

export function resolvePlayerCombatFeedbackHaptic(feedback: CombatFeedback | null | undefined): HapticProfile | null {
  const outcome = feedback?.outcome;
  const profile = readGamepadHapticProfile(GAMEPAD_COMBAT_FEEDBACK_HAPTICS, outcome);
  if (!profile) return null;
  const appliedAmount = readCombatFeedbackAmount(feedback?.appliedAmount);
  const blockedAmount = readCombatFeedbackAmount(feedback?.blockedAmount);
  if ((outcome === 'dodge' || outcome === 'parry' || outcome === 'guard') && blockedAmount <= 0) return null;
  if ((outcome === 'hit' || outcome === 'hit-stagger') && appliedAmount <= 0) return null;
  if (outcome === 'guard-break' && appliedAmount <= 0 && blockedAmount <= 0) return null;
  return profile;
}

export function pulsePlayerGamepadAction(gamepad: Gamepad | null, kind: string): boolean {
  return playGamepadHaptic(gamepad, readGamepadHapticProfile(GAMEPAD_ACTION_HAPTICS, kind));
}

export function pulsePlayerGamepadMelee(gamepad: Gamepad | null, kind: string): boolean {
  return pulsePlayerGamepadAction(gamepad, kind);
}

export function pulsePlayerGamepadCombatFeedback(gamepad: Gamepad | null, feedback: CombatFeedback | null | undefined): boolean {
  return playGamepadHaptic(gamepad, resolvePlayerCombatFeedbackHaptic(feedback));
}

export function emitPlayerCombatIntent(kind: 'light' | 'heavy', source = 'unknown'): boolean {
  if ((kind !== 'light' && kind !== 'heavy') || typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') {
    return false;
  }
  globalThis.dispatchEvent(new CustomEvent(COMBAT_INPUT_EVENT, { detail: Object.freeze({ kind, source }) }));
  return true;
}

function emitInputDeviceChange(index: number | null, reason: string): void {
  if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
  globalThis.dispatchEvent(new CustomEvent(INPUT_DEVICE_EVENT, {
    detail: Object.freeze({ device: index === null ? 'keyboard-pointer' : 'gamepad', gamepadIndex: index, reason }),
  }));
}

export class KeyboardInput {
  private readonly target: Window;
  private readonly keys = new Set<string>();
  private jumpRequested = false;
  private lockOnRequested = false;
  private guardPointerHeld = false;
  private gamepadButtons: GamepadButtonState = EMPTY_BUTTONS;
  private gamepadSprintActive = false;
  private activeGamepadIndex: number | null = null;
  private lastPollSeconds: number | null = null;
  private lastCombatFeedbackSerial = 0;
  private pendingCombatFeedbackSerial = 0;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const firstPress = !this.keys.has(event.code);
    if (JUMP_KEYS.has(event.code) && firstPress) this.jumpRequested = true;
    if (firstPress && LOCK_ON_KEYS.has(event.code) && !isInteractiveTarget(event.target)) {
      this.lockOnRequested = true;
      event.preventDefault();
    }
    if (firstPress && LIGHT_ATTACK_KEYS.has(event.code)) emitPlayerCombatIntent('light', 'keyboard');
    if (firstPress && HEAVY_ATTACK_KEYS.has(event.code)) emitPlayerCombatIntent('heavy', 'keyboard');
    this.keys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button === GUARD_POINTER_BUTTON) {
      this.guardPointerHeld = true;
      event.preventDefault();
      return;
    }
    if (event.button === LIGHT_ATTACK_POINTER_BUTTON && !isInteractiveTarget(event.target)) {
      emitPlayerCombatIntent('light', 'mouse');
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.button === GUARD_POINTER_BUTTON) this.guardPointerHeld = false;
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (this.guardPointerHeld) event.preventDefault();
  };

  private readonly onCombatFeedback = (event: Event): void => {
    const detail = (event as CustomEvent<CombatFeedback>).detail;
    const serial = detail?.serial;
    if (!Number.isSafeInteger(serial) || Number(serial) <= 0 || Number(serial) <= Math.max(this.lastCombatFeedbackSerial, this.pendingCombatFeedbackSerial)) return;
    const pads = this.target.navigator.getGamepads?.() ?? [];
    const gamepad = selectPlayerGamepad(pads, this.activeGamepadIndex);
    if (!gamepad || gamepad.index !== this.activeGamepadIndex) return;
    const request = requestGamepadHaptic(gamepad, resolvePlayerCombatFeedbackHaptic(detail));
    if (!request) return;
    this.pendingCombatFeedbackSerial = Number(serial);
    void request.then((played) => {
      if (this.pendingCombatFeedbackSerial === serial) this.pendingCombatFeedbackSerial = 0;
      if (played && Number(serial) > this.lastCombatFeedbackSerial) this.lastCombatFeedbackSerial = Number(serial);
    });
  };

  private readonly onFocusLoss = (event: Event): void => {
    const hadActiveInput = this.keys.size > 0 || this.jumpRequested || this.lockOnRequested || this.guardPointerHeld || this.activeGamepadIndex !== null;
    this.reset();
    if (hadActiveInput) emitInputDeviceChange(null,
      event.type === 'pagehide' ? 'page-hidden' :
      event.type === 'visibilitychange' ? 'visibility-hidden' : 'focus-lost');
  };

  private readonly onVisibilityChange = (): void => {
    if (this.target.document.hidden) this.onFocusLoss(new Event('visibilitychange'));
  };

  constructor(target: Window = window) {
    this.target = target;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('pointerdown', this.onPointerDown);
    target.addEventListener('pointerup', this.onPointerUp);
    target.addEventListener('pointercancel', this.onPointerUp);
    target.addEventListener('contextmenu', this.onContextMenu);
    target.addEventListener(COMBAT_FEEDBACK_EVENT, this.onCombatFeedback);
    target.addEventListener('blur', this.onFocusLoss);
    target.addEventListener('pagehide', this.onFocusLoss);
    target.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private reset(): void {
    this.keys.clear();
    this.jumpRequested = false;
    this.lockOnRequested = false;
    this.guardPointerHeld = false;
    this.gamepadButtons = EMPTY_BUTTONS;
    this.gamepadSprintActive = false;
    this.activeGamepadIndex = null;
    this.lastPollSeconds = null;
    this.lastCombatFeedbackSerial = 0;
    this.pendingCombatFeedbackSerial = 0;
  }

  private pollGamepad(): GamepadSample & { readonly lookDeltaSeconds: number } {
    const pads = this.target.navigator.getGamepads?.() ?? [];
    const gamepad = selectPlayerGamepad(pads, this.activeGamepadIndex);
    const nextIndex = gamepad?.index ?? null;
    const switched = nextIndex !== this.activeGamepadIndex;
    const nowSeconds = (this.target.performance?.now() ?? Date.now()) / 1000;
    const lookDeltaSeconds = this.lastPollSeconds === null ? 0 : Math.max(0, Math.min(GAMEPAD_CAMERA_MAX_FRAME_SECONDS, nowSeconds - this.lastPollSeconds));
    this.lastPollSeconds = nowSeconds;

    if (switched) {
      this.gamepadButtons = gamepad ? readActionButtons(gamepad) : EMPTY_BUTTONS;
      this.gamepadSprintActive = false;
      this.activeGamepadIndex = nextIndex;
      emitInputDeviceChange(nextIndex, gamepad ? 'selected' : 'disconnected');
    }

    const sample = samplePlayerGamepad(gamepad, this.gamepadButtons, this.gamepadSprintActive);
    if (!switched) {
      if (sample.jumpPressed) this.jumpRequested = true;
      if (sample.lockOnPressed) this.lockOnRequested = true;
      if (sample.dodgePressed && sample.magnitude >= GAMEPAD_DODGE_MIN_MAGNITUDE) pulsePlayerGamepadAction(gamepad, 'dodge');
      if (sample.parryPressed) pulsePlayerGamepadAction(gamepad, 'parry');
      if (sample.lightPressed) { emitPlayerCombatIntent('light', 'gamepad'); pulsePlayerGamepadAction(gamepad, 'light'); }
      if (sample.heavyPressed) { emitPlayerCombatIntent('heavy', 'gamepad'); pulsePlayerGamepadAction(gamepad, 'heavy'); }
    }

    this.gamepadButtons = sample.buttons;
    this.gamepadSprintActive = sample.running;
    return Object.freeze({ ...sample, lookDeltaSeconds });
  }

  getAxes(): PlayerInputAxes {
    const gamepad = this.pollGamepad();
    let forward = gamepad.forward;
    let strafe = gamepad.strafe;
    let running = gamepad.running;
    let guarding = this.guardPointerHeld || gamepad.guarding;

    for (const code of this.keys) {
      if (FORWARD_KEYS.has(code)) forward += 1;
      else if (BACK_KEYS.has(code)) forward -= 1;
      else if (RIGHT_KEYS.has(code)) strafe += 1;
      else if (LEFT_KEYS.has(code)) strafe -= 1;
      else if (RUN_KEYS.has(code)) running = true;
      else if (GUARD_KEYS.has(code)) guarding = true;
    }

    const dodgeRequested = gamepad.dodgePressed && gamepad.magnitude >= GAMEPAD_DODGE_MIN_MAGNITUDE;
    if (dodgeRequested) running = true;
    if (gamepad.parryPressed) guarding = true;

    const jumpRequested = this.jumpRequested;
    this.jumpRequested = false;

    return Object.freeze({
      forward: Math.max(-1, Math.min(1, forward)),
      strafe: Math.max(-1, Math.min(1, strafe)),
      running,
      jumpRequested: jumpRequested || dodgeRequested,
      lockOnRequested: this.lockOnRequested,
      guarding,
      lookX: gamepad.lookX,
      lookY: gamepad.lookY,
      cameraZoom: gamepad.cameraZoom,
      lookDeltaSeconds: gamepad.lookDeltaSeconds,
    });
  }

  consumeLockOnRequested(): boolean {
    const requested = this.lockOnRequested;
    this.lockOnRequested = false;
    return requested;
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('pointerdown', this.onPointerDown);
    this.target.removeEventListener('pointerup', this.onPointerUp);
    this.target.removeEventListener('pointercancel', this.onPointerUp);
    this.target.removeEventListener('contextmenu', this.onContextMenu);
    this.target.removeEventListener(COMBAT_FEEDBACK_EVENT, this.onCombatFeedback);
    this.target.removeEventListener('blur', this.onFocusLoss);
    this.target.removeEventListener('pagehide', this.onFocusLoss);
    this.target.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.reset();
  }
}
