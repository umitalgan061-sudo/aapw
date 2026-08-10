import { serializeEditorScene, validateEditorScene } from '../src/3d/editor/EditorSceneSerializer.js';

const object = {
  userData: { editorId: 'black-dragon-0001', editorAssetId: 'black-dragon' },
  name: 'Siyah Ejderha',
  position: { x: 1, y: 2, z: 3 },
  rotation: { x: 0.1, y: 0.2, z: 0.3 },
  scale: { x: 0.005, y: 0.001, z: 0.0123456 }
};

const serialized = serializeEditorScene([object], [], { gridVisible: true, snapEnabled: true, snapSize: 1 });
const jsonRoundTrip = JSON.parse(JSON.stringify(serialized));
const validated = validateEditorScene(jsonRoundTrip);
const scale = validated.objects[0]?.transform?.scale;

if (!Array.isArray(scale) || scale.length !== 3) throw new Error('serialized scale vector missing');
if (scale[0] !== 0.005) throw new Error(`0.005 scale did not persist: ${scale[0]}`);
if (scale[1] !== 0.001) throw new Error(`minimum non-singular scale did not persist: ${scale[1]}`);
if (scale[2] !== 0.012346) throw new Error(`six-decimal deterministic rounding changed: ${scale[2]}`);
if (scale.some((value) => value === 1)) throw new Error('precise scale unexpectedly reset to legacy default 1');

console.log('PASS Run216 precise scale persistence: sub-0.01 object scale survives serialize/JSON/validate round-trip deterministically.');
