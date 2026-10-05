import { stableDigest } from './contracts.ts';
import { R43Runtime, type R43RuntimeOptions } from './runtime.ts';

export interface BrowserBridgeOptions extends R43RuntimeOptions {
  readonly eventPrefix?: string;
  readonly exposeGlobal?: boolean;
}

export interface BrowserRuntimeBridge {
  readonly runtime: R43Runtime;
  readonly prefix: string;
  dispatch(name: string, detail?: unknown): void;
  readGlobal<T>(key: string): T | undefined;
  dispose(): void;
}

export function createBrowserRuntimeBridge(options: BrowserBridgeOptions = {}): BrowserRuntimeBridge {
  const prefix = options.eventPrefix ?? 'aapw:r43';
  const runtime = new R43Runtime(options);
  const canDispatch = typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function';
  const dispatch = (name: string, detail?: unknown): void => {
    if (!canDispatch) return;
    globalThis.dispatchEvent(new CustomEvent(prefix + ':' + name, { detail }));
  };
  if (options.exposeGlobal !== false && typeof globalThis === 'object') {
    const root = globalThis as Record<string, unknown>;
    const namespace = (root.__AAPW_R43__ as Record<string, unknown> | undefined) ?? {};
    namespace.runtime = runtime;
    namespace.digest = stableDigest(runtime.snapshotResult());
    root.__AAPW_R43__ = namespace;
  }
  return {
    runtime,
    prefix,
    dispatch,
    readGlobal<T>(key: string): T | undefined {
      const root = globalThis as Record<string, unknown>;
      const namespace = root.__AAPW_R43__ as Record<string, unknown> | undefined;
      return namespace?.[key] as T | undefined;
    },
    dispose(): void {
      runtime.shutdown();
      if (typeof globalThis === 'object') {
        const root = globalThis as Record<string, unknown>;
        const namespace = root.__AAPW_R43__ as Record<string, unknown> | undefined;
        if (namespace?.runtime === runtime) delete namespace.runtime;
      }
      dispatch('disposed', { digest: stableDigest(runtime.snapshotResult()) });
    },
  };
}
