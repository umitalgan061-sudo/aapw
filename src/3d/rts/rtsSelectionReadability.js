/**
 * Read-only RTS selection readability. Mirrors the existing HUD text into an accessible
 * percentage meter without owning or mutating army/simulation state.
 */
export function installRtsSelectionReadability() {
  if (window.__WESTEROS_RTS_SELECTION_READABILITY__) return window.__WESTEROS_RTS_SELECTION_READABILITY__;

  const source = document.getElementById('rts-selection-count');
  if (!source) return null;

  const host = document.createElement('div');
  host.id = 'rts-selection-readability';
  host.setAttribute('role', 'group');
  host.setAttribute('aria-label', 'Ordu seçim durumu');
  host.style.cssText = 'position:fixed;right:14px;top:62px;z-index:34;min-width:154px;padding:7px 9px;border:1px solid rgba(229,194,102,.45);border-radius:8px;background:rgba(24,19,11,.78);backdrop-filter:blur(5px);font:600 11px/1.2 system-ui,sans-serif;letter-spacing:.04em;color:#ead9a4;pointer-events:none;';

  const label = document.createElement('div');
  label.textContent = 'ORDU SEÇİMİ';
  const value = document.createElement('div');
  value.id = 'rts-selection-readability-value';
  value.style.cssText = 'margin-top:4px;font-size:13px;color:#fff3c4;';
  const meter = document.createElement('div');
  meter.id = 'rts-selection-readability-meter';
  meter.setAttribute('role', 'progressbar');
  meter.setAttribute('aria-label', 'Seçili asker oranı');
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', '100');
  meter.style.cssText = 'height:4px;margin-top:6px;border-radius:999px;background:rgba(255,255,255,.14);overflow:hidden;';
  const fill = document.createElement('span');
  fill.style.cssText = 'display:block;height:100%;width:0%;background:currentColor;transition:width .14s ease;';
  meter.appendChild(fill);
  host.append(label, value, meter);
  document.body.appendChild(host);

  const parseSelection = () => {
    const match = source.textContent.match(/(\d+)\s*\/\s*(\d+)/);
    const selected = Number(match?.[1] ?? 0);
    const total = Math.max(0, Number(match?.[2] ?? 0));
    const percent = total > 0 ? Math.round((selected / total) * 100) : 0;
    value.textContent = `${selected} / ${total} • %${percent}`;
    meter.setAttribute('aria-valuenow', String(percent));
    meter.setAttribute('aria-valuetext', `${selected} / ${total} asker seçili`);
    fill.style.width = `${percent}%`;
    host.dataset.selected = String(selected);
    host.dataset.total = String(total);
    host.dataset.percent = String(percent);
  };

  const observer = new MutationObserver(parseSelection);
  observer.observe(source, { childList: true, characterData: true, subtree: true });
  parseSelection();

  const dispose = () => {
    observer.disconnect();
    host.remove();
  };
  window.addEventListener('pagehide', dispose, { once: true });

  const api = {
    getSnapshot: () => ({
      selected: Number(host.dataset.selected ?? 0),
      total: Number(host.dataset.total ?? 0),
      percent: Number(host.dataset.percent ?? 0),
      text: value.textContent,
      ariaValueNow: meter.getAttribute('aria-valuenow'),
      ariaValueText: meter.getAttribute('aria-valuetext'),
    }),
    dispose,
  };
  window.__WESTEROS_RTS_SELECTION_READABILITY__ = api;
  return api;
}
