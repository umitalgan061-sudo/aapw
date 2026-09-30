import {
  R27Runtime,
  type R27FrameResult,
  type R27RuntimeConfig,
} from '../r27/runtime.ts';
import type {
  InputFrame,
  RuntimeEvent,
  RuntimeSnapshot,
} from '../r27/contracts.ts';
import { RuntimeSecurityBoundary } from '../r27/security.ts';

export interface SessionState {
  readonly connected: boolean;
  readonly sessionId: string | null;
  readonly tick: number;
  readonly lastServerTick: number;
  readonly inputSequence: number;
  readonly pendingInputs: number;
  readonly droppedEvents: number;
  readonly lastSnapshotChecksum: string | null;
  readonly error: string | null;
}

export interface SessionTransport {
  connect(sessionId?: string): Promise<{ readonly sessionId: string }>;
  sendInput(input: InputFrame, sequence: number): Promise<void> | void;
  requestSnapshot?(tick: number): Promise<RuntimeSnapshot | null>;
  onSnapshot?(handler: (snapshot: RuntimeSnapshot) => void): () => void;
  onEvent?(handler: (event: RuntimeEvent) => void): () => void;
  onClose?(handler: (reason?: string) => void): () => void;
  close?(reason?: string): Promise<void> | void;
}

export interface RuntimeSessionOptions extends Partial<R27RuntimeConfig> {
  readonly maxPendingInputs: number;
  readonly maxEventsPerFrame: number;
}

export class RuntimeSession {
  readonly runtime: R27Runtime;
  readonly security: RuntimeSecurityBoundary;
  readonly options: RuntimeSessionOptions;

  #transport: SessionTransport | null = null;
  #sessionId: string | null = null;
  #connected = false;
  #inputSequence = 0;
  #lastServerTick = 0;
  #pendingInputs = 0;
  #droppedEvents = 0;
  #lastSnapshotChecksum: string | null = null;
  #error: string | null = null;
  #unsubscribe: Array<() => void> = [];

  constructor(options: RuntimeSessionOptions = {}) {
    this.options = Object.freeze({
      maxPendingInputs: Math.max(1, Math.floor(options.maxPendingInputs ?? 256)),
      maxEventsPerFrame: Math.max(1, Math.floor(options.maxEventsPerFrame ?? 256)),
      tickRate: Math.max(1, options.tickRate ?? 60),
      maxStepsPerFrame: Math.max(1, Math.floor(options.maxStepsPerFrame ?? 5)),
      budget: options.budget ?? {},
      qualityLevel: options.qualityLevel ?? 2,
    });
    this.runtime = new R27Runtime(this.options);
    this.security = new RuntimeSecurityBoundary();
  }

  async connect(transport: SessionTransport, sessionId?: string): Promise<SessionState> {
    this.disconnect();
    this.#transport = transport;
    try {
      const result = await transport.connect(sessionId);
      this.#sessionId = result.sessionId;
      this.#connected = true;
      this.#error = null;
      this.#unsubscribe.push(
        ...(transport.onSnapshot ? [transport.onSnapshot((snapshot) => this.receiveSnapshot(snapshot))] : []),
        ...(transport.onEvent ? [transport.onEvent((event) => this.receiveEvent(event))] : []),
        ...(transport.onClose ? [transport.onClose((reason) => this.#handleClose(reason))] : []),
      );
    } catch (error) {
      this.#connected = false;
      this.#sessionId = null;
      this.#error = error instanceof Error ? error.message : String(error);
    }
    return this.state();
  }

  disconnect(reason = 'client-disconnect'): void {
    for (const remove of this.#unsubscribe.splice(0)) remove();
    const transport = this.#transport;
    this.#transport = null;
    this.#connected = false;
    this.#sessionId = null;
    if (transport?.close) void Promise.resolve(transport.close(reason)).catch(() => undefined);
  }

  sendInput(input: InputFrame): boolean {
    if (!this.#connected || !this.#transport || this.#pendingInputs >= this.options.maxPendingInputs) return false;
    const verdict = this.security.validateInput(input);
    const sanitized = verdict.sanitizedInput;
    if (!sanitized || !verdict.accepted) {
      this.#error = 'input-rejected:' + verdict.violations.join(',');
      return false;
    }

    this.#inputSequence = (this.#inputSequence + 1) >>> 0;
    this.#pendingInputs++;
    try {
      void Promise.resolve(this.#transport.sendInput(sanitized, this.#inputSequence))
        .catch((error) => {
          this.#error = error instanceof Error ? error.message : String(error);
        })
        .finally(() => {
          this.#pendingInputs = Math.max(0, this.#pendingInputs - 1);
        });
      this.runtime.setInput(sanitized);
      return true;
    } catch (error) {
      this.#pendingInputs = Math.max(0, this.#pendingInputs - 1);
      this.#error = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  step(deltaSeconds: number): R27FrameResult {
    const result = this.runtime.runFrame(deltaSeconds);
    return result;
  }

  receiveSnapshot(snapshot: RuntimeSnapshot): void {
    if (!Number.isInteger(snapshot.tick) || snapshot.tick < this.#lastServerTick) {
      this.#error = 'stale-snapshot';
      return;
    }
    this.#lastServerTick = snapshot.tick;
    this.#lastSnapshotChecksum = snapshot.checksum;
    this.#pendingInputs = Math.max(0, this.#pendingInputs - 1);
    this.runtime.snapshots.push({
      sequence: { value: snapshot.tick >>> 0 },
      acknowledgedInput: this.#inputSequence,
      serverTick: snapshot.tick,
      sentAtTick: this.runtime.currentTick(),
      state: snapshot,
    });
  }

  receiveEvent(event: RuntimeEvent): void {
    const accepted = this.security.budgetEvents([event]);
    if (accepted.dropped > 0) {
      this.#droppedEvents += accepted.dropped;
      return;
    }
    for (const item of accepted.accepted) this.runtime.addEvent(item);
  }

  sampleServerState(renderTick: number): RuntimeSnapshot | undefined {
    return this.runtime.snapshots.sample(renderTick);
  }

  state(): SessionState {
    return Object.freeze({
      connected: this.#connected,
      sessionId: this.#sessionId,
      tick: this.runtime.currentTick(),
      lastServerTick: this.#lastServerTick,
      inputSequence: this.#inputSequence,
      pendingInputs: this.#pendingInputs,
      droppedEvents: this.#droppedEvents,
      lastSnapshotChecksum: this.#lastSnapshotChecksum,
      error: this.#error,
    });
  }

  #handleClose(reason?: string): void {
    this.#connected = false;
    this.#error = reason ?? null;
  }
}

export class LocalLoopbackTransport implements SessionTransport {
  #listeners = new Set<(snapshot: RuntimeSnapshot) => void>();
  #eventListeners = new Set<(event: RuntimeEvent) => void>();
  #closeListeners = new Set<(reason?: string) => void>();
  #connected = false;
  #sessionId = '';

  async connect(sessionId = 'local-loopback'): Promise<{ readonly sessionId: string }> {
    this.#connected = true;
    this.#sessionId = sessionId;
    return { sessionId };
  }

  sendInput(): void {
    if (!this.#connected) throw new Error('Loopback transport is not connected');
  }

  requestSnapshot(): Promise<RuntimeSnapshot | null> {
    return Promise.resolve(null);
  }

  onSnapshot(handler: (snapshot: RuntimeSnapshot) => void): () => void {
    this.#listeners.add(handler);
    return () => this.#listeners.delete(handler);
  }

  onEvent(handler: (event: RuntimeEvent) => void): () => void {
    this.#eventListeners.add(handler);
    return () => this.#eventListeners.delete(handler);
  }

  onClose(handler: (reason?: string) => void): () => void {
    this.#closeListeners.add(handler);
    return () => this.#closeListeners.delete(handler);
  }

  close(reason = 'loopback-close'): void {
    if (!this.#connected) return;
    this.#connected = false;
    for (const listener of this.#closeListeners) listener(reason);
  }

  emitSnapshot(snapshot: RuntimeSnapshot): void {
    for (const listener of this.#listeners) listener(snapshot);
  }

  emitEvent(event: RuntimeEvent): void {
    for (const listener of this.#eventListeners) listener(event);
  }

  get sessionId(): string {
    return this.#sessionId;
  }
}
