import type { BrowserInputPortR31, RuntimeCommandKind, RuntimeCommandR31, Vec2R31 } from './applicationTypesR31.ts';
import { asR31Id } from './applicationTypesR31.ts';
import { RateLimiterR31 } from './securityR31.ts';

export interface BrowserInputStateR31 {
  readonly axes: Vec2R31;
  readonly pointer: Vec2R31;
  readonly pressed: readonly string[];
  readonly justPressed: readonly string[];
  readonly justReleased: readonly string[];
}

export interface BrowserRuntimeHooksR31 {
  readonly enqueue: (command: RuntimeCommandR31) => boolean;
  readonly source?: string;
  readonly nowMs?: () => number;
  readonly getFrame?: () => number;
  readonly getTick?: () => number;
}

export interface BrowserBridgeDiagnosticsR31 {
  readonly eventsSeen: number;
  readonly commandsAccepted: number;
  readonly commandsRejected: number;
  readonly keyboardBindings: number;
  readonly pointerBindings: number;
}

export class BrowserRuntimeBridgeR31 implements BrowserInputPortR31 {
  readonly #hooks: Required<Pick<BrowserRuntimeHooksR31, 'nowMs' | 'getFrame' | 'getTick'>> & Pick<BrowserRuntimeHooksR31, 'enqueue' | 'source'>;
  readonly #pressed = new Set<string>();
  readonly #justPressed = new Set<string>();
  readonly #justReleased = new Set<string>();
  readonly #keys = new Set<string>();
  readonly #events = new Set<string>();
  readonly #limiter = new RateLimiterR31(120, 1000);
  #started = false;
  #eventsSeen = 0;
  #accepted = 0;
  #rejected = 0;
  #pointerX = 0;
  #pointerY = 0;
  #axisX = 0;
  #axisY = 0;

  constructor(hooks: BrowserRuntimeHooksR31) {
    if (!hooks.enqueue) throw new Error('enqueue hook is required');
    this.#hooks = {
      enqueue: hooks.enqueue,
      source: hooks.source,
      nowMs: hooks.nowMs ?? (() => performance.now()),
      getFrame: hooks.getFrame ?? (() => 0),
      getTick: hooks.getTick ?? (() => 0),
    };
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    addEventListener('keydown', this.#onKeyDown);
    addEventListener('keyup', this.#onKeyUp);
    addEventListener('pointermove', this.#onPointerMove);
    addEventListener('pointerdown', this.#onPointerDown);
    addEventListener('pointerup', this.#onPointerUp);
    addEventListener('blur', this.#onBlur);
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    removeEventListener('keydown', this.#onKeyDown);
    removeEventListener('keyup', this.#onKeyUp);
    removeEventListener('pointermove', this.#onPointerMove);
    removeEventListener('pointerdown', this.#onPointerDown);
    removeEventListener('pointerup', this.#onPointerUp);
    removeEventListener('blur', this.#onBlur);
    this.#pressed.clear();
    this.#justPressed.clear();
    this.#justReleased.clear();
  }

  sample(): BrowserInputStateR31 {
    const state = Object.freeze({
      axes: Object.freeze({ x: this.#axisX, y: this.#axisY }),
      pointer: Object.freeze({ x: this.#pointerX, y: this.#pointerY }),
      pressed: Object.freeze([...this.#pressed].sort()),
      justPressed: Object.freeze([...this.#justPressed].sort()),
      justReleased: Object.freeze([...this.#justReleased].sort()),
    });
    this.#justPressed.clear();
    this.#justReleased.clear();
    return state;
  }

  bindKey(key: string, commandKind: RuntimeCommandKind, commandName: string): void {
    this.#keys.add(key);
    this.#events.add(`${key}::${commandKind}::${commandName}`);
  }

  commandForKey(key: string, kind: RuntimeCommandKind, name: string, payload: unknown = null): boolean {
    const now = this.#hooks.nowMs();
    if (!this.#limiter.allow(now)) return this.reject();
    const command: RuntimeCommandR31 = Object.freeze({
      id: asR31Id(`r31.input.${this.#hooks.getFrame().toString(36)}.${key}`),
      kind,
      name,
      priority: 'high',
      payload,
      context: Object.freeze({
        frame: this.#hooks.getFrame(),
        simulationTick: this.#hooks.getTick(),
        source: this.#hooks.source ?? 'browser',
        acceptedAt: now,
      }),
    });
    return this.dispatch(command);
  }

  diagnostics(): BrowserBridgeDiagnosticsR31 {
    return Object.freeze({
      eventsSeen: this.#eventsSeen,
      commandsAccepted: this.#accepted,
      commandsRejected: this.#rejected,
      keyboardBindings: this.#keys.size,
      pointerBindings: this.#events.size,
    });
  }

  #dispatch(command: RuntimeCommandR31): boolean {
    const accepted = this.#hooks.enqueue(command);
    if (accepted) this.#accepted++;
    else this.#rejected++;
    return accepted;
  }

  #reject(): false {
    this.#rejected++;
    return false;
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    this.#eventsSeen++;
    this.#pressed.add(event.code);
    this.#justPressed.add(event.code);
    this.#updateAxes();
  };

  readonly #onKeyUp = (event: KeyboardEvent): void => {
    this.#eventsSeen++;
    this.#pressed.delete(event.code);
    this.#justReleased.add(event.code);
    this.#updateAxes();
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    this.#eventsSeen++;
    this.#pointerX = event.clientX;
    this.#pointerY = event.clientY;
  };

  readonly #onPointerDown = (event: PointerEvent): void => {
    this.#eventsSeen++;
    this.#pressed.add(`pointer:${event.button}`);
    this.#justPressed.add(`pointer:${event.button}`);
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    this.#eventsSeen++;
    this.#pressed.delete(`pointer:${event.button}`);
    this.#justReleased.add(`pointer:${event.button}`);
  };

  readonly #onBlur = (): void => {
    for (const key of this.#pressed) this.#justReleased.add(key);
    this.#pressed.clear();
    this.#axisX = 0;
    this.#axisY = 0;
  };

  #updateAxes(): void {
    const left = this.#pressed.has('KeyA') || this.#pressed.has('ArrowLeft');
    const right = this.#pressed.has('KeyD') || this.#pressed.has('ArrowRight');
    const forward = this.#pressed.has('KeyW') || this.#pressed.has('ArrowUp');
    const back = this.#pressed.has('KeyS') || this.#pressed.has('ArrowDown');
    this.#axisX = Number(right) - Number(left);
    this.#axisY = Number(back) - Number(forward);
  }
}
