import { platformEvents } from './eventBus';

export interface EntryGateOptions {
  readonly gateId?: string;
  readonly enterId?: string;
  readonly backId?: string;
  readonly moveCooldownMs?: number;
  readonly proximityPx?: number;
}

export interface EntryGateSnapshot {
  readonly open: boolean;
  readonly moves: number;
  readonly installedAt: number;
}

export interface EntryGateController {
  readonly snapshot: () => EntryGateSnapshot;
  readonly moveAway: (x: number, y: number) => void;
  readonly dispose: () => void;
}

const DEFAULTS = Object.freeze({ gateId: 'run266-entry-gate', enterId: 'run266-entry-enter', backId: 'run266-entry-back', moveCooldownMs: 70, proximityPx: 180 });

export function installEntryGate(options: EntryGateOptions = {}): EntryGateController | undefined {
  if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
  const gate = document.getElementById(options.gateId ?? DEFAULTS.gateId);
  const enter = document.getElementById(options.enterId ?? DEFAULTS.enterId);
  const back = document.getElementById(options.backId ?? DEFAULTS.backId);
  if (!(gate instanceof HTMLElement) || !(enter instanceof HTMLButtonElement) || !(back instanceof HTMLButtonElement)) return undefined;

  const cooldown = Math.max(16, Math.trunc(options.moveCooldownMs ?? DEFAULTS.moveCooldownMs));
  const proximity = Math.max(64, Math.trunc(options.proximityPx ?? DEFAULTS.proximityPx));
  const removers: Array<() => void> = [];
  let disposed = false;
  let moves = Number(back.dataset.run266Moves ?? '0') || 0;
  let lastMoveAt = -Infinity;
  const installedAt = Date.now();

  document.documentElement.classList.add('run266-entry-gate-open');

  const on = <T extends Event>(target: EventTarget, type: string, listener: (event: T) => void, listenerOptions?: AddEventListenerOptions): void => {
    target.addEventListener(type, listener as EventListener, listenerOptions);
    removers.push(() => target.removeEventListener(type, listener as EventListener, listenerOptions));
  };

  const center = (rect: DOMRect): readonly [number, number] => [rect.left + rect.width / 2, rect.top + rect.height / 2];
  const distanceSq = (ax: number, ay: number, bx: number, by: number): number => {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  };
  const candidates = Object.freeze([
    [0.12, 0.20], [0.13, 0.50], [0.12, 0.80], [0.31, 0.17], [0.34, 0.83],
    [0.46, 0.32], [0.45, 0.68], [0.27, 0.36], [0.27, 0.64], [0.19, 0.92],
  ] as const);

  const moveAway = (pointerX: number, pointerY: number): void => {
    if (disposed) return;
    const now = performance.now();
    if (now - lastMoveAt < cooldown) return;
    lastMoveAt = now;
    const rect = back.getBoundingClientRect();
    const enterRect = enter.getBoundingClientRect();
    const [currentX, currentY] = center(rect);
    const [enterX, enterY] = center(enterRect);
    const halfW = Math.max(56, rect.width / 2);
    const halfH = Math.max(28, rect.height / 2);
    const margin = 14;
    const ranked = candidates.map(([ratioX, ratioY], index) => {
      const x = Math.min(window.innerWidth - halfW - margin, Math.max(halfW + margin, window.innerWidth * ratioX));
      const y = Math.min(window.innerHeight - halfH - margin, Math.max(halfH + margin, window.innerHeight * ratioY));
      const pointerScore = distanceSq(x, y, pointerX, pointerY);
      const enterScore = distanceSq(x, y, enterX, enterY);
      const currentScore = distanceSq(x, y, currentX, currentY);
      return { x, y, index, score: pointerScore + enterScore * 0.35, enterScore, currentScore };
    }).filter(item => item.enterScore > 140 * 140 && item.currentScore > 64 * 64)
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const next = ranked[0] ?? { x: window.innerWidth * 0.12, y: window.innerHeight * 0.18 };
    back.style.left = `${next.x}px`;
    back.style.top = `${next.y}px`;
    back.style.right = 'auto';
    back.style.transform = 'translate(-50%, -50%)';
    moves += 1;
    back.dataset.run266Moves = String(moves);
    platformEvents.emit('input:entry-gate', { action: 'repel', moves });
  };

  const rejectBack = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    const pointer = event as Partial<PointerEvent> & { touches?: TouchList; changedTouches?: TouchList };
    const touch = pointer.touches?.[0] ?? pointer.changedTouches?.[0];
    moveAway(Number(touch?.clientX ?? pointer.clientX ?? window.innerWidth / 2), Number(touch?.clientY ?? pointer.clientY ?? window.innerHeight / 2));
  };

  const repelFromPointer = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' || event.pointerType === 'pen') return;
    const rect = back.getBoundingClientRect();
    const [x, y] = center(rect);
    if (distanceSq(x, y, event.clientX, event.clientY) <= proximity * proximity) moveAway(event.clientX, event.clientY);
  };

  const enterWorld = (event: Event): void => {
    event.preventDefault();
    gate.hidden = true;
    gate.remove();
    dispose();
    platformEvents.emit('input:entry-gate', { action: 'enter', moves });
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const remove of removers.splice(0).reverse()) remove();
    document.documentElement.classList.remove('run266-entry-gate-open');
  };

  on(gate, 'pointermove', repelFromPointer, { passive: true });
  on(back, 'pointerdown', rejectBack, { passive: false });
  on(back, 'click', rejectBack, { passive: false });
  on(back, 'touchstart', rejectBack, { passive: false });
  on(enter, 'click', enterWorld, { passive: false });
  on(window, 'pagehide', dispose, { once: true });

  return Object.freeze({
    snapshot: () => Object.freeze({ open: !disposed && document.body.contains(gate) && !gate.hidden, moves, installedAt }),
    moveAway,
    dispose,
  });
}
