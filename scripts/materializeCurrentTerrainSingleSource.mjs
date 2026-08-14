import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mapping = '    "./src/3d/world/terrain.js": "./src/3d/world/currentTerrainAdapter.js"';
const anchor = '    "three/addons/": "./src/3d/vendor/three/addons/"';

for (const relative of ['game3d.html', 'editor.html']) {
  const file = path.join(root, relative);
  const before = fs.readFileSync(file, 'utf8');
  if (before.includes(mapping.trim())) continue;
  if (!before.includes(anchor)) throw new Error(`${relative}: import-map anchor missing`);
  const after = before.replace(anchor, `${anchor},\n${mapping}`);
  if (after === before) throw new Error(`${relative}: current terrain mapping was not materialized`);
  fs.writeFileSync(file, after);
  console.log(`CURRENT_TERRAIN_MATERIALIZED=${relative}`);
}
