import {
  beginEditorInstanceEditFromHits,
  commitEditorInstanceEdit,
  endEditorInstanceEdit
} from './EditorInstanceEditCoordinator.js';

function assertFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} function is required`);
}

export function createEditorInstanceCoordinatorLifecycle(options = {}) {
  const THREE = options.THREE;
  const scene = options.scene;
  const getGroups = options.getGroups;
  if (!THREE) throw new TypeError('THREE namespace is required');
  if (!scene) throw new TypeError('scene is required');
  assertFunction(getGroups, 'getGroups');

  function currentGroups() {
    const groups = getGroups();
    if (!Array.isArray(groups)) throw new TypeError('getGroups must return an array');
    return groups;
  }

  function beginEdit(hits) {
    return beginEditorInstanceEditFromHits(THREE, scene, currentGroups(), hits);
  }

  function commitEdit(coordinator) {
    return commitEditorInstanceEdit(THREE, currentGroups(), coordinator);
  }

  function endEdit(coordinator) {
    return endEditorInstanceEdit(scene, coordinator);
  }

  return Object.freeze({ beginEdit, commitEdit, endEdit });
}
