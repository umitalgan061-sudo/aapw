import fs from 'node:fs';

const html = fs.readFileSync('editor.html', 'utf8');

const required = [
  "gridToggle.disabled = true;",
  "ownerApi.grid.visible = false;",
  "input.min = '0.001';",
  "input.step = '0.001';",
  "input.addEventListener('change', applyPreciseScale, true);",
  "folderInput.setAttribute('webkitdirectory', '');",
  'async function crawlProjectDirectory',
  "manager.setURLModifier(resolveLocalDependency);",
  "filtered.slice(0, 500)",
  "const resolution = 256;",
  'groundCollider?.getGroundHeight',
  'uEditorTerrainWaterMask',
  'texture2D(uEditorTerrainWaterMask, editorMaskUv).r < 0.5) discard;'
];

for (const token of required) {
  if (!html.includes(token)) throw new Error(`Run216 owner editor feedback contract missing: ${token}`);
}

const inlineModules = [...html.matchAll(/<script type="module">\n([\s\S]*?)<\/script>/g)].map((match) => match[1]);
if (inlineModules.length < 3) throw new Error(`Expected at least 3 inline owner modules, found ${inlineModules.length}`);

for (const [index, source] of inlineModules.entries()) {
  const withoutImports = source.replace(/^import\s+[^;]+;\s*$/gm, '');
  try {
    new Function(withoutImports);
  } catch (error) {
    throw new Error(`Inline module ${index + 1} syntax contract failed: ${error.message}`);
  }
}

const legacyScaleFloorCount = (html.match(/min="0\.01"/g) || []).length;
if (legacyScaleFloorCount < 3) throw new Error('Additive-only proof expected legacy scale metadata to remain in source');

console.log('PASS Run216 owner editor feedback: moving grid hidden, 0.001 scale override wired, local FBX lazy library present, terrain-clipped editor water present.');
