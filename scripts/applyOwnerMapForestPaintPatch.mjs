import fs from 'node:fs';

const path = 'src/3d/world/terrain.js';
let source = fs.readFileSync(path, 'utf8');
if (!source.includes('OWNER_MAP_FOREST_TINT')) {
	const importLine = "import { sampleReferenceRoadPaintWorld } from './worldReferenceFeatureGuides.js';";
	if (!source.includes(importLine)) throw new Error('owner-map feature-guide import anchor missing');
	source = source.replace(importLine, "import { sampleReferenceForestInfluenceWorld, sampleReferenceRoadPaintWorld } from './worldReferenceFeatureGuides.js';");
	const roadTint = 'const OWNER_MAP_ROAD_TINT = new THREE.Color(0x806943);';
	if (!source.includes(roadTint)) throw new Error('road tint anchor missing');
	source = source.replace(roadTint, `const OWNER_MAP_FOREST_TINT = new THREE.Color(0x315b2f);\n${roadTint}`);
	const paintAnchor = "\t\tconst ownerMapRoadPaint = sampleReferenceRoadPaintWorld(columnWorldX[column], rowWorldZ[row]);";
	if (!source.includes(paintAnchor)) throw new Error('terrain paint anchor missing');
	source = source.replace(paintAnchor, "\t\tconst ownerMapForestPaint = sampleReferenceForestInfluenceWorld(columnWorldX[column], rowWorldZ[row]);\n\t\tif (ownerMapForestPaint > 0) blended.lerp(OWNER_MAP_FOREST_TINT, ownerMapForestPaint * 0.48);\n" + paintAnchor);
	fs.writeFileSync(path, source);
	console.log('OWNER_MAP_FOREST_PAINT_PATCH_APPLIED');
}
