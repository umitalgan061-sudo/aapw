function assertTransformSurface(surface) {
  const transform = surface?.transform;
  if (!transform || typeof transform.attach !== 'function' || typeof transform.detach !== 'function') {
    throw new TypeError('transform surface with attach/detach is required');
  }
  if (typeof transform.addEventListener !== 'function' || typeof transform.removeEventListener !== 'function') {
    throw new TypeError('transform surface event API is required');
  }
  return transform;
}

function assertOperation(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} operation is required`);
}

export function createEditorInstanceTransformBridge(options = {}) {
  const transform = assertTransformSurface(options.transformSurface);
  const beginEdit = options.beginEdit;
  const commitEdit = options.commitEdit;
  const endEdit = options.endEdit;
  assertOperation(beginEdit, 'beginEdit');
  assertOperation(commitEdit, 'commitEdit');
  assertOperation(endEdit, 'endEdit');

  let coordinator = null;
  let disposed = false;

  function assertActive() {
    if (disposed) throw new Error('editor instance transform bridge is disposed');
  }

  function end() {
    if (!coordinator) return null;
    const current = coordinator;
    coordinator = null;
    if (transform.object === current.session?.proxy) transform.detach();
    return endEdit(current);
  }

  function begin(...args) {
    assertActive();
    end();
    const next = beginEdit(...args);
    if (!next) return null;
    const proxy = next.session?.proxy;
    if (!proxy) {
      endEdit(next);
      throw new Error('instance edit coordinator proxy is required');
    }
    coordinator = next;
    try {
      transform.attach(proxy);
    } catch (error) {
      coordinator = null;
      endEdit(next);
      throw error;
    }
    return next;
  }

  function commit() {
    assertActive();
    if (!coordinator) return null;
    return commitEdit(coordinator);
  }

  function onObjectChange() {
    if (!coordinator || transform.object !== coordinator.session?.proxy) return;
    commitEdit(coordinator);
  }

  function getSnapshot() {
    return Object.freeze({
      active: Boolean(coordinator?.active),
      attached: Boolean(coordinator && transform.object === coordinator.session?.proxy),
      disposed
    });
  }

  function dispose() {
    if (disposed) return null;
    transform.removeEventListener('objectChange', onObjectChange);
    const ended = end();
    disposed = true;
    return ended;
  }

  transform.addEventListener('objectChange', onObjectChange);
  return Object.freeze({ begin, commit, end, getSnapshot, dispose });
}
