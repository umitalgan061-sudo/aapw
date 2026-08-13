try {
  const liveTerrain = await import('../../../scripts/liveFourAgentTerrain.mjs');
  liveTerrain.installLiveFourAgentGameTerrain();
  const { ChunkManager } = await import('../world/chunkManager.js');
  const refreshFlag = Symbol.for('westeros.live-four-agent-terrain.streaming-refresh.v1');
  const prototype = ChunkManager.prototype;
  if (!prototype[refreshFlag]) {
    const priorStreamTowards = prototype.streamTowards;
    prototype.streamTowards = function streamTowardsWithFourAgentTerrainRefresh(...args) {
      const result = priorStreamTowards.apply(this, args);
      for (const mesh of this.loaded.values()) liveTerrain.applyLiveFourAgentHeightToMesh(mesh);
      return result;
    };
    Object.defineProperty(prototype, refreshFlag, { value: true, configurable: false });
  }
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
