export interface ServiceWorkerRegistrationResult {
  readonly supported: boolean;
  readonly registered: boolean;
  readonly controlled: boolean;
  readonly registration?: ServiceWorkerRegistration;
  readonly reason?: string;
}

export interface ServiceWorkerClientOptions {
  readonly scriptUrl?: string;
  readonly scope?: string;
}

export class ServiceWorkerClient {
  readonly options: Required<ServiceWorkerClientOptions>;
  #registration: ServiceWorkerRegistration | null = null;

  constructor(options: ServiceWorkerClientOptions = {}) {
    this.options = {
      scriptUrl: options.scriptUrl ?? '/service-worker.js',
      scope: options.scope ?? '/',
    };
  }

  async register(): Promise<ServiceWorkerRegistrationResult> {
    if (!('serviceWorker' in navigator)) {
      return { supported: false, registered: false, controlled: false, reason: 'service-worker-unavailable' };
    }
    try {
      const registration = await navigator.serviceWorker.register(this.options.scriptUrl, { scope: this.options.scope });
      this.#registration = registration;
      return {
        supported: true,
        registered: true,
        controlled: Boolean(navigator.serviceWorker.controller),
        registration,
      };
    } catch (error) {
      return {
        supported: true,
        registered: false,
        controlled: Boolean(navigator.serviceWorker.controller),
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async update(): Promise<boolean> {
    if (!this.#registration) return false;
    await this.#registration.update();
    return true;
  }

  async clearCaches(): Promise<boolean> {
    if (!this.#registration?.active) return false;
    this.#registration.active.postMessage({ type: 'clear-aapw-caches' });
    return true;
  }

  registration(): ServiceWorkerRegistration | null {
    return this.#registration;
  }
}
