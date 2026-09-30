export interface ServiceWorkerMessageR31 {
  readonly type: 'prefetch' | 'purge' | 'health' | 'version';
  readonly id: string;
  readonly payload: unknown;
}

export interface ServiceWorkerBridgeDiagnosticsR31 {
  readonly supported: boolean;
  readonly messagesSent: number;
  readonly messagesReceived: number;
  readonly failures: number;
  readonly pending: number;
}

export class ServiceWorkerBridgeR31 {
  readonly #pending = new Map<string, (value: unknown) => void>();
  #sent = 0;
  #received = 0;
  #failures = 0;

  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  }

  async request(message: ServiceWorkerMessageR31, timeoutMs = 2500): Promise<unknown> {
    if (!this.supported) throw new Error('service-worker-unsupported');
    const registration = await navigator.serviceWorker.ready;
    const controller = registration.active;
    if (!controller) throw new Error('service-worker-inactive');

    return await new Promise<unknown>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        this.#pending.delete(message.id);
        this.#failures++;
        reject(new Error('service-worker-timeout'));
      }, Math.max(50, timeoutMs));

      this.#pending.set(message.id, (payload) => {
        globalThis.clearTimeout(timer);
        resolve(payload);
      });
      try {
        controller.postMessage(message);
        this.#sent++;
      } catch (error) {
        globalThis.clearTimeout(timer);
        this.#pending.delete(message.id);
        this.#failures++;
        reject(error);
      }
    });
  }

  acceptResponse(id: string, payload: unknown): boolean {
    const resolver = this.#pending.get(id);
    if (!resolver) return false;
    this.#pending.delete(id);
    this.#received++;
    resolver(payload);
    return true;
  }

  diagnostics(): ServiceWorkerBridgeDiagnosticsR31 {
    return Object.freeze({
      supported: this.supported,
      messagesSent: this.#sent,
      messagesReceived: this.#received,
      failures: this.#failures,
      pending: this.#pending.size,
    });
  }

  rejectAll(): void {
    this.#pending.clear();
  }
}
