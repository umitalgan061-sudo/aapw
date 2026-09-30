/** Strict TypeScript owner for the accessible 3D controls reference UI. */
let controlsHelpInstanceCounter = 0;

type ControlsEntry = readonly [key: string, description: string];

const DESKTOP_CONTROLS: readonly ControlsEntry[] = Object.freeze([
  ['WASD / Oklar', 'Yürü'],
  ['Shift', 'Koş'],
  ['Space', 'Zıpla'],
  ['E', 'Yakındaki kişiyle konuş'],
  ['Fare', 'Kamerayı döndür ve yakınlaştır'],
]);

const TOUCH_CONTROLS: readonly ControlsEntry[] = Object.freeze([
  ['Sol çubuk', 'Yürü; dış halkaya iterek koş'],
  ['Zıpla', 'Sağdaki Zıpla düğmesine dokun'],
  ['Selamla', 'Yakındaki etkileşim istemine dokun'],
  ['Diyalog', 'Bir yanıta dokun veya kapat'],
  ['Sürükle', 'Kamerayı döndür'],
  ['İki parmak', 'Kamerayı yakınlaştır'],
]);

export interface ControlsHelpOptions {
  readonly container?: HTMLElement;
  readonly isMobileClass?: boolean;
}

export class ControlsHelp {
  private _open = false;
  private readonly _root: HTMLDivElement;
  private readonly _button: HTMLButtonElement;
  private readonly _panel: HTMLElement;
  private readonly _onButtonClick: () => void;
  private readonly _onKeyDown: (event: KeyboardEvent) => void;

  constructor({
    container = document.body,
    isMobileClass = false,
  }: ControlsHelpOptions = {}) {
    this._root = document.createElement('div');
    this._root.className = 'g3d-controls-help';

    this._button = document.createElement('button');
    this._button.type = 'button';
    this._button.className = 'g3d-controls-help-button';
    this._button.textContent = '?';
    this._button.setAttribute('aria-label', 'Kontrolleri göster');
    this._button.setAttribute('aria-expanded', 'false');

    this._panel = document.createElement('section');
    this._panel.id = `g3d-controls-help-panel-${++controlsHelpInstanceCounter}`;
    this._button.setAttribute('aria-controls', this._panel.id);
    this._panel.className = 'g3d-controls-help-panel';
    this._panel.hidden = true;
    this._panel.setAttribute('aria-label', 'Oyun kontrolleri');

    const title = document.createElement('h2');
    title.textContent = isMobileClass ? 'Dokunmatik Kontroller' : 'Masaüstü Kontrolleri';
    this._panel.appendChild(title);

    const list = document.createElement('dl');
    const entries = isMobileClass ? TOUCH_CONTROLS : DESKTOP_CONTROLS;
    for (const [input, action] of entries) {
      const term = document.createElement('dt');
      term.textContent = input;
      const description = document.createElement('dd');
      description.textContent = action;
      list.append(term, description);
    }
    this._panel.appendChild(list);

    this._onButtonClick = () => this.setOpen(!this._open);
    this._onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' || !this._open) return;
      this.setOpen(false);
      event.stopImmediatePropagation();
    };

    this._button.addEventListener('click', this._onButtonClick);
    window.addEventListener('keydown', this._onKeyDown);
    this._root.append(this._panel, this._button);
    container.appendChild(this._root);
  }

  setOpen(open: boolean): void {
    if (this._open === open) return;
    this._open = open;
    this._panel.hidden = !open;
    this._button.setAttribute('aria-expanded', String(open));
    this._button.setAttribute('aria-label', open ? 'Kontrolleri gizle' : 'Kontrolleri göster');
  }

  get isOpen(): boolean {
    return this._open;
  }

  dispose(): void {
    this._button.removeEventListener('click', this._onButtonClick);
    window.removeEventListener('keydown', this._onKeyDown);
    this._root.remove();
  }
}
