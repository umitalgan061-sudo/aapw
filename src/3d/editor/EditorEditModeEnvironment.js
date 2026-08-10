export function installEditorEditModeEnvironment(api) {
  if (!api?.scene) throw new Error('World Editor scene bulunamadı.');
  if (window.__WESTEROS_EDITOR_ENVIRONMENT__) return window.__WESTEROS_EDITOR_ENVIRONMENT__;

  const previousFog = api.scene.fog;
  let disposed = false;

  api.scene.fog = null;

  function getSnapshot() {
    return Object.freeze({
      fogDisabled: api.scene.fog === null,
      hadPreviousFog: Boolean(previousFog)
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('pagehide', dispose);
    if (api.scene.fog === null) api.scene.fog = previousFog;
    if (window.__WESTEROS_EDITOR_ENVIRONMENT__ === surface) delete window.__WESTEROS_EDITOR_ENVIRONMENT__;
  }

  const surface = Object.freeze({ getSnapshot, dispose });
  window.__WESTEROS_EDITOR_ENVIRONMENT__ = surface;
  window.addEventListener('pagehide', dispose, { once: true });
  return surface;
}

const api = window.__WESTEROS_WORLD_EDITOR__;
if (api) {
  try {
    installEditorEditModeEnvironment(api);
  } catch (error) {
    console.error('[EditorEditModeEnvironment] boot failed', error);
  }
}
