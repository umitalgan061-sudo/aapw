/** Run200 preflight-only startup selector. No live runtime imports this file. */
import { createCurrentRuntimeIntegrationShadow } from '../src/3d/world/worldReferenceCurrentRuntimeIntegrationShadow.js';

export const RUN200_STARTUP_POLICY = Object.freeze({
  key: 'run200-canonical-startup-selector-v1',
  queryKey: 'worldSource',
  current: 'current',
  canonical: 'canonical',
  canonicalQueryValue: 'canonical-dev',
});

export function resolveRun200StartupSource(search = '') {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  return params.get(RUN200_STARTUP_POLICY.queryKey) === RUN200_STARTUP_POLICY.canonicalQueryValue
    ? RUN200_STARTUP_POLICY.canonical
    : RUN200_STARTUP_POLICY.current;
}

export function createRun200StartupSelector({ state, search = '', bridgeId, profile = 'mobile' } = {}) {
  const requestedSource = resolveRun200StartupSource(search);
  const integration = createCurrentRuntimeIntegrationShadow({ state, profile });
  let activeSource = RUN200_STARTUP_POLICY.current;
  let activation = null;
  let fallbackReason = null;
  let disposed = false;

  if (requestedSource === RUN200_STARTUP_POLICY.canonical) {
    try {
      activation = integration.activateCanonicalAtBridge(bridgeId);
      activeSource = RUN200_STARTUP_POLICY.canonical;
    } catch (error) {
      fallbackReason = String(error?.message || error);
      activeSource = RUN200_STARTUP_POLICY.current;
    }
  }

  function assertUsable() {
    if (disposed) throw new Error('Run200 startup selector is disposed');
  }

  function rollbackToCurrent() {
    assertUsable();
    const result = integration.rollbackToCurrent();
    activeSource = RUN200_STARTUP_POLICY.current;
    return result;
  }

  function dispose() {
    if (disposed) return;
    integration.dispose();
    disposed = true;
  }

  return Object.freeze({
    version: RUN200_STARTUP_POLICY.key,
    requestedSource,
    activation,
    fallbackReason,
    getActiveSource: () => activeSource,
    getGroundCollider: () => integration.getGroundCollider(),
    rollbackToCurrent,
    dispose,
    isDisposed: () => disposed,
  });
}
