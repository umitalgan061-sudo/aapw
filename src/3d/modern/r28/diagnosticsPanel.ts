export interface DiagnosticsView {
  readonly title: string;
  readonly values: Readonly<Record<string, string | number | boolean>>;
}

export class RuntimeDiagnosticsPanel {
  readonly container: HTMLElement;
  readonly element: HTMLDivElement;
  readonly values: HTMLDivElement;
  #lastRenderMs = 0;
  #visible = true;

  constructor(container: HTMLElement, title = 'AAPW Runtime') {
    this.container = container;
    this.element = document.createElement('div');
    this.values = document.createElement('div');
    this.element.setAttribute('data-aapw-runtime-diagnostics', 'true');
    this.element.style.cssText = 'position:fixed;top:8px;right:8px;z-index:99999;padding:8px 10px;font:12px/1.35 ui-monospace,SFMono-Regular,monospace;background:rgba(0,0,0,.65);color:#fff;border-radius:6px;min-width:180px;pointer-events:none;white-space:pre;';
    const heading = document.createElement('strong');
    heading.textContent = title;
    this.element.append(heading, document.createElement('br'), this.values);
    container.appendChild(this.element);
  }

  update(view: DiagnosticsView, nowMs = performance.now()): void {
    if (!this.#visible || nowMs - this.#lastRenderMs < 100) return;
    this.#lastRenderMs = nowMs;
    const lines = Object.entries(view.values)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => key + ': ' + String(value));
    this.values.textContent = lines.join('\\n');
  }

  setVisible(visible: boolean): void {
    this.#visible = visible;
    this.element.hidden = !visible;
  }

  dispose(): void {
    this.element.remove();
  }
}
