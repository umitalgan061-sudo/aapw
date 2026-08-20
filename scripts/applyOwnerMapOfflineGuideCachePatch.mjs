import fs from 'node:fs';

const path = 'service-worker.js';
const source = fs.readFileSync(path, 'utf8');
const anchor = "    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceMountainRelief.js');\n";
const line = "    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceFeatureGuides.js');\n";
if (!source.includes(anchor)) throw new Error('mountain relief offline-shell anchor missing');
if (!source.includes(line.trim())) fs.writeFileSync(path, source.replace(anchor, anchor + line));
