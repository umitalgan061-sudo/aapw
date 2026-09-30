function assertScene(scene) {
  if (typeof scene?.remove !== 'function') throw new TypeError('scene remove operation is required');
}

function assertEndSession(endSession) {
  if (typeof endSession !== 'function') throw new TypeError('endSession operation is required');
}

export function endEditorInstanceEditFailureSafe(scene, coordinator, endSession) {
  assertScene(scene);
  assertEndSession(endSession);
  if (!coordinator) return null;

  let proxy = null;
  let failure = null;
  try {
    proxy = endSession(coordinator.session);
    if (proxy) scene.remove(proxy);
  } catch (error) {
    failure = error;
  } finally {
    coordinator.active = false;
  }

  if (failure) throw failure;
  return proxy;
}
