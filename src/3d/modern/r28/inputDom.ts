import { zeroInputFrame, type InputFrame } from '../r27/contracts.ts';

export interface DomInputConfig {
  readonly lookSensitivity: number;
  readonly deadzone: number;
  readonly maxButtons: number;
  readonly touchEnabled: boolean;
}

export class DomInputSampler {
  readonly config: DomInputConfig;
  #keys = new Set<string>();
  #buttons = new Set<string>();
  #analog = new Map<string, number>();
  #lookX = 0;
  #lookY = 0;
  #boundElement: HTMLElement | null = null;
  #listeners: Array<() => void> = [];

  constructor(config: Partial<DomInputConfig> = {}) {
    this.config = Object.freeze({
      lookSensitivity: Math.max(0.001, config.lookSensitivity ?? 0.0025),
      deadzone: Math.max(0, Math.min(0.95, config.deadzone ?? 0.1)),
      maxButtons: Math.max(1, Math.floor(config.maxButtons ?? 16)),
      touchEnabled: config.touchEnabled ?? true,
    });
  }

  bind(element: HTMLElement): void {
    this.dispose();
    this.#boundElement = element;

    const keydown = (event: KeyboardEvent): void => {
      this.#keys.add(event.code);
      if (this.#isGameKey(event.code)) event.preventDefault();
    };
    const keyup = (event: KeyboardEvent): void => this.#keys.delete(event.code);
    const blur = (): void => {
      this.#keys.clear();
      this.#buttons.clear();
      this.#analog.clear();
      this.#lookX = 0;
      this.#lookY = 0;
    };
    const pointermove = (event: PointerEvent): void => {
      if (document.pointerLockElement === element) {
        this.#lookX += event.movementX * this.config.lookSensitivity;
        this.#lookY += event.movementY * this.config.lookSensitivity;
      }
    };
    const pointerdown = (event: PointerEvent): void => {
      if (event.button === 0) this.#buttons.add('attack');
      if (event.button === 2) this.#buttons.add('block');
    };
    const pointerup = (event: PointerEvent): void => {
      if (event.button === 0) this.#buttons.delete('attack');
      if (event.button === 2) this.#buttons.delete('block');
    };
    const contextmenu = (event: Event): void => event.preventDefault();

    window.addEventListener('keydown', keydown, { passive: false });
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    window.addEventListener('pointermove', pointermove);
    element.addEventListener('pointerdown', pointerdown);
    window.addEventListener('pointerup', pointerup);
    element.addEventListener('contextmenu', contextmenu);

    this.#listeners.push(
      () => window.removeEventListener('keydown', keydown),
      () => window.removeEventListener('keyup', keyup),
      () => window.removeEventListener('blur', blur),
      () => window.removeEventListener('pointermove', pointermove),
      () => element.removeEventListener('pointerdown', pointerdown),
      () => window.removeEventListener('pointerup', pointerup),
      () => element.removeEventListener('contextmenu', contextmenu),
    );
  }

  sample(tick: number): InputFrame {
    const frame = zeroInputFrame(tick);
    const axis = (positive: string[], negative: string[]): number => {
      const value = positive.some((key) => this.#keys.has(key)) ? 1 : 0;
      const minus = negative.some((key) => this.#keys.has(key)) ? 1 : 0;
      const raw = value - minus;
      return Math.abs(raw) < this.config.deadzone ? 0 : raw;
    };
    const buttons = [...this.#buttons]
      .concat(this.#keys.has('Space') ? ['jump'] : [])
      .concat(this.#keys.has('ShiftLeft') || this.#keys.has('ShiftRight') ? ['sprint'] : [])
      .slice(0, this.config.maxButtons)
      .sort();
    const analog = Object.fromEntries([...this.#analog.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const result: InputFrame = {
      ...frame,
      move: {
        x: axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']),
        y: axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']),
      },
      look: {
        x: Math.max(-1, Math.min(1, this.#lookX)),
        y: Math.max(-1, Math.min(1, this.#lookY)),
      },
      buttons,
      analog,
    };
    this.#lookX = 0;
    this.#lookY = 0;
    return result;
  }

  setAnalog(name: string, value: number): void {
    if (!name || !Number.isFinite(value)) return;
    const normalized = Math.max(-1, Math.min(1, value));
    if (Math.abs(normalized) <= this.config.deadzone) {
      this.#analog.delete(name);
    } else {
      this.#analog.set(name.slice(0, 32), normalized);
    }
  }

  requestPointerLock(): Promise<void> {
    const element = this.#boundElement;
    if (!element || typeof element.requestPointerLock !== 'function') return Promise.resolve();
    const result = element.requestPointerLock();
    return result instanceof Promise ? result : Promise.resolve();
  }

  dispose(): void {
    for (const remove of this.#listeners.splice(0)) remove();
    this.#boundElement = null;
    this.#keys.clear();
    this.#buttons.clear();
    this.#analog.clear();
  }

  #isGameKey(code: string): boolean {
    return code.startsWith('Key') || code.startsWith('Arrow') || code === 'Space' || code.includes('Shift');
  }
}
