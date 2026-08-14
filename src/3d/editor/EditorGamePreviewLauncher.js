export function installEditorGamePreviewLauncher(localSession = window.__WESTEROS_EDITOR_LOCAL_SESSION__) {
  if (!localSession?.saveLocal) throw new Error('Oyunda Önizle için local session gerekli.');
  if (window.__WESTEROS_EDITOR_GAME_PREVIEW_LAUNCHER__) return window.__WESTEROS_EDITOR_GAME_PREVIEW_LAUNCHER__;

  const toolbar = document.querySelector('.we-toolbar-actions');
  const normalGameLink = toolbar?.querySelector('.we-link');
  if (!toolbar || !normalGameLink) throw new Error('Oyunda Önizle toolbar hedefi bulunamadı.');

  const button = document.createElement('button');
  button.id = 'we-preview-game';
  button.type = 'button';
  button.textContent = '▶ Oyunda Önizle';
  button.title = 'Editör scene kaydını gerçek 3D oyunun üzerinde görsel overlay olarak önizle';
  toolbar.insertBefore(button, normalGameLink);

  let disposed = false;
  function launch() {
    if (disposed) return false;
    const saved = localSession.saveLocal({ quiet: true });
    if (!saved) return false;
    window.location.assign('./game3d.html?editorPatch=1');
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    button.removeEventListener('click', launch);
    window.removeEventListener('pagehide', dispose);
    button.remove();
    if (window.__WESTEROS_EDITOR_GAME_PREVIEW_LAUNCHER__ === surface) delete window.__WESTEROS_EDITOR_GAME_PREVIEW_LAUNCHER__;
  }

  button.addEventListener('click', launch);
  window.addEventListener('pagehide', dispose, { once: true });
  const surface = Object.freeze({ launch, dispose });
  window.__WESTEROS_EDITOR_GAME_PREVIEW_LAUNCHER__ = surface;
  return surface;
}

const localSession = window.__WESTEROS_EDITOR_LOCAL_SESSION__;
if (localSession) {
  try {
    installEditorGamePreviewLauncher(localSession);
  } catch (error) {
    console.error('[EditorGamePreviewLauncher] boot failed', error);
  }
}

void import('./EditorLiveWorkspaceEntry.mjs').catch((error) => {
  console.error('[EditorGamePreviewLauncher] integrated live workspace boot failed', error);
});
