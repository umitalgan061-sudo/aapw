/** Strict TypeScript owner for the interaction prompt UI. */
export type InteractionActivateHandler = (() => void) | null;

export class InteractionPrompt {
  private readonly _el: HTMLDivElement;
  private _activateHandler: InteractionActivateHandler = null;
  private _visible = false;
  private readonly _onPointerUp: (event: PointerEvent) => void;
  private readonly _onKeyDown: (event: KeyboardEvent) => void;

  constructor(container: HTMLElement = document.body) {
    this._el = document.createElement('div');
    this._el.className = 'g3d-interaction-prompt';
    this._el.textContent = 'E - Selamla';
    this._el.hidden = true;
    this._el.setAttribute('role', 'status');
    this._el.setAttribute('aria-live', 'polite');
    this._el.setAttribute('aria-atomic', 'true');

    this._onPointerUp = (event) => {
      if (!this._activateHandler || !this._visible) return;
      event.preventDefault();
      this._activateHandler();
    };
    this._el.addEventListener('pointerup', this._onPointerUp);

    this._onKeyDown = (event) => {
      if (!this._activateHandler || !this._visible) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this._activateHandler();
    };
    this._el.addEventListener('keydown', this._onKeyDown);
    container.appendChild(this._el);
  }

  setVisible(visible: boolean): void {
    if (visible === this._visible) return;
    this._visible = visible;
    this._el.hidden = !visible;
  }

  setActivateHandler(handler: InteractionActivateHandler): void {
    this._activateHandler = handler;
    this._el.classList.toggle('g3d-interaction-prompt-action', Boolean(handler));
    this._el.setAttribute('role', handler ? 'button' : 'status');
    this._el.setAttribute('tabindex', handler ? '0' : '-1');
    this._el.setAttribute('aria-label', handler ? 'Selamla' : 'E - Selamla');
  }

  dispose(): void {
    this._el.removeEventListener('pointerup', this._onPointerUp);
    this._el.removeEventListener('keydown', this._onKeyDown);
    this._el.remove();
    this._visible = false;
    this._activateHandler = null;
  }
}
