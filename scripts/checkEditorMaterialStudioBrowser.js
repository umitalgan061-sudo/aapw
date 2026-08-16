#!/usr/bin/env node
/** Real-browser regression for editor.html Material Studio. */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) {
    console.error('[checkEditorMaterialStudioBrowser] Playwright unavailable.');
    process.exit(2);
  }

  const server = await startStaticServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({ headless: true });
  const failures = [];

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    page.on('pageerror', (error) => failures.push(`page:${error.message}`));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      if (message.text().includes('Failed to load resource')) return;
      failures.push(`console:${message.text()}`);
    });
    page.on('response', (response) => {
      if (response.status() < 400) return;
      if (decodeURIComponent(response.url()).endsWith('/assets/models/fbx_dosyaları/')) return;
      failures.push(`http:${response.status()} ${response.url()}`);
    });

    await page.goto(`http://127.0.0.1:${port}/editor.html`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForFunction(() => Boolean(
      window.__WESTEROS_WORLD_EDITOR__ && document.querySelector('#we-material-studio'),
    ), null, { timeout: 20000 });

    await page.evaluate(async () => {
      const THREE = await import('three');
      const api = window.__WESTEROS_WORLD_EDITOR__;
      const root = new THREE.Group();
      root.name = 'Material Studio QA Multi';
      root.userData.editorId = 'material-studio-qa-multi';
      root.userData.editorAssetId = 'peasant-girl';

      const faceMaterial = new THREE.MeshStandardMaterial({ name: 'skin' });
      const face = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), faceMaterial);
      face.name = 'face';
      face.position.y = 1.6;

      const tunicMaterial = new THREE.MeshStandardMaterial({ name: 'tunic' });
      const tunic = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 0.7), tunicMaterial);
      tunic.name = 'tunic';
      tunic.position.y = 0.4;

      root.add(face, tunic);
      api.editableObjects.push(root);
      api.scene.add(root);
      api.refreshHierarchy();
    });

    const multiItem = page.locator('#we-hierarchy .we-hierarchy-item', { hasText: 'Material Studio QA Multi' }).last();
    await multiItem.click();
    await page.waitForFunction(() => document.querySelectorAll('#we-material-surfaces select').length >= 2);

    const surfaceSelects = page.locator('#we-material-surfaces select');
    await surfaceSelects.nth(0).selectOption('skin-fair');
    await surfaceSelects.nth(1).selectOption('tunic-blue');

    const cumulative = await page.evaluate(() => {
      const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects
        .find((entry) => entry.userData?.editorId === 'material-studio-qa-multi');
      return object?.userData?.editorMaterialRecipe || null;
    });
    assert(cumulative?.mode === 'surface', 'surface recipe was not persisted');
    assert(Object.keys(cumulative.surfaceOverrides || {}).length === 2,
      `surface overrides are not cumulative: ${JSON.stringify(cumulative)}`);
    assert(Object.values(cumulative.surfaceOverrides).includes('skin-fair'), 'skin surface override missing');
    assert(Object.values(cumulative.surfaceOverrides).includes('tunic-blue'), 'tunic surface override missing');

    await page.locator('#we-material-size').selectOption('512');
    await page.locator('#we-material-base').selectOption('peasant');
    await page.locator('#we-material-auto').click();

    const multiProof = await page.evaluate(async () => {
      const api = window.__WESTEROS_WORLD_EDITOR__;
      const object = api.editableObjects.find((entry) => entry.userData?.editorId === 'material-studio-qa-multi');
      const meshes = [];
      object.traverse((child) => { if (child.isMesh) meshes.push(child); });
      const { serializeEditorScene } = await import('/src/3d/editor/EditorSceneSerializer.js');
      const serialized = serializeEditorScene([object], [], api.getEditorState());
      return {
        textureWidths: meshes.map((mesh) => mesh.material?.map?.image?.width || 0),
        roughness: meshes.map((mesh) => mesh.material?.roughness),
        recipe: object.userData.editorMaterialRecipe,
        savedRecipe: serialized.objects[0]?.materialRecipe,
      };
    });
    assert(multiProof.recipe?.textureSize === 512, 'Hero texture size not stored in material recipe');
    assert(multiProof.textureWidths.every((width) => width === 512),
      `named surfaces did not use 512px textures: ${multiProof.textureWidths.join(',')}`);
    assert(multiProof.savedRecipe?.textureSize === 512, 'material recipe missing from scene JSON');
    assert(new Set(multiProof.roughness).size > 1, 'skin and clothing should keep distinct PBR roughness');

    await page.evaluate(async () => {
      const THREE = await import('three');
      const api = window.__WESTEROS_WORLD_EDITOR__;
      const root = new THREE.Group();
      root.name = 'Material Studio QA Layered';
      root.userData.editorId = 'material-studio-qa-layered';
      root.userData.editorAssetId = 'peasant-girl';
      const material = new THREE.MeshStandardMaterial({ name: 'Material.002' });
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 3.2, 0.7), material);
      body.name = 'mesh_node';
      root.add(body);
      api.editableObjects.push(root);
      api.scene.add(root);
      api.refreshHierarchy();
    });

    await page.locator('#we-hierarchy .we-hierarchy-item', { hasText: 'Material Studio QA Layered' }).last().evaluate((button) => button.click());
    await page.waitForFunction(() => document.querySelector('#we-material-summary')?.textContent.includes('Material Studio QA Layered'));
    await page.locator('#we-material-size').selectOption('512');
    await page.locator('#we-material-base').selectOption('peasant');
    await page.locator('#we-material-auto').click();

    const layeredProof = await page.evaluate(() => {
      const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects
        .find((entry) => entry.userData?.editorId === 'material-studio-qa-layered');
      const mesh = object.children[0];
      return {
        bands: mesh.material?.userData?.layeredBands || [],
        pbr: mesh.material?.userData?.layeredPbr || [],
        width: mesh.material?.map?.image?.width || 0,
        recipe: object.userData.editorMaterialRecipe,
      };
    });
    assert(layeredProof.bands.length >= 4, `single-mesh figure did not receive multiple layers: ${layeredProof.bands}`);
    assert(layeredProof.width === 512, `single-mesh Hero layers are ${layeredProof.width}px instead of 512px`);
    assert(layeredProof.pbr.length === layeredProof.bands.length, 'PBR metadata does not cover every layer');
    assert(new Set(layeredProof.pbr.map((entry) => `${entry.roughness}:${entry.metalness}`)).size > 1,
      'layered figure does not carry distinct surface PBR values');
    assert(layeredProof.recipe?.mode === 'auto' && layeredProof.recipe.textureSize === 512,
      'layered recipe was not persisted');

    assert(failures.length === 0, `browser errors: ${failures.join(' | ')}`);
    console.log('[checkEditorMaterialStudioBrowser] PASS', JSON.stringify({
      cumulativeOverrides: Object.keys(cumulative.surfaceOverrides).length,
      multiTextureWidths: multiProof.textureWidths,
      layeredBands: layeredProof.bands,
      layeredTextureWidth: layeredProof.width,
    }));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error('[checkEditorMaterialStudioBrowser] FAIL', error);
  process.exit(1);
});