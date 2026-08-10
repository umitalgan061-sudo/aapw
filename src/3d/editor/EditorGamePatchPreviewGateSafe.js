const params = new URLSearchParams(window.location.search);
if (params.get('editorPatch') === '1') {
  try {
    await import('./EditorGamePatchPreview.js');
  } catch (error) {
    console.error('[EditorGamePatchPreviewGateSafe] preview module failed to load', error);
  }
}
