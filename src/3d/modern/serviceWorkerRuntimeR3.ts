export type CacheClassR3 = 'immutable' | 'runtime' | 'document' | 'api';

export interface CachePolicyR3 {
  readonly name: string;
  readonly maxEntries: number;
  readonly maxAgeMs: number;
  readonly staleWhileRevalidate: boolean;
}

export interface CacheDecisionR3 {
  readonly cache: CacheClassR3;
  readonly eligible: boolean;
  readonly reason: string;
}

export interface ServiceWorkerSnapshotR3 {
  readonly version: 3;
  readonly cacheNames: readonly string[];
  readonly precacheCount: number;
  readonly installGeneration: number;
  readonly fetches: number;
  readonly cacheHits: number;
  readonly networkFallbacks: number;
}

export const SERVICE_WORKER_VERSION_R3 = 'aapw-r3';

export const CACHE_POLICIES_R3: Readonly<Record<CacheClassR3, CachePolicyR3>> = {
  immutable: { name: `${SERVICE_WORKER_VERSION_R3}:immutable`, maxEntries: 4096, maxAgeMs: 365 * 24 * 60 * 60 * 1000, staleWhileRevalidate: false },
  runtime: { name: `${SERVICE_WORKER_VERSION_R3}:runtime`, maxEntries: 1024, maxAgeMs: 7 * 24 * 60 * 60 * 1000, staleWhileRevalidate: true },
  document: { name: `${SERVICE_WORKER_VERSION_R3}:document`, maxEntries: 64, maxAgeMs: 24 * 60 * 60 * 1000, staleWhileRevalidate: true },
  api: { name: `${SERVICE_WORKER_VERSION_R3}:api`, maxEntries: 256, maxAgeMs: 60 * 1000, staleWhileRevalidate: false },
};

const STATIC_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.css', '.wasm', '.glb', '.gltf', '.png', '.jpg', '.jpeg', '.webp', '.ktx2', '.woff2']);

function extension(url: URL): string {
  const pathname = url.pathname.toLowerCase();
  const dot = pathname.lastIndexOf('.');
  return dot >= 0 ? pathname.slice(dot) : '';
}

export function classifyRequest(request: Request): CacheDecisionR3 {
  const url = new URL(request.url);
  if (request.method !== 'GET') return { cache: 'api', eligible: false, reason: 'non-get request' };
  if (url.origin !== globalThis.location?.origin && url.origin !== 'null') return { cache: 'runtime', eligible: false, reason: 'cross-origin request' };
  if (url.pathname.startsWith('/api/')) return { cache: 'api', eligible: true, reason: 'api route' };
  if (url.pathname.endsWith('/') || url.pathname.endsWith('.html')) return { cache: 'document', eligible: true, reason: 'document route' };
  if (STATIC_EXTENSIONS.has(extension(url))) {
    const immutable = /\/assets\/|\.[a-f0-9]{8,}\./i.test(url.pathname);
    return { cache: immutable ? 'immutable' : 'runtime', eligible: true, reason: immutable ? 'content-addressed asset' : 'static runtime resource' };
  }
  return { cache: 'runtime', eligible: false, reason: 'uncacheable runtime request' };
}

export function createServiceWorkerSnapshot(precacheCount: number, fetches: number, cacheHits: number, networkFallbacks: number, installGeneration = 1): ServiceWorkerSnapshotR3 {
  return {
    version: 3,
    cacheNames: Object.values(CACHE_POLICIES_R3).map((policy) => policy.name),
    precacheCount: Math.max(0, Math.floor(precacheCount)),
    installGeneration: Math.max(0, Math.floor(installGeneration)),
    fetches: Math.max(0, Math.floor(fetches)),
    cacheHits: Math.max(0, Math.floor(cacheHits)),
    networkFallbacks: Math.max(0, Math.floor(networkFallbacks)),
  };
}
