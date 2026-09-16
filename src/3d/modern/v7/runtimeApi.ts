import { digest, type Disposable, type Tick, type V7Result } from './primitives.js';
import { AapwV7Integration } from './integrationRuntime.js';

export type RuntimeApiRequest =
  | { readonly method: 'health' }
  | { readonly method: 'snapshot' }
  | { readonly method: 'diagnostics' }
  | { readonly method: 'render'; readonly signals: Parameters<AapwV7Integration['runtime']['evaluateRender']>[0] }
  | { readonly method: 'input'; readonly input: Parameters<AapwV7Integration['runtime']['ingestInput']>[0] }
  | { readonly method: 'command'; readonly command: Parameters<AapwV7Integration['runtime']['enqueue']>[0] }
  | { readonly method: 'save'; readonly slot: string; readonly payload: unknown };
export interface RuntimeApiResponse<T = unknown> { readonly ok: boolean; readonly method: RuntimeApiRequest['method']; readonly value?: T; readonly code?: string; readonly message?: string; readonly tick: Tick; readonly digest: string; }
export interface RuntimeApiOptions { readonly maxRequestsPerTick?: number; readonly maxPayloadBytes?: number; }

export class RuntimeApiGateway implements Disposable {
  readonly runtime: AapwV7Integration;
  readonly maxRequestsPerTick: number;
  readonly maxPayloadBytes: number;
  #tick = -1;
  #requests = 0;
  #disposed = false;
  constructor(runtime: AapwV7Integration, options: RuntimeApiOptions = {}) { this.runtime = runtime; this.maxRequestsPerTick = Math.max(1, Math.min(1024, Math.trunc(options.maxRequestsPerTick ?? 32))); this.maxPayloadBytes = Math.max(1024, Math.min(1_048_576, Math.trunc(options.maxPayloadBytes ?? 65_536))); }
  async handle(request: RuntimeApiRequest, tick: Tick): Promise<RuntimeApiResponse> {
    if (this.#disposed) return this.fail(request.method, tick, 'API_DISPOSED', 'API gateway is disposed');
    if (Number(tick) !== this.#tick) { this.#tick = Number(tick); this.#requests = 0; }
    if (++this.#requests > this.maxRequestsPerTick) return this.fail(request.method, tick, 'API_RATE_LIMIT', 'Request budget exceeded');
    if (!this.#safeRequest(request)) return this.fail(request.method, tick, 'API_PAYLOAD', 'Request exceeds API payload limits');
    try {
      if (request.method === 'health') return this.ok(request.method, tick, this.runtime.health());
      if (request.method === 'snapshot') return this.ok(request.method, tick, this.runtime.runtime.snapshot());
      if (request.method === 'diagnostics') return this.ok(request.method, tick, this.runtime.diagnostics.inspect());
      if (request.method === 'render') return this.ok(request.method, tick, this.runtime.runtime.evaluateRender(request.signals));
      if (request.method === 'input') return this.ok(request.method, tick, this.runtime.runtime.ingestInput(request.input));
      if (request.method === 'command') return this.ok(request.method, tick, this.runtime.runtime.enqueue(request.command));
      if (request.method === 'save') return this.ok(request.method, tick, await this.runtime.runtime.save(request.slot, request.payload));
      return this.fail(request.method, tick, 'API_METHOD', 'Unknown runtime method');
    } catch (error) {
      return this.fail(request.method, tick, 'API_EXCEPTION', error instanceof Error ? error.message : String(error));
    }
  }
  dispose(): void { this.#disposed = true; this.#requests = 0; }
  #safeRequest(request: RuntimeApiRequest): boolean { try { return JSON.stringify(request).length <= this.maxPayloadBytes; } catch { return false; } }
  #ok(method: RuntimeApiRequest['method'], tick: Tick, value: unknown): RuntimeApiResponse { return Object.freeze({ ok: true, method, value, tick, digest: digest(method, tick, value) }); }
  #fail<T = unknown>(method: RuntimeApiRequest['method'], tick: Tick, code: string, message: string): RuntimeApiResponse<T> { return Object.freeze({ ok: false, method, code, message, tick, digest: digest(method, tick, code, message) }); }
  ok(method: RuntimeApiRequest['method'], tick: Tick, value: unknown): RuntimeApiResponse { return this.#ok(method, tick, value); }
  fail(method: RuntimeApiRequest['method'], tick: Tick, code: string, message: string): RuntimeApiResponse { return this.#fail(method, tick, code, message); }
}
