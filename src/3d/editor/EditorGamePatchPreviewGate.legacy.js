const params = new URLSearchParams(window.location.search);
if (params.get('editorPatch') === '1') {
  import('./EditorGamePatchPreview.js').catch((error) => {
    console.error('[EditorGamePatchPreviewGate] preview module failed to load', error);
  });
}
