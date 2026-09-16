import { createAapwApp, exposeDevelopmentDiagnostics } from './core/app/createApp.ts';

const app = createAapwApp({ attachInputListeners: true, autoStart: true });
const diagnostics = typeof window !== 'undefined' ? exposeDevelopmentDiagnostics(app) : null;

if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__AAPW_TS_APP__', {
    value: app,
    configurable: true,
    enumerable: false,
    writable: false,
  });
  Object.defineProperty(window, '__AAPW_TS_DIAGNOSTICS__', {
    value: diagnostics,
    configurable: true,
    enumerable: false,
    writable: false,
  });
}

let previous = typeof performance !== 'undefined' ? performance.now() : 0;
let rafId = 0;

const frame = (time: number): void => {
  const delta = Math.min(100, Math.max(0, time - previous));
  previous = time;
  app.tick(delta);
  rafId = requestAnimationFrame(frame);
};

if (typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(frame);

export const stopModernRuntime = (): void => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
  app.dispose();
};

export { app };
