import { sanitizeId, sanitizeText } from '../runtimeSecurityV2.ts';
import { emptyInputState, type AppCommand, type AppCommandBus, type AppInputState } from './appTypes.ts';

export interface InputBinding { readonly action: string; readonly source: 'keyboard' | 'pointer' | 'touch' | 'gamepad'; readonly code: string; readonly scale?: number; readonly deadZone?: number; readonly invert?: boolean; readonly priority?: number; }
export interface InputActionState { readonly pressed: boolean; readonly justPressed: boolean; readonly justReleased: boolean; readonly value: number; readonly repeatCount: number; readonly source?: InputBinding['source']; }
export interface InputSnapshot extends AppInputState { readonly timestampMs: number; readonly sequence: number; }
export interface PlayerInputFrame { readonly moveX: number; readonly moveZ: number; readonly sprint: boolean; readonly jumpPressed: boolean; readonly dodgePressed: boolean; readonly attackPressed: boolean; readonly heavyPressed: boolean; readonly block: boolean; readonly aimX?: number; readonly aimZ?: number; }

const normalize = (value: number): number => Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
const applyDeadZone = (value: number, zone: number): number => {
  const z = Math.max(0, Math.min(0.95, zone));
  const absolute = Math.abs(value);
  if (absolute <= z) return 0;
  const scaled = (absolute - z) / Math.max(0.0001, 1 - z);
  return Math.sign(value) * Math.min(1, scaled);
};

export class CommandBus implements AppCommandBus {
  readonly #maxPending: number;
  #sequence = 0;
  #queue: AppCommand[] = [];
  #dropped = 0;

  constructor(maxPending = 2048) { this.#maxPending = Math.max(32, Math.floor(maxPending)); }
  dispatch<T>(command: Omit<AppCommand<T>, 'sequence' | 'consumed'>): AppCommand<T> {
    const next = Object.freeze({ ...command, id: sanitizeId(command.id), type: sanitizeId(command.type), sequence: ++this.#sequence, consumed: false }) as AppCommand<T>;
    if (this.#queue.length >= this.#maxPending) { this.#queue.shift(); this.#dropped += 1; }
    this.#queue.push(next);
    return next;
  }
  consume(type?: string): AppCommand | undefined {
    const index = type ? this.#queue.findIndex((command) => command.type === type) : 0;
    if (index < 0) return undefined;
    const command = this.#queue[index];
    if (!command) return undefined;
    this.#queue.splice(index, 1);
    return Object.freeze({ ...command, consumed: true });
  }
  drain(max = this.#queue.length): readonly AppCommand[] {
    const count = Math.max(0, Math.min(this.#queue.length, Math.floor(max)));
    return Object.freeze(this.#queue.splice(0, count).map((command) => Object.freeze({ ...command, consumed: true })));
  }
  peek(): readonly AppCommand[] { return Object.freeze([...this.#queue]); }
  pendingCount(): number { return this.#queue.length; }
  droppedCount(): number { return this.#dropped; }
  clear(): void { this.#queue.length = 0; }
}

export class InputCommandSystem {
  readonly #bindings = new Map<string, InputBinding[]>();
  readonly #actions = new Map<string, InputActionState>();
  readonly #keys = new Set<string>();
  readonly #buttons = new Map<string, boolean>();
  readonly #axes = new Map<string, number>();
  readonly #commandBus: CommandBus;
  #pointer = { x: 0, y: 0, dx: 0, dy: 0, locked: false };
  #sequence = 0;

  constructor(commandBus = new CommandBus()) { this.#commandBus = commandBus; }
  get commandBus(): CommandBus { return this.#commandBus; }

  bind(binding: InputBinding): void {
    const action = sanitizeId(binding.action);
    const normalized: InputBinding = Object.freeze({
      action,
      source: binding.source,
      code: sanitizeText(binding.code, 96),
      scale: normalize(binding.scale ?? 1),
      deadZone: Math.max(0, Math.min(0.95, binding.deadZone ?? 0.08)),
      invert: binding.invert ?? false,
      priority: Math.floor(binding.priority ?? 0),
    });
    const list = this.#bindings.get(action) ?? [];
    list.push(normalized);
    list.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    this.#bindings.set(action, list);
    if (!this.#actions.has(action)) this.#actions.set(action, { pressed: false, justPressed: false, justReleased: false, value: 0, repeatCount: 0 });
  }

  bindMany(bindings: readonly InputBinding[]): void { for (const binding of bindings) this.bind(binding); }
  unbind(action: string, code?: string): void {
    const key = sanitizeId(action);
    if (!code) { this.#bindings.delete(key); this.#actions.delete(key); return; }
    const list = this.#bindings.get(key);
    if (!list) return;
    const next = list.filter((binding) => binding.code !== sanitizeText(code, 96));
    if (next.length) this.#bindings.set(key, next); else { this.#bindings.delete(key); this.#actions.delete(key); }
  }

  setKey(code: string, pressed: boolean): void { const key = sanitizeText(code, 96); if (pressed) this.#keys.add(key); else this.#keys.delete(key); }
  setButton(code: string, pressed: boolean): void { this.#buttons.set(sanitizeText(code, 96), Boolean(pressed)); }
  setAxis(code: string, value: number): void { this.#axes.set(sanitizeText(code, 96), normalize(value)); }
  setPointer(x: number, y: number, dx = 0, dy = 0, locked = this.#pointer.locked): void {
    this.#pointer = { x: Number.isFinite(x) ? x : this.#pointer.x, y: Number.isFinite(y) ? y : this.#pointer.y, dx: Number.isFinite(dx) ? dx : 0, dy: Number.isFinite(dy) ? dy : 0, locked: Boolean(locked) };
  }

  sample(nowMs: number): InputSnapshot {
    const actions: Record<string, InputActionState> = {};
    for (const [action, bindings] of this.#bindings) {
      let total = 0;
      let active = false;
      let source: InputBinding['source'] | undefined;
      for (const binding of bindings) {
        let value = 0;
        if (binding.source === 'keyboard') value = this.#keys.has(binding.code) ? 1 : 0;
        else if (binding.source === 'gamepad') value = this.#axes.get(binding.code) ?? (this.#buttons.get(binding.code) ? 1 : 0);
        else value = this.#buttons.get(binding.code) ? 1 : 0;
        value = applyDeadZone(value * (binding.invert ? -1 : 1), binding.deadZone ?? 0.08);
        value = normalize(value * (binding.scale ?? 1));
        total = normalize(total + value);
        if (Math.abs(value) > 0.001) { active = true; source = binding.source; }
      }
      const previous = this.#actions.get(action);
      const state: InputActionState = Object.freeze({ pressed: active, justPressed: active && !Boolean(previous?.pressed), justReleased: !active && Boolean(previous?.pressed), value: total, repeatCount: active ? (previous?.repeatCount ?? 0) + 1 : 0, source });
      actions[action] = state;
      this.#actions.set(action, state);
      if (state.justPressed) this.#commandBus.dispatch({ id: 'input-' + (++this.#sequence), type: action, payload: Object.freeze({ value: state.value }), source: source ?? 'keyboard', issuedAtMs: nowMs });
    }
    return Object.freeze({ ...emptyInputState(), axes: Object.freeze(Object.fromEntries(this.#axes)), buttons: Object.freeze(Object.fromEntries(this.#buttons)), pointer: Object.freeze({ ...this.#pointer }), actions: Object.freeze(actions), timestampMs: nowMs, sequence: this.#sequence }) as InputSnapshot;
  }

  reset(): void { this.#actions.clear(); this.#keys.clear(); this.#buttons.clear(); this.#axes.clear(); this.#pointer = { x: 0, y: 0, dx: 0, dy: 0, locked: false }; this.#sequence = 0; this.#commandBus.clear(); }
}

export const createDefaultBindings = (): readonly InputBinding[] => Object.freeze([
  { action: 'move-forward', source: 'keyboard', code: 'KeyW', scale: 1 },
  { action: 'move-back', source: 'keyboard', code: 'KeyS', scale: 1 },
  { action: 'move-left', source: 'keyboard', code: 'KeyA', scale: 1 },
  { action: 'move-right', source: 'keyboard', code: 'KeyD', scale: 1 },
  { action: 'sprint', source: 'keyboard', code: 'ShiftLeft', scale: 1 },
  { action: 'jump', source: 'keyboard', code: 'Space', scale: 1 },
  { action: 'dodge', source: 'keyboard', code: 'KeyC', scale: 1 },
  { action: 'attack', source: 'pointer', code: 'primary', scale: 1 },
  { action: 'heavy-attack', source: 'pointer', code: 'secondary', scale: 1 },
  { action: 'block', source: 'keyboard', code: 'KeyF', scale: 1 },
  { action: 'pause', source: 'keyboard', code: 'Escape', scale: 1 },
  { action: 'interact', source: 'keyboard', code: 'KeyE', scale: 1 },
  { action: 'map', source: 'keyboard', code: 'KeyM', scale: 1 },
  { action: 'inventory', source: 'keyboard', code: 'KeyI', scale: 1 },
  { action: 'quick-save', source: 'keyboard', code: 'F5', scale: 1 },
]);

const read = (snapshot: InputSnapshot, id: string): InputActionState => snapshot.actions[id] ?? { pressed: false, justPressed: false, justReleased: false, value: 0, repeatCount: 0 };

export const mapToPlayerInput = (snapshot: InputSnapshot): PlayerInputFrame => {
  const moveX = read(snapshot, 'move-right').value - read(snapshot, 'move-left').value;
  const moveZ = read(snapshot, 'move-back').value - read(snapshot, 'move-forward').value;
  return Object.freeze({
    moveX: normalize(moveX),
    moveZ: normalize(moveZ),
    sprint: read(snapshot, 'sprint').pressed,
    jumpPressed: read(snapshot, 'jump').justPressed,
    dodgePressed: read(snapshot, 'dodge').justPressed,
    attackPressed: read(snapshot, 'attack').justPressed,
    heavyPressed: read(snapshot, 'heavy-attack').justPressed,
    block: read(snapshot, 'block').pressed,
    aimX: snapshot.pointer.dx,
    aimZ: snapshot.pointer.dy,
  });
};

export const consumeAction = (bus: AppCommandBus, action: string): boolean => bus.consume(sanitizeId(action)) !== undefined;
