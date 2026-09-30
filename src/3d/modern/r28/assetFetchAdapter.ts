import type { AssetDefinition } from '../r27/contracts.ts';
import type { AssetLoader } from '../r27/assetPipeline.ts';

export interface FetchAssetLoaderOptions {
  readonly maxResponseBytes: number;
  readonly allowedProtocols?: readonly string[];
  readonly requestTimeoutMs: number;
}

export class FetchAssetLoader implements AssetLoader {
  readonly options: FetchAssetLoaderOptions;

  constructor(options: Partial<FetchAssetLoaderOptions> = {}) {
    this.options = Object.freeze({
      maxResponseBytes: Math.max(1024, Math.floor(options.maxResponseBytes ?? 16 * 1024 * 1024)),
      allowedProtocols: options.allowedProtocols ?? ['https:', 'http:'],
      requestTimeoutMs: Math.max(250, Math.floor(options.requestTimeoutMs ?? 15_000)),
    });
  }

  async load(definition: AssetDefinition, parentSignal: AbortSignal): Promise<number> {
    const url = new URL(definition.uri, typeof window !== 'undefined' ? window.location.href : 'http://localhost/');
    if (!this.options.allowedProtocols?.includes(url.protocol)) {
      throw new Error('Asset protocol is not allowed: ' + url.protocol);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('asset-timeout'), this.options.requestTimeoutMs);
    const abort = (): void => controller.abort(parentSignal.reason);
    parentSignal.addEventListener('abort', abort, { once: true });

    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'force-cache' });
      if (!response.ok) throw new Error('Asset request failed: ' + response.status);
      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > this.options.maxResponseBytes) throw new Error('Asset response exceeds configured size budget');

      const body = await response.arrayBuffer();
      if (body.byteLength > this.options.maxResponseBytes) throw new Error('Asset body exceeds configured size budget');

      const expectedType = definition.integrity?.contentType;
      const actualType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
      if (expectedType && actualType && expectedType !== actualType) {
        throw new Error('Asset content type mismatch');
      }

      return body.byteLength;
    } finally {
      clearTimeout(timeout);
      parentSignal.removeEventListener('abort', abort);
    }
  }

  async unload(): Promise<void> {
    // GPU/resource disposal is owned by the renderer-specific adapter after the fetch layer releases its byte payload.
  }
}
