import {
  beginEditorInstanceEditFromHits,
  commitEditorInstanceEdit
} from './EditorInstanceEditCoordinator.js';
import { endInstanceEditSession } from './EditorInstanceEditSession.js';
import { endEditorInstanceEditFailureSafe } from './EditorInstanceLifecycleSafety.js';

export { beginEditorInstanceEditFromHits, commitEditorInstanceEdit };

export function endEditorInstanceEditSafe(scene, coordinator) {
  return endEditorInstanceEditFailureSafe(scene, coordinator, endInstanceEditSession);
}
