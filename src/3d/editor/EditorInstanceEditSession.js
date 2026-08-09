function cloneTransform(transform) {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale]
  };
}

function assertOperations(operations) {
  for (const key of ['createProxy', 'snapshotProxy', 'updateSelection', 'applyRender']) {
    if (typeof operations?.[key] !== 'function') throw new TypeError(`${key} operation is required`);
  }
}

export function beginInstanceEditSession(THREE, selection, operations) {
  assertOperations(operations);
  if (!selection?.instanceId || !selection?.transform) throw new TypeError('selection is required');
  const proxy = operations.createProxy(THREE, selection);
  return {
    active: true,
    instanceId: selection.instanceId,
    selection: { ...selection, transform: cloneTransform(selection.transform) },
    proxy
  };
}

export function commitInstanceEditSession(THREE, groups, session, operations) {
  assertOperations(operations);
  if (!session?.active || !session.proxy) throw new Error('active instance edit session is required');
  const previous = cloneTransform(session.selection.transform);
  const patch = operations.snapshotProxy(session.proxy);
  const updated = operations.updateSelection(groups, session.instanceId, patch);
  if (!updated) throw new Error(`Edited instance no longer exists: ${session.instanceId}`);

  try {
    operations.applyRender(THREE, updated);
  } catch (error) {
    const rollback = operations.updateSelection(groups, session.instanceId, previous);
    if (rollback) {
      try { operations.applyRender(THREE, rollback); } catch {}
    }
    throw error;
  }

  session.selection = { ...updated.selection, transform: cloneTransform(updated.selection.transform) };
  return session.selection;
}

export function endInstanceEditSession(session) {
  if (!session) return null;
  session.active = false;
  const proxy = session.proxy || null;
  session.proxy = null;
  return proxy;
}
