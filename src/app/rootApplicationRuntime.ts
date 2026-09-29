export type RootRuntimePhase = 'created' | 'running' | 'hidden' | 'offline' | 'disposed';

export interface RootRuntimeEvent {
  readonly name: string;
  readonly atMs: number;
  readonly phase: RootRuntimePhase;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface RootRuntimeSnapshot {
  readonly version: 1;
  readonly phase: RootRuntimePhase;
  readonly startedAt: number;
  readonly uptimeMs: number;
  readonly online: boolean;
  readonly visible: boolean;
  readonly eventCount: number;
  readonly marks: Readonly<Record<string, number>>;
}

export interface RootApplicationRuntime {
  readonly start(): void;
  readonly mark(name: string, detail?: Readonly<Record<string, unknown>>): number;
  readonly snapshot(): RootRuntimeSnapshot;
  readonly getEvents(): readonly RootRuntimeEvent[];
  readonly dispose(): void;
}

const EVENT_CAPACITY = 256;

export function createRootApplicationRuntime(): RootApplicationRuntime {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;
  const events: RootRuntimeEvent[] = [];
  const marks = new Map<string, number>();
  let phase: RootRuntimePhase = 'created';
  let online = typeof navigator === 'undefined' ? true : navigator.onLine;
  let visible = typeof document === 'undefined' ? true : !document.hidden;
  let started = false;
  let disposed = false;

  const now = () => (typeof performance !== 'undefined' ? performance.now() : startedAt);

  const push = (name: string, detail?: Readonly<Record<string, unknown>>) => {
    const event: RootRuntimeEvent = Object.freeze({
      name,
      atMs: Number(Math.max(0, now() - startedAt).toFixed(3)),
      phase,
      ...(detail ? { detail } : {}),
    });
    events.push(event);
    if (events.length > EVENT_CAPACITY) events.splice(0, events.length - EVENT_CAPACITY);
    return event.atMs;
  };

  const onVisibility = () => {
    visible = typeof document === 'undefined' ? true : !document.hidden;
    if (phase !== 'disposed') phase = visible ? (online ? 'running' : 'offline') : 'hidden';
    push(visible ? 'root:visible' : 'root:hidden');
  };

  const onOnline = () => {
    online = true;
    if (phase !== 'disposed') phase = visible ? 'running' : 'hidden';
    push('root:online');
  };

  const onOffline = () => {
    online = false;
    if (phase !== 'disposed') phase = visible ? 'offline' : 'hidden';
    push('root:offline');
  };

  const start = () => {
    if (started || disposed) return;
    started = true;
    phase = online ? (visible ? 'running' : 'hidden') : 'offline';
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility, { passive: true });
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline, { passive: true });
      window.addEventListener('offline', onOffline, { passive: true });
    }
    push('root:start');
  };

  const mark = (name: string, detail?: Readonly<Record<string, unknown>>) => {
    if (disposed) return 0;
    const atMs = push(name, detail);
    marks.set(name, atMs);
    return atMs;
  };

  const snapshot = (): RootRuntimeSnapshot => Object.freeze({
    version: 1,
    phase,
    startedAt,
    uptimeMs: Number(Math.max(0, now() - startedAt).toFixed(3)),
    online,
    visible,
    eventCount: events.length,
    marks: Object.freeze(Object.fromEntries(marks)),
  });

  const getEvents = () => Object.freeze(events.slice());

  const dispose = () => {
    if (disposed) return;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    }
    phase = 'disposed';
    disposed = true;
  };

  return Object.freeze({ start, mark, snapshot, getEvents, dispose });
}
