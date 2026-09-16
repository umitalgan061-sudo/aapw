import type { Disposable, InputBinding, InputFrame, PointerState } from './types';
import { asTimestampMs } from './types';

interface ActionValue { pressed: boolean; justPressed: boolean; justReleased: boolean; value: number; }
interface InternalPointer extends PointerState { lastDown: boolean; }

/** Typed, frame-snapshotted input layer. Browser events are normalized once; gameplay never reads DOM state directly. */
export class InputManager implements Disposable {
  private readonly target: Window | HTMLElement | null;
  private readonly actions = new Map<string, ActionValue>();
  private readonly bindings: InputBinding[] = [];
  private readonly keys = new Set<string>();
  private readonly pointers = new Map<number, InternalPointer>();
  private readonly axes = new Map<string, number>();
  private readonly abort = new AbortController();
  private disposed = false;

  public constructor(target: Window | HTMLElement | null = typeof window !== 'undefined' ? window : null) {
    this.target = target;
    this.attach();
  }

  public bind(binding: InputBinding): Disposable {
    this.ensureActive();
    const normalized = { ...binding, keys: binding.keys ? [...binding.keys].map(normalizeKey) : undefined };
    this.bindings.push(normalized);
    if (!this.actions.has(normalized.action)) this.actions.set(normalized.action, { pressed: false, justPressed: false, justReleased: false, value: 0 });
    return { dispose: () => this.unbind(normalized) };
  }

  private unbind(binding: InputBinding): void {
    const index = this.bindings.indexOf(binding);
    if (index >= 0) this.bindings.splice(index, 1);
  }

  public action(name: string): ActionValue {
    const state = this.actions.get(name);
    return state ? { ...state } : { pressed: false, justPressed: false, justReleased: false, value: 0 };
  }

  public axis(name: string): number { return this.axes.get(name) ?? 0; }

  public beginFrame(): void {
    for (const action of this.actions.values()) { action.justPressed = false; action.justReleased = false; }
    for (const pointer of this.pointers.values()) pointer.lastDown = pointer.down;
  }

  public snapshot(timestamp = Date.now()): InputFrame {
    this.recompute();
    return Object.freeze({
      timestamp: asTimestampMs(timestamp),
      axes: Object.fromEntries(this.axes),
      buttons: Object.fromEntries([...this.actions.entries()].map(([name, state]) => [name, state.pressed])),
      pointers: [...this.pointers.values()].map(({ lastDown: _lastDown, ...pointer }) => ({ ...pointer })),
    });
  }

  private recompute(): void {
    for (const binding of this.bindings) {
      const held = (binding.keys ?? []).some((key) => this.keys.has(normalizeKey(key)));
      const action = this.actions.get(binding.action);
      if (!action) continue;
      const previous = action.pressed;
      action.pressed = held;
      action.value = action.pressed ? (binding.sensitivity ?? 1) : 0;
      action.justPressed ||= action.pressed && !previous;
      action.justReleased ||= !action.pressed && previous;
    }
  }

  private attach(): void {
    if (!this.target) return;
    const options: AddEventListenerOptions = { signal: this.abort.signal };
    this.target.addEventListener('keydown', this.onKeyDown as EventListener, options);
    this.target.addEventListener('keyup', this.onKeyUp as EventListener, options);
    this.target.addEventListener('blur', this.onBlur as EventListener, options);
    this.target.addEventListener('pointerdown', this.onPointerDown as EventListener, options);
    this.target.addEventListener('pointermove', this.onPointerMove as EventListener, options);
    this.target.addEventListener('pointerup', this.onPointerUp as EventListener, options);
    this.target.addEventListener('pointercancel', this.onPointerUp as EventListener, options);
  }

  private onKeyDown = (event: KeyboardEvent): void => { this.keys.add(normalizeKey(event.key)); };
  private onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(normalizeKey(event.key)); };
  private onBlur = (): void => { this.keys.clear(); for (const pointer of this.pointers.values()) pointer.down = false; };
  private onPointerDown = (event: PointerEvent): void => { this.pointers.set(event.pointerId, this.pointer(event, true)); };
  private onPointerMove = (event: PointerEvent): void => { this.pointers.set(event.pointerId, this.pointer(event, this.pointers.get(event.pointerId)?.down ?? false, this.pointers.get(event.pointerId)?.lastDown ?? false)); };
  private onPointerUp = (event: PointerEvent): void => { this.pointers.set(event.pointerId, this.pointer(event, false, this.pointers.get(event.pointerId)?.lastDown ?? false)); };
  private pointer(event: PointerEvent, down: boolean, lastDown = false): InternalPointer { return { id: event.pointerId, x: event.clientX, y: event.clientY, pressure: event.pressure || (down ? 0.5 : 0), down, lastDown }; }

  public clear(): void {
    this.keys.clear(); this.pointers.clear(); this.axes.clear();
    for (const action of this.actions.values()) Object.assign(action, { pressed: false, justPressed: false, justReleased: false, value: 0 });
  }
  private ensureActive(): void { if (this.disposed) throw new Error('INPUT_MANAGER_DISPOSED'); }
  public dispose(): void { if (this.disposed) return; this.abort.abort(); this.bindings.length = 0; this.clear(); this.disposed = true; }
}

const normalizeKey = (value: string): string => value.toLowerCase();

export interface AccessibilityPreferenceState { readonly reducedMotion: boolean; readonly contrast: boolean; readonly coarsePointer: boolean; readonly forcedColors: boolean; }
export const readAccessibilityPreferences = (): AccessibilityPreferenceState => {
  if (typeof matchMedia === 'undefined') return { reducedMotion: false, contrast: false, coarsePointer: false, forcedColors: false };
  return { reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, contrast: matchMedia('(prefers-contrast: more)').matches, coarsePointer: matchMedia('(pointer: coarse)').matches, forcedColors: matchMedia('(forced-colors: active)').matches };
};
