import { resolveNearestEditorInstancePick } from './EditorInstancePickingModel.js';
import { readInstanceSelection } from './EditorInstanceSelectionModel.js';
import { beginInstanceEditSession, commitInstanceEditSession, endInstanceEditSession } from './EditorInstanceEditSession.js';
import { createEditorInstanceEditOperations } from './EditorInstanceEditOperations.js';

function assertScene(scene) {
  if (typeof scene?.add !== 'function' || typeof scene?.remove !== 'function') throw new TypeError('scene add/remove operations are required');
}

export function beginEditorInstanceEditFromHits(THREE, scene, groups, hits) {
  assertScene(scene);
  const pick = resolveNearestEditorInstancePick(groups, hits);
  if (!pick) return null;
  const selection = readInstanceSelection(groups, pick.instanceId);
  if (!selection) return null;
  const operations = createEditorInstanceEditOperations();
  const session = beginInstanceEditSession(THREE, selection, operations);
  try {
    scene.add(session.proxy);
  } catch (error) {
    endInstanceEditSession(session);
    throw error;
  }
  return { active: true, pick, session, operations };
}

export function commitEditorInstanceEdit(THREE, groups, coordinator) {
  if (!coordinator?.active || !coordinator.session || !coordinator.operations) throw new Error('active editor instance coordinator is required');
  return commitInstanceEditSession(THREE, groups, coordinator.session, coordinator.operations);
}

export function endEditorInstanceEdit(scene, coordinator) {
  assertScene(scene);
  if (!coordinator) return null;
  const proxy = endInstanceEditSession(coordinator.session);
  if (proxy) scene.remove(proxy);
  coordinator.active = false;
  return proxy;
}
