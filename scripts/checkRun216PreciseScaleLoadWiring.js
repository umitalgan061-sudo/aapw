import fs from 'node:fs';

const worldEditor = fs.readFileSync('src/3d/editor/worldEditor.js', 'utf8');
const serializer = fs.readFileSync('src/3d/editor/EditorSceneSerializer.js', 'utf8');

const serializeScale = 'scale: vector3(object.scale)';
const loadObject = 'const object = await addAsset(asset, new THREE.Vector3(...record.transform.position));';
const restoreScale = 'object.scale.set(...record.transform.scale);';

if (!serializer.includes(serializeScale)) throw new Error('scene serializer no longer persists object scale');
if (!worldEditor.includes(loadObject)) throw new Error('scene loader addAsset contract missing');
if (!worldEditor.includes(restoreScale)) throw new Error('scene loader no longer restores serialized object scale');
if (worldEditor.indexOf(restoreScale) < worldEditor.indexOf(loadObject)) throw new Error('serialized scale must restore after asset creation/import normalization');

console.log('PASS Run216 precise scale load wiring: serialized root scale is restored after asset import normalization during scene load.');
