import * as THREE from 'three';

const tempMatrix = new THREE.Matrix4();
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3(1, 1, 1);

function firstInstancableMesh(root) {
  let found = null;
  let rejected = false;
  root.traverse((child) => {
    if (child.isSkinnedMesh) rejected = true;
    if (!found && child.isMesh && !child.isSkinnedMesh) found = child;
  });
  return rejected ? null : found;
}

export class EditorInstanceManager {
  constructor(scene, assetManager) {
    this.scene = scene;
    this.assetManager = assetManager;
    this.groups = [];
  }

  async createFormation(asset, rows, columns, spacing, origin = new THREE.Vector3()) {
    const template = await this.assetManager.loadTemplate(asset);
    const sourceMesh = firstInstancableMesh(template);
    if (!sourceMesh) throw new Error('Bu asset rigged/skinned olduğu için bu sürümde GPU InstancedMesh formasyonuna uygun değil.');
    const count = rows * columns;
    const mesh = new THREE.InstancedMesh(sourceMesh.geometry, sourceMesh.material, count);
    const groupId = `formation-${asset.id}-${Date.now()}`;
    mesh.name = `${asset.name} ×${count}`;
    mesh.userData.editorInstanceGroupId = groupId;
    mesh.userData.editorAssetId = asset.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const instances = [];
    let index = 0;
    const xOffset = ((columns - 1) * spacing) / 2;
    const zOffset = ((rows - 1) * spacing) / 2;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        tempPosition.set(origin.x + column * spacing - xOffset, origin.y, origin.z + row * spacing - zOffset);
        tempMatrix.compose(tempPosition, tempQuaternion.identity(), tempScale.set(1, 1, 1));
        mesh.setMatrixAt(index, tempMatrix);
        instances.push({ id: `${groupId}-${index}`, position: tempPosition.toArray(), rotation: [0, 0, 0], scale: [1, 1, 1] });
        index += 1;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    const record = { id: groupId, assetId: asset.id, object: mesh, instances, rows, columns, spacing };
    this.groups.push(record);
    return record;
  }

  removeGroupObject(object) {
    const index = this.groups.findIndex((record) => record.object === object);
    if (index < 0) return false;
    const [record] = this.groups.splice(index, 1);
    this.scene.remove(record.object);
    record.object.dispose();
    return true;
  }

  serialize() {
    return this.groups.map((record) => ({
      id: record.id,
      asset: record.assetId,
      rows: record.rows,
      columns: record.columns,
      spacing: record.spacing,
      instances: record.instances
    }));
  }
}
