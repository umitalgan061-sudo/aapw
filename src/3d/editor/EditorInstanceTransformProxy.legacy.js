function assertThree(THREE) {
  if (typeof THREE?.Object3D !== 'function') throw new TypeError('THREE.Object3D constructor is required');
}

function assertSelection(selection) {
  if (!selection || typeof selection.instanceId !== 'string' || !selection.transform) throw new TypeError('instance selection is required');
  for (const key of ['position', 'rotation', 'scale']) {
    const value = selection.transform[key];
    if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => !Number.isFinite(entry))) {
      throw new TypeError(`${key} must be a finite [x,y,z] triplet`);
    }
  }
}

export function createEditorInstanceTransformProxy(THREE, selection) {
  assertThree(THREE);
  assertSelection(selection);
  const proxy = new THREE.Object3D();
  proxy.name = `Instance ${selection.instanceId}`;
  proxy.userData.editorInstanceProxy = true;
  proxy.userData.editorInstanceId = selection.instanceId;
  proxy.userData.editorInstanceGroupId = selection.groupId;
  proxy.userData.editorInstanceIndex = selection.instanceIndex;
  proxy.position.fromArray(selection.transform.position);
  proxy.rotation.set(selection.transform.rotation[0], selection.transform.rotation[1], selection.transform.rotation[2]);
  proxy.scale.fromArray(selection.transform.scale);
  return proxy;
}

export function snapshotEditorInstanceTransformProxy(proxy) {
  if (!proxy?.userData?.editorInstanceProxy) throw new TypeError('editor instance transform proxy is required');
  return {
    position: [proxy.position.x, proxy.position.y, proxy.position.z],
    rotation: [proxy.rotation.x, proxy.rotation.y, proxy.rotation.z],
    scale: [proxy.scale.x, proxy.scale.y, proxy.scale.z]
  };
}
