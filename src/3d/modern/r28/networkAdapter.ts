import type { InputFrame, RuntimeEvent, RuntimeSnapshot } from '../r27/contracts.ts';
import type { SessionTransport } from './session.ts';

export interface WebSocketTransportOptions {
  readonly url: string;
  readonly protocols?: readonly string[];
  readonly connectTimeoutMs: number;
  readonly maxMessageBytes: number;
  readonly reconnect: boolean;
  readonly reconnectDelayMs: number;
}

type SocketMessage =
  | { readonly type: 'snapshot'; readonly snapshot: RuntimeSnapshot }
  | { readonly type: 'event'; readonly event: RuntimeEvent }
  | { readonly type: 'ping'; readonly tick: number };

function parseMessage(raw: string): SocketMessage | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    if (record.type === 'snapshot' && record.snapshot && typeof record.snapshot === 'object') {
      return { type: 'snapshot', snapshot: record.snapshot as RuntimeSnapshot };
    }
    if (record.type === 'event' && record.event && typeof record.event === 'object') {
      return { type: 'event', event: record.event as RuntimeEvent };
    }
    if (record.type === 'ping' && typeof record.tick === 'number') {
      return { type: 'ping', tick: record.tick };
    }
    return null;
  } catch {
    return null;
  }
}

export class WebSocketRuntimeTransport implements SessionTransport {
  readonly options: WebSocketTransportOptions;
  #socket: WebSocket | null = null;
  #sessionId = '';
  #snapshotListeners = new Set<(snapshot: RuntimeSnapshot) => void>();
  #eventListeners = new Set<(event: RuntimeEvent) => void>();
  #closeListeners = new Set<(reason?: string) => void>();
  #closing = false;

  constructor(options: WebSocketTransportOptions) {
    const url = new URL(options.url, typeof window !== 'undefined' ? window.location.href : 'http://localhost/');
    if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('WebSocket transport requires ws: or wss:');
    this.options = Object.freeze({
      url: url.toString(),
      protocols: options.protocols ?? [],
      connectTimeoutMs: Math.max(250, Math.floor(options.connectTimeoutMs ?? 8_000)),
      maxMessageBytes: Math.max(1024, Math.floor(options.maxMessageBytes ?? 256 * 1024)),
      reconnect: options.reconnect ?? true,
      reconnectDelayMs: Math.max(100, Math.floor(options.reconnectDelayMs ?? 1_000)),
    });
  }

  connect(sessionId = ''): Promise<{ readonly sessionId: string }> {
    if (typeof WebSocket === 'undefined') return Promise.reject(new Error('WebSocket is unavailable'));
    this.#closing = false;

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.options.url, this.options.protocols);
      this.#socket = socket;
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new Error('WebSocket connection timed out'));
      }, this.options.connectTimeoutMs);

      socket.binaryType = 'arraybuffer';
      socket.addEventListener('open', () => {
        if (settled) clearTimeout(timeout);
        this.#sessionId = sessionId || 'ws-' + Date.now().toString(36);
        this.#sendRaw({ type: 'hello', sessionId: this.#sessionId });
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve({ sessionId: this.#sessionId });
        }
      });

      socket.addEventListener('message', (event) => this.#handleMessage(event.data));
      socket.addEventListener('error', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error('WebSocket connection failed'));
        }
      });
      socket.addEventListener('close', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error('WebSocket closed before connection completed'));
        }
        this.#socket = null;
        for (const listener of this.#closeListeners) listener('websocket-close');
      });
    });
  }

  sendInput(input: InputFrame, sequence: number): void {
    this.#sendRaw({
      type: 'input',
      sequence,
      input,
    });
  }

  onSnapshot(handler: (snapshot: RuntimeSnapshot) => void): () => void {
    this.#snapshotListeners.add(handler);
    return () => this.#snapshotListeners.delete(handler);
  }

  onEvent(handler: (event: RuntimeEvent) => void): () => void {
    this.#eventListeners.add(handler);
    return () => this.#eventListeners.delete(handler);
  }

  onClose(handler: (reason?: string) => void): () => void {
    this.#closeListeners.add(handler);
    return () => this.#closeListeners.delete(handler);
  }

  close(reason = 'client-close'): void {
    this.#closing = true;
    this.#socket?.close(1000, reason.slice(0, 120));
    this.#socket = null;
  }

  isOpen(): boolean {
    return this.#socket?.readyState === WebSocket.OPEN;
  }

  #sendRaw(value: unknown): void {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not open');
    const encoded = JSON.stringify(value);
    if (new TextEncoder().encode(encoded).byteLength > this.options.maxMessageBytes) {
      throw new Error('WebSocket payload exceeds configured budget');
    }
    this.#socket.send(encoded);
  }

  #handleMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    const bytes = new TextEncoder().encode(data).byteLength;
    if (bytes > this.options.maxMessageBytes) return;
    const message = parseMessage(data);
    if (!message) return;
    if (message.type === 'snapshot') {
      for (const listener of this.#snapshotListeners) listener(message.snapshot);
    } else if (message.type === 'event') {
      for (const listener of this.#eventListeners) listener(message.event);
    } else if (message.type === 'ping') {
      this.#sendRaw({ type: 'pong', tick: message.tick });
    }
  }
}
