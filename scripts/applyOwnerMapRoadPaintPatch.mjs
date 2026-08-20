import fs from 'node:fs';

const path = 'src/3d/world/terrain.js';
let source = fs.readFileSync(path, 'utf8');
if (!source.includes('sampleReferenceRoadPaintWorld')) {
	const importAnchor = "import { sampleWorldReferenceMountainReliefMeters } from './worldReferenceMountainRelief.js';";
	if (!source.includes(importAnchor)) throw new Error('terrain road-paint import anchor missing');
	source = source.replace(importAnchor, `${importAnchor}\nimport { sampleReferenceRoadPaintWorld } from './worldReferenceFeatureGuides.js';`);
	const constantAnchor = "const lerp = (a, b, t) => a + (b - a) * t;";
	if (!source.includes(constantAnchor)) throw new Error('terrain road-paint constant anchor missing');
	source = source.replace(constantAnchor, `${constantAnchor}\nconst OWNER_MAP_ROAD_TINT = new THREE.Color(0x806943);`);
	const colorAnchor = "\t\tcolors[index * 3] = blended.r;";
	if (!source.includes(colorAnchor)) throw new Error('terrain road-paint color anchor missing');
	source = source.replace(colorAnchor, "\t\tconst ownerMapRoadPaint = sampleReferenceRoadPaintWorld(columnWorldX[column], rowWorldZ[row]);\n\t\tif (ownerMapRoadPaint > 0) blended.lerp(OWNER_MAP_ROAD_TINT, ownerMapRoadPaint * 0.78);\n" + colorAnchor);
	fs.writeFileSync(path, source);
	console.log('OWNER_MAP_ROAD_PAINT_PATCH_APPLIED');
} else {
	console.log('OWNER_MAP_ROAD_PAINT_PATCH_ALREADY_APPLIED');
}
