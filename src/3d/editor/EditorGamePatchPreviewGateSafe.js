try {
  const { installLiveFourAgentGameTerrain } = await import('../../../scripts/liveFourAgentTerrain.mjs');
  installLiveFourAgentGameTerrain();
} catch (error) {
  console.error('[EditorGamePatchPreviewGateSafe] live four-agent terrain failed to load; keeping previous terrain', error);
}

const params = new URLSearchParams(window.location.search);
if (params.get('editorPatch') === '1') {
  try {
    await import('./EditorGamePatchPreview.js');
  } catch (error) {
    console.error('[EditorGamePatchPreviewGateSafe] preview module failed to load', error);
  }
}
