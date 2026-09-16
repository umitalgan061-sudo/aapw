import { createModernEngineFacade } from '../engine-ts/index.js';
import type { RuntimeFrameResult } from '../engine-ts/runtime.js';
import { EVENT_NAME } from '../engine-ts/types.js';

export interface Game3DEntryOptions {
  readonly canvasId?: string;
  readonly loadingId?: string;
  readonly legacyLoader?: () => unknown | Promise<unknown>;
  readonly onReady?: (result: EntryReadyReport) => void;
  readonly onError?: (error: unknown) => void;
}

export interface EntryReadyReport {
  readonly backend: string;
  readonly platform: ReturnType<ReturnType<typeof createModernEngineFacade>['platform']>;
  readonly runtime: RuntimeFrameResult;
  readonly legacyLoaded: boolean;
}

interface EntryGateElements {
  readonly gate: HTMLElement;
  readonly enter: HTMLButtonElement;
  readonly back: HTMLButtonElement;
}

const DEFAULTS = Object.freeze({
  canvasId: 'game3d-canvas',
  loadingId: 'game3d-loading',
  gateId: 'run266-entry-gate',
  enterId: 'run266-entry-enter',
  backId: 'run266-entry-back',
  moveCooldownMs: 70,
});

export const bootstrapGame3D = async (options: Game3DEntryOptions = {}): Promise<EntryReadyReport | undefined> => {
  const loading = elementById(options.loadingId ?? DEFAULTS.loadingId);
  try {
    const canvas = elementById(options.canvasId ?? DEFAULTS.canvasId);
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('GAME3D_CANVAS_MISSING');
    const facade = createModernEngineFacade();
    const legacyLoaded = options.legacyLoader ? await options.legacyLoader() : false;
    const runtime = facade.runtime.advance({ deltaSeconds: 0 });
    const report: EntryReadyReport = Object.freeze({ backend: String(facade.backend), platform: facade.platform, runtime, legacyLoaded: Boolean(legacyLoaded) });
    loading?.classList.add('g3d-loading-hidden');
    document.dispatchEvent(new CustomEvent('aapw:game3d-ready', { detail: report }));
    options.onReady?.(report);
    return report;
  } catch (error) {
    setLoadingError(loading, error);
    options.onError?.(error);
    return undefined;
  }
};

export const installGame3DEntryGate = (): (() => void) => {
  const elements = resolveGate();
  if (!elements) return () => undefined;
  const removers: Array<() => void> = [];
  let disposed = false;
  let lastMoveAt = -Infinity;

  const on = <T extends Event>(target: EventTarget, type: string, handler: (event: T) => void, options?: AddEventListenerOptions): void => {
    target.addEventListener(type, handler as EventListener, options);
    removers.push(() => target.removeEventListener(type, handler as EventListener, options));
  };

  const moveAway = (clientX: number, clientY: number): void => {
    const now = performance.now();
    if (now - lastMoveAt < DEFAULTS.moveCooldownMs) return;
    lastMoveAt = now;
    const back = elements.back.getBoundingClientRect();
    const enter = elements.enter.getBoundingClientRect();
    const halfW = Math.max(56, back.width / 2);
    const halfH = Math.max(28, back.height / 2);
    const candidates = [
      [0.12, 0.20], [0.12, 0.50], [0.12, 0.80], [0.31, 0.17], [0.34, 0.83],
      [0.46, 0.32], [0.45, 0.68], [0.27, 0.36], [0.27, 0.64], [0.19, 0.92],
    ] as const;
    const center = (rect: DOMRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const pointer = { x: clientX, y: clientY };
    const enterCenter = center(enter);
    const current = center(back);
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number => {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      return dx * dx + dy * dy;
    };
    const ranked = candidates.map(([xRatio, yRatio], index) => {
      const x = Math.min(window.innerWidth - halfW - 14, Math.max(halfW + 14, window.innerWidth * xRatio));
      const y = Math.min(window.innerHeight - halfH - 14, Math.max(halfH + 14, window.innerHeight * yRatio));
      return { x, y, index, score: distance({ x, y }, pointer) + distance({ x, y }, enterCenter) * 0.35, enter: distance({ x, y }, enterCenter), current: distance({ x, y }, current) };
    }).filter(item => item.enter > 140 * 140 && item.current > 64 * 64)
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const next = ranked[0] ?? { x: window.innerWidth * 0.12, y: window.innerHeight * 0.18 };
    elements.back.style.left = `${next.x}px`;
    elements.back.style.top = `${next.y}px`;
    elements.back.style.right = 'auto';
    elements.back.style.transform = 'translate(-50%, -50%)';
    const count = Number(elements.back.dataset.moves ?? '0') + 1;
    elements.back.dataset.moves = String(count);
  };

  const reject = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    const candidate = event as PointerEvent;
    moveAway(Number.isFinite(candidate.clientX) ? candidate.clientX : window.innerWidth / 2, Number.isFinite(candidate.clientY) ? candidate.clientY : window.innerHeight / 2);
  };

  const enter = (event: Event): void => {
    event.preventDefault();
    elements.gate.hidden = true;
    elements.gate.remove();
    document.documentElement.classList.remove('run266-entry-gate-open');
    dispose();
  };

  on(elements.gate, 'pointermove', (event: PointerEvent) => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') {
      const rect = elements.back.getBoundingClientRect();
      const dx = rect.left + rect.width / 2 - event.clientX;
      const dy = rect.top + rect.height / 2 - event.clientY;
      if (dx * dx + dy * dy <= 180 * 180) moveAway(event.clientX, event.clientY);
    }
  }, { passive: true });
  on(elements.back, 'pointerdown', reject, { passive: false });
  on(elements.back, 'click', reject, { passive: false });
  on(elements.enter, 'click', enter, { passive: false });
  on(window, 'pagehide', dispose, { once: true });
  document.documentElement.classList.add('run266-entry-gate-open');

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const remove of removers.splice(0).reverse()) remove();
    document.documentElement.classList.remove('run266-entry-gate-open');
  };
  return dispose;
};

export const bootModernGame3D = async (options: Game3DEntryOptions = {}): Promise<EntryReadyReport | undefined> => bootstrapGame3D(options);

export const wireLegacyReadyEvents = (eventTarget: EventTarget = document): (() => void) => {
  const ready = (event: Event): void => { const detail = (event as CustomEvent<EntryReadyReport>).detail; if (detail) console.debug('[aapw] typed game3d ready', detail.backend); };
  eventTarget.addEventListener('aapw:game3d-ready', ready as EventListener);
  return () => eventTarget.removeEventListener('aapw:game3d-ready', ready as EventListener);
};

const resolveGate = (): EntryGateElements | undefined => {
  const gate = document.getElementById(DEFAULTS.gateId);
  const enter = document.getElementById(DEFAULTS.enterId);
  const back = document.getElementById(DEFAULTS.backId);
  if (!(gate instanceof HTMLElement) || !(enter instanceof HTMLButtonElement) || !(back instanceof HTMLButtonElement)) return undefined;
  return Object.freeze({ gate, enter, back });
};

const elementById = (id: string): HTMLElement | undefined => {
  const element = document.getElementById(id);
  return element instanceof HTMLElement ? element : undefined;
};

const setLoadingError = (loading: HTMLElement | undefined, error: unknown): void => {
  if (!loading) return;
  loading.textContent = 'Bir şeyler ters gitti: 3D dünya başlatılamadı. Sayfayı yenilemeyi deneyin.';
  loading.classList.remove('g3d-loading-hidden');
  loading.classList.add('g3d-loading-error');
  console.error('[aapw/game3d]', error);
};

export const ENTRY_EVENT = EVENT_NAME('aapw:game3d-ready');
