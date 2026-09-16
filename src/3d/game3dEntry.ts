import { createModernEngineFacade, type ModernEngineFacade } from '../engine-ts/index.js';
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
  readonly backend: ModernEngineFacade['backend'];
  readonly platform: ModernEngineFacade['platform'];
  readonly runtime: RuntimeFrameResult;
  readonly legacyLoaded: boolean;
}

interface EntryGateElements {
  readonly gate: HTMLElement;
  readonly enter: HTMLButtonElement;
  readonly back: HTMLButtonElement;
}

interface LegacyGame3DModule { initGame3D?: () => void | Promise<void>; }
interface LegacyEventsModule { gameEvents?: { on?: (event: string, handler: (payload: unknown) => void) => unknown }; EVENTS?: Record<string, string>; }

const DEFAULTS = Object.freeze({ canvasId: 'game3d-canvas', loadingId: 'game3d-loading', gateId: 'run266-entry-gate', enterId: 'run266-entry-enter', backId: 'run266-entry-back', moveCooldownMs: 70 });

export const bootstrapGame3D = async (options: Game3DEntryOptions = {}): Promise<EntryReadyReport | undefined> => {
  const loading = elementById(options.loadingId ?? DEFAULTS.loadingId);
  const facade = createModernEngineFacade();
  try {
    const canvas = elementById(options.canvasId ?? DEFAULTS.canvasId);
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('GAME3D_CANVAS_MISSING');
    const legacyLoaded = options.legacyLoader ? await options.legacyLoader() : await bootLegacyGame();
    const runtime = facade.runtime.advance({ deltaSeconds: 0 });
    const report: EntryReadyReport = Object.freeze({ backend: facade.backend, platform: facade.platform, runtime, legacyLoaded: Boolean(legacyLoaded) });
    loading?.classList.add('g3d-loading-hidden');
    document.dispatchEvent(new CustomEvent('aapw:game3d-ready', { detail: report }));
    options.onReady?.(report);
    return report;
  } catch (error) {
    facade.dispose();
    setLoadingError(loading, error);
    options.onError?.(error);
    return undefined;
  }
};

const bootLegacyGame = async (): Promise<boolean> => {
  const game = await import('./game3d.js') as unknown as LegacyGame3DModule;
  await game.initGame3D?.();
  bridgeLegacyGameEvents();
  return typeof game.initGame3D === 'function';
};

const bridgeLegacyGameEvents = async (): Promise<void> => {
  const eventModule = await import('./eventBus.js') as unknown as LegacyEventsModule;
  const events = eventModule.gameEvents;
  const names = eventModule.EVENTS ?? {};
  if (!events?.on) return;
  const readyName = names.GAME_READY;
  const errorName = names.GAME_ERROR;
  if (readyName) events.on(readyName, payload => document.dispatchEvent(new CustomEvent('aapw:legacy-ready', { detail: payload })));
  if (errorName) events.on(errorName, payload => document.dispatchEvent(new CustomEvent('aapw:legacy-error', { detail: payload })));
};

export const installGame3DEntryGate = (): (() => void) => {
  const elements = resolveGate();
  if (!elements) return () => undefined;
  const removers: Array<() => void> = [];
  let disposed = false;
  let lastMoveAt = -Infinity;
  const on = <T extends Event>(target: EventTarget, type: string, handler: (event: T) => void, options?: AddEventListenerOptions): void => { target.addEventListener(type, handler as EventListener, options); removers.push(() => target.removeEventListener(type, handler as EventListener, options)); };
  const dispose = (): void => { if (disposed) return; disposed = true; for (const remove of removers.splice(0).reverse()) remove(); document.documentElement.classList.remove('run266-entry-gate-open'); };
  const moveAway = (clientX: number, clientY: number): void => {
    const now = performance.now();
    if (now - lastMoveAt < DEFAULTS.moveCooldownMs) return;
    lastMoveAt = now;
    const back = elements.back.getBoundingClientRect();
    const enter = elements.enter.getBoundingClientRect();
    const halfW = Math.max(56, back.width / 2);
    const halfH = Math.max(28, back.height / 2);
    const candidates = [[0.12, 0.20], [0.12, 0.50], [0.12, 0.80], [0.31, 0.17], [0.34, 0.83], [0.46, 0.32], [0.45, 0.68], [0.27, 0.36], [0.27, 0.64], [0.19, 0.92]] as const;
    const center = (rect: DOMRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const pointer = { x: clientX, y: clientY }; const enterCenter = center(enter); const current = center(back);
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
    const ranked = candidates.map(([xRatio, yRatio], index) => { const x = Math.min(window.innerWidth - halfW - 14, Math.max(halfW + 14, window.innerWidth * xRatio)); const y = Math.min(window.innerHeight - halfH - 14, Math.max(halfH + 14, window.innerHeight * yRatio)); return { x, y, index, score: distance({ x, y }, pointer) + distance({ x, y }, enterCenter) * 0.35, enter: distance({ x, y }, enterCenter), current: distance({ x, y }, current) }; }).filter(item => item.enter > 140 && item.current > 64).sort((a, b) => b.score - a.score || a.index - b.index);
    const next = ranked[0] ?? { x: window.innerWidth * 0.12, y: window.innerHeight * 0.18 };
    elements.back.style.left = `${next.x}px`; elements.back.style.top = `${next.y}px`; elements.back.style.right = 'auto'; elements.back.style.transform = 'translate(-50%, -50%)';
    elements.back.dataset.moves = String(Number(elements.back.dataset.moves ?? '0') + 1);
  };
  const reject = (event: Event): void => { event.preventDefault(); event.stopPropagation(); const candidate = event as PointerEvent; moveAway(Number.isFinite(candidate.clientX) ? candidate.clientX : window.innerWidth / 2, Number.isFinite(candidate.clientY) ? candidate.clientY : window.innerHeight / 2); };
  const enter = (event: Event): void => { event.preventDefault(); elements.gate.hidden = true; elements.gate.remove(); dispose(); };
  on(elements.gate, 'pointermove', (event: PointerEvent) => { if (event.pointerType === 'touch' || event.pointerType === 'pen') return; const rect = elements.back.getBoundingClientRect(); const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; if (Math.hypot(center.x - event.clientX, center.y - event.clientY) <= 180) moveAway(event.clientX, event.clientY); }, { passive: true });
  on(elements.back, 'pointerdown', reject, { passive: false }); on(elements.back, 'click', reject, { passive: false }); on(elements.enter, 'click', enter, { passive: false }); on(window, 'pagehide', dispose, { once: true });
  document.documentElement.classList.add('run266-entry-gate-open');
  return dispose;
};

export const bootModernGame3D = async (options: Game3DEntryOptions = {}): Promise<EntryReadyReport | undefined> => bootstrapGame3D(options);
export const wireLegacyReadyEvents = (eventTarget: EventTarget = document): (() => void) => { const ready = (event: Event): void => { const detail = (event as CustomEvent<EntryReadyReport>).detail; if (detail) console.debug('[aapw] typed game3d ready', detail.backend); }; eventTarget.addEventListener('aapw:game3d-ready', ready as EventListener); return () => eventTarget.removeEventListener('aapw:game3d-ready', ready as EventListener); };

const resolveGate = (): EntryGateElements | undefined => { const gate = document.getElementById(DEFAULTS.gateId); const enter = document.getElementById(DEFAULTS.enterId); const back = document.getElementById(DEFAULTS.backId); if (!(gate instanceof HTMLElement) || !(enter instanceof HTMLButtonElement) || !(back instanceof HTMLButtonElement)) return undefined; return Object.freeze({ gate, enter, back }); };
const elementById = (id: string): HTMLElement | undefined => { const element = document.getElementById(id); return element instanceof HTMLElement ? element : undefined; };
const setLoadingError = (loading: HTMLElement | undefined, error: unknown): void => { if (!loading) return; loading.textContent = 'Bir şeyler ters gitti: 3D dünya başlatılamadı. Sayfayı yenilemeyi deneyin.'; loading.classList.remove('g3d-loading-hidden'); loading.classList.add('g3d-loading-error'); console.error('[aapw/game3d]', error); };
export const ENTRY_EVENT = EVENT_NAME('aapw:game3d-ready');
