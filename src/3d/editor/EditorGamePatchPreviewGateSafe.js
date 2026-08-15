const params = new URLSearchParams(window.location.search);

// The four-agent adoption layer rewrites terrain mesh Y values after ChunkManager creation. That is
// useful only for the explicit editor-patch preview; installing it on every normal game boot creates
// a second height authority beside world/terrain.js and makes rendered ground diverge from physics.
if (params.get('editorPatch') === '1') {
  try {
    const liveTerrain = await import('../../../scripts/liveFourAgentTerrain.mjs');
    liveTerrain.installLiveFourAgentGameTerrain();
    const { ChunkManager } = await import('../world/chunkManager.js');
    const refreshFlag = Symbol.for('westeros.live-four-agent-terrain.streaming-refresh.v3');
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
    await import('./EditorGamePatchPreview.js');
  } catch (error) {
    console.error('[EditorGamePatchPreviewGateSafe] editor-patch terrain preview failed to load', error);
  }
}
