import { RUN200_STARTUP_POLICY, resolveRun200StartupSource } from './run200CanonicalStartupSelectorShadow.mjs';

const requestedSource = resolveRun200StartupSource(window.location.search);
const explicitCanonical = requestedSource === RUN200_STARTUP_POLICY.canonical;
const status = document.getElementById('run201-status');
const boot = Object.freeze({
  version: 'run201-canonical-dev-entry-v1',
  requestedSource,
  explicitCanonical,
  defaultRuntimeChanged: false,
  defaultEntry: './game3d.html',
});

window.__RUN201_CANONICAL_DEV_BOOT__ = boot;

if (status) {
  status.textContent = explicitCanonical
    ? 'canonical-dev isteği açıkça seçildi; canonical runtime sahiplik aktivasyonu ayrı doğrulama kapısında tutuluyor.'
    : 'Varsayılan/current kaynak korundu. Canonical geliştirme modu için ?worldSource=canonical-dev gerekir.';
}
