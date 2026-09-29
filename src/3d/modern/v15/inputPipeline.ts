import {
  clampV15,
  sequenceV15,
  type InputIntentV15,
  type Vec2V15,
} from "./types.ts";

export type InputButtonV15 = "jump" | "dodge" | "attack" | "block" | "interact" | "lockOn" | "pause";

export interface InputSnapshotV15 {
  readonly move: Vec2V15;
  readonly look: Vec2V15;
  readonly pressed: readonly InputButtonV15[];
  readonly held: readonly InputButtonV15[];
  readonly released: readonly InputButtonV15[];
  readonly source: InputIntentV15["source"];
  readonly sequence: number;
  readonly timestampMs: number;
}

export interface InputPipelineOptionsV15 {
  readonly deadzone?: number;
  readonly lookSensitivity?: number;
  readonly maxLookPerSecond?: number;
  readonly repeatDelayMs?: number;
  readonly repeatIntervalMs?: number;
}

const KEY_BINDINGS: Readonly<Record<string, InputButtonV15>> = Object.freeze({
  Space: "jump",
  ShiftLeft: "dodge",
  ShiftRight: "dodge",
  KeyF: "attack",
  KeyG: "block",
  KeyE: "interact",
  Tab: "lockOn",
  Escape: "pause",
});

const ORDER: readonly InputButtonV15[] = ["jump", "dodge", "attack", "block", "interact", "lockOn", "pause"];

function normalizeVector(x: number, y: number, deadzone: number): Vec2V15 {
  const nx = clampV15(Number.isFinite(x) ? x : 0, -1, 1);
  const ny = clampV15(Number.isFinite(y) ? y : 0, -1, 1);
  const magnitude = Math.hypot(nx, ny);
  if (magnitude <= deadzone) return { x: 0, y: 0 };
  const scaled = clampV15((magnitude - deadzone) / Math.max(0.0001, 1 - deadzone), 0, 1);
  return { x: nx / magnitude * scaled, y: ny / magnitude * scaled };
}

export class SemanticInputPipelineV15 {
  readonly #deadzone: number;
  readonly #lookSensitivity: number;
  readonly #maxLookPerSecond: number;
  readonly #repeatDelayMs: number;
  readonly #repeatIntervalMs: number;
  readonly #held = new Set<InputButtonV15>();
  readonly #pressed = new Set<InputButtonV15>();
  readonly #released = new Set<InputButtonV15>();
  readonly #repeatAt = new Map<InputButtonV15, number>();
  #sequence = sequenceV15(0);
  #lastTimestampMs = 0;
  #move: Vec2V15 = { x: 0, y: 0 };
  #look: Vec2V15 = { x: 0, y: 0 };
  #source: InputIntentV15["source"] = "system";

  constructor(options: InputPipelineOptionsV15 = {}) {
    this.#deadzone = clampV15(options.deadzone ?? 0.14, 0, 0.45);
    this.#lookSensitivity = clampV15(options.lookSensitivity ?? 1, 0.05, 4);
    this.#maxLookPerSecond = clampV15(options.maxLookPerSecond ?? 4, 0.25, 20);
    this.#repeatDelayMs = clampV15(options.repeatDelayMs ?? 450, 100, 2_000);
    this.#repeatIntervalMs = clampV15(options.repeatIntervalMs ?? 120, 40, 1_000);
  }

  ingestKeyboard(code: string, isDown: boolean, timestampMs: number): void {
    const button = KEY_BINDINGS[code];
    if (button) this.#ingestButton(button, isDown, timestampMs, "keyboard");
  }

  ingestPointer(button: number, isDown: boolean, timestampMs: number): void {
    if (button === 0) this.#ingestButton("attack", isDown, timestampMs, "pointer");
  }

  ingestTouchMove(x: number, y: number): void {
    this.#move = normalizeVector(x, y, this.#deadzone);
    this.#source = "touch";
  }

  ingestGamepad(
    moveX: number,
    moveY: number,
    lookX: number,
    lookY: number,
    buttons: Readonly<Partial<Record<InputButtonV15, boolean>>>,
    timestampMs: number,
  ): void {
    this.#move = normalizeVector(moveX, moveY, this.#deadzone);
    const look = normalizeVector(lookX, lookY, this.#deadzone);
    this.#look = { x: look.x * this.#lookSensitivity, y: look.y * this.#lookSensitivity };
    this.#source = "gamepad";
    for (const button of ORDER) this.#ingestButton(button, Boolean(buttons[button]), timestampMs, "gamepad");
  }

  setMove(x: number, y: number, source: InputIntentV15["source"] = "system"): void {
    this.#move = normalizeVector(x, y, this.#deadzone);
    this.#source = source;
  }

  setLook(x: number, y: number, source: InputIntentV15["source"] = "system"): void {
    const look = normalizeVector(x, y, this.#deadzone);
    this.#look = { x: look.x * this.#lookSensitivity, y: look.y * this.#lookSensitivity };
    this.#source = source;
  }

  consume(timestampMs: number): InputIntentV15 {
    const bounded = Math.max(this.#lastTimestampMs, Number.isFinite(timestampMs) ? timestampMs : this.#lastTimestampMs);
    const deltaSeconds = this.#lastTimestampMs > 0 ? Math.min(0.25, Math.max(0, (bounded - this.#lastTimestampMs) / 1_000)) : 0;
    const lookBound = Math.max(0, this.#maxLookPerSecond * deltaSeconds);
    const look = deltaSeconds > 0
      ? { x: clampV15(this.#look.x, -lookBound, lookBound), y: clampV15(this.#look.y, -lookBound, lookBound) }
      : { ...this.#look };
    const repeated = this.#repeatActions(bounded);
    const actions = [...new Set([...this.#pressed, ...repeated])].sort();
    const intent: InputIntentV15 = Object.freeze({
      sequence: sequenceV15(Number(this.#sequence) + 1),
      timestampMs: bounded,
      move: { ...this.#move },
      look,
      buttons: this.#bitmask(),
      actions: Object.freeze(actions),
      source: this.#source,
    });
    this.#sequence = intent.sequence;
    this.#lastTimestampMs = bounded;
    this.#pressed.clear();
    this.#released.clear();
    return intent;
  }

  snapshot(timestampMs: number): InputSnapshotV15 {
    const intent = this.consume(timestampMs);
    return Object.freeze({
      move: intent.move,
      look: intent.look,
      pressed: Object.freeze([...intent.actions] as InputButtonV15[]),
      held: Object.freeze([...this.#held].sort()),
      released: Object.freeze([...this.#released].sort()),
      source: intent.source,
      sequence: Number(intent.sequence),
      timestampMs: intent.timestampMs,
    });
  }

  clear(): void {
    this.#held.clear();
    this.#pressed.clear();
    this.#released.clear();
    this.#repeatAt.clear();
    this.#move = { x: 0, y: 0 };
    this.#look = { x: 0, y: 0 };
  }

  isHeld(button: InputButtonV15): boolean { return this.#held.has(button); }
  isPressed(button: InputButtonV15): boolean { return this.#pressed.has(button); }
  isReleased(button: InputButtonV15): boolean { return this.#released.has(button); }

  #ingestButton(button: InputButtonV15, isDown: boolean, timestampMs: number, source: InputIntentV15["source"]): void {
    this.#source = source;
    if (isDown) {
      if (!this.#held.has(button)) {
        this.#pressed.add(button);
        this.#repeatAt.set(button, Math.max(0, timestampMs) + this.#repeatDelayMs);
      }
      this.#held.add(button);
      return;
    }
    if (this.#held.has(button)) this.#released.add(button);
    this.#held.delete(button);
    this.#repeatAt.delete(button);
  }

  #repeatActions(nowMs: number): InputButtonV15[] {
    const actions: InputButtonV15[] = [];
    for (const [button, due] of this.#repeatAt.entries()) {
      if (!this.#held.has(button) || nowMs < due) continue;
      actions.push(button);
      this.#repeatAt.set(button, nowMs + this.#repeatIntervalMs);
    }
    return actions;
  }

  #bitmask(): number {
    return ORDER.reduce((mask, button, index) => mask | (this.#held.has(button) ? 1 << index : 0), 0);
  }
}

export function keyboardEventToInputV15(
  event: Pick<KeyboardEvent, "code" | "type" | "repeat">,
): { readonly handled: boolean; readonly button: InputButtonV15 | null; readonly isDown: boolean } {
  const button = KEY_BINDINGS[event.code];
  if (!button) return { handled: false, button: null, isDown: event.type === "keydown" };
  return { handled: true, button, isDown: event.type === "keydown" };
}
