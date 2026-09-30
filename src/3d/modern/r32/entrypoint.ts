import { BrowserRuntimeBridge } from './browserBridge.ts';
import { R32Application, R32ApplicationState } from './application.ts';
import { RuntimeDiagnostics } from './contracts.ts';

export interface R32EntrypointOptions {
  readonly initialState?: R32ApplicationState;
  readonly autoStart?: boolean;
  readonly exposeGlobal?: boolean;
}

export interface R32Entrypoint {
  readonly application: R32Application;
  readonly browser: BrowserRuntimeBridge;
  readonly start: () => void;
  readonly stop: () => void;
  readonly tick: (deltaSeconds: number) => RuntimeDiagnostics;
  readonly diagnostics: () => RuntimeDiagnostics;
  readonly dispose: () => void;
}

export function createR32Entrypoint(
  options: R32EntrypointOptions = {},
): R32Entrypoint {
  const browser = new BrowserRuntimeBridge();

  const application = new R32Application({
    browser,
    initialState: options.initialState,
  });

  const entrypoint: R32Entrypoint = {
    application,
    browser,
    start: () => application.start(),
    stop: () => application.shutdown(),
    tick: (deltaSeconds) => application.tick(deltaSeconds),
    diagnostics: () => application.diagnostics(),
    dispose: () => application.shutdown(),
  };

  if (
    options.exposeGlobal
    && typeof window !== 'undefined'
  ) {
    (
      window as Window & {
        __AAPW_R32__?: R32Entrypoint;
      }
    ).__AAPW_R32__ = entrypoint;
  }

  if (options.autoStart) {
    application.start();
  }

  return entrypoint;
}

export function attachR32ToAnimationFrame(
  entrypoint: R32Entrypoint,
  target: Window,
): () => void {
  let stopped = false;
  let previous = performance.now();

  const frame = (timestamp: number): void => {
    if (stopped) {
      return;
    }

    const deltaSeconds = Math.max(
      0,
      Math.min(
        0.25,
        (timestamp - previous) / 1000,
      ),
    );

    previous = timestamp;
    entrypoint.tick(deltaSeconds);
    target.requestAnimationFrame(frame);
  };

  target.requestAnimationFrame(frame);

  return () => {
    stopped = true;
  };
}

export function installR32ErrorSurface(
  entrypoint: R32Entrypoint,
  target: Window,
): () => void {
  const previousError = target.onerror;
  const previousRejection = target.onunhandledrejection;

  target.onerror = (
    message,
    source,
    lineno,
    colno,
    error,
  ): boolean => {
    entrypoint.application.observability.increment(
      'browser.errors',
    );

    entrypoint.application.observability.startSpan(
      'browser.error',
      entrypoint.application.diagnostics().clock.tick,
      {
        source: String(source ?? ''),
        line: Number(lineno ?? 0),
        column: Number(colno ?? 0),
      },
    ).end(error ?? message);

    if (typeof previousError === 'function') {
      previousError.call(
        target,
        message,
        source,
        lineno,
        colno,
        error,
      );
    }

    return false;
  };

  target.onunhandledrejection = (event: PromiseRejectionEvent): void => {
    entrypoint.application.observability.increment(
      'browser.unhandledRejections',
    );

    entrypoint.application.observability.startSpan(
      'browser.unhandledRejection',
      entrypoint.application.diagnostics().clock.tick,
    ).end(event.reason);

    previousRejection?.call(target, event);
  };

  return () => {
    target.onerror = previousError;
    target.onunhandledrejection = previousRejection;
  };
}
