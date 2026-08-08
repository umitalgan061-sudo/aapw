import fs from 'node:fs';

const scenePath = 'src/3d/sceneManager.js';
const marker = 'run180FirstFrameSafe';
const append = `\n\n// Run 180 / ADR-0201 — guarantee the camera-local grass can recenter on the first rendered frame.\n// The player camera is moved several kilometres after createScene() returns; leaving this single\n// bounded grass mesh frustum-culled could prevent its own onBeforeRender recenter callback from\n// ever running when the old cell is outside the new camera frustum. One always-submitted mesh is\n// deliberate here: its instance buffer is bounded and onBeforeRender immediately recenters it.\nconst _createWindGrassRun179BeforeFirstFrameSafetyRun180 = createWindGrassRun179;\ncreateWindGrassRun179 = function createWindGrassRun179FirstFrameSafeRun180(options) {\n\tconst result = _createWindGrassRun179BeforeFirstFrameSafetyRun180(options);\n\tresult.mesh.frustumCulled = false;\n\tresult.mesh.userData.run180FirstFrameSafe = true;\n\treturn result;\n};\n`;

const source = fs.readFileSync(scenePath, 'utf8');
if (!source.includes(marker)) fs.appendFileSync(scenePath, append);
console.log('[applyRun180Additions] PASS: first-frame grass recenter safety appended.');
