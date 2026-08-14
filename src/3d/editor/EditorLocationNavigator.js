const CAMERA_HORIZONTAL_OFFSET_METERS = 150;
const CAMERA_VERTICAL_OFFSET_METERS = 105;

function createUi(seats) {
  const toolbar = document.querySelector('.we-toolbar-actions');
  const link = toolbar?.querySelector('.we-link');
  if (!toolbar || !link) throw new Error('Editor location navigator toolbar hedefi bulunamadı.');

  const group = document.createElement('div');
  group.id = 'we-location-tools';
  group.className = 'we-location-tools';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Dünya konumu');

  const select = document.createElement('select');
  select.id = 'we-location-select';
  select.className = 'we-location-select';
  select.setAttribute('aria-label', 'Krallık konumu');
  const centerOption = document.createElement('option');
  centerOption.value = '__center__';
  centerOption.textContent = 'Dünya Merkezi';
  select.append(centerOption);
  for (const seat of seats) {
    const option = document.createElement('option');
    option.value = seat.id;
    option.textContent = seat.name;
    select.append(option);
  }

  const goButton = document.createElement('button');
  goButton.id = 'we-location-go';
  goButton.type = 'button';
  goButton.textContent = 'Konuma Git';
  group.append(select, goButton);
  toolbar.insertBefore(group, link);

  const style = document.createElement('style');
  style.id = 'we-location-style';
  style.textContent = '.we-location-tools{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto}.we-location-select{min-width:150px;max-width:210px;height:32px;border:1px solid var(--we-border);border-radius:5px;background:var(--we-panel);color:var(--we-text);padding:0 8px}@media(max-width:900px){.we-location-select{min-width:128px;max-width:160px}.we-toolbar-actions .we-location-tools button{display:inline-block}}';
  document.head.append(style);
  return { group, select, goButton, style };
}

export function installEditorLocationNavigator(api, liveSurface = window.__WESTEROS_EDITOR_LIVE_WORLD__, authoring = window.__WESTEROS_EDITOR_LIVE_AUTHORING__) {
  if (!api?.camera || !api?.orbitControls) throw new Error('Location navigator için editor camera/controls gerekli.');
  const seats = liveSurface?.liveState?.settlementSeats;
  if (!Array.isArray(seats) || seats.length === 0) throw new Error('Location navigator için settlement seats gerekli.');
  if (!authoring?.syncWorkingArea || !authoring?.groundHeight) throw new Error('Location navigator için live authoring gerekli.');
  if (window.__WESTEROS_EDITOR_LOCATION_NAV__) return window.__WESTEROS_EDITOR_LOCATION_NAV__;

  const ui = createUi(seats);
  const removers = [];
  let disposed = false;
  let lastLocationId = '__center__';

  function listen(target, type, handler, options) {
    target?.addEventListener?.(type, handler, options);
    removers.push(() => target?.removeEventListener?.(type, handler, options));
  }

  function resolveLocation(id) {
    if (id === '__center__') {
      const y = authoring.groundHeight(0, 0);
      return { id, name: 'Dünya Merkezi', x: 0, y, z: 0 };
    }
    const seat = seats.find((candidate) => candidate.id === id);
    if (!seat) return null;
    return { id: seat.id, name: seat.name, x: seat.x, y: seat.groundY, z: seat.z };
  }

  function navigateTo(id = ui.select.value) {
    if (disposed) return false;
    const location = resolveLocation(id);
    if (!location) return false;
    lastLocationId = location.id;
    ui.select.value = location.id;
    api.orbitControls.target.set(location.x, location.y, location.z);
    api.camera.position.set(
      location.x + CAMERA_HORIZONTAL_OFFSET_METERS,
      location.y + CAMERA_VERTICAL_OFFSET_METERS,
      location.z + CAMERA_HORIZONTAL_OFFSET_METERS
    );
    api.camera.lookAt(location.x, location.y, location.z);
    api.orbitControls.update();
    authoring.syncWorkingArea();
    return true;
  }

  function getSnapshot() {
    const location = resolveLocation(lastLocationId);
    return Object.freeze({
      locationId: lastLocationId,
      locationName: location?.name || null,
      target: Object.freeze(api.orbitControls.target.toArray()),
      camera: Object.freeze(api.camera.position.toArray()),
      seatCount: seats.length
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    removers.splice(0).reverse().forEach((remove) => remove());
    ui.group.remove();
    ui.style.remove();
    if (window.__WESTEROS_EDITOR_LOCATION_NAV__ === surface) delete window.__WESTEROS_EDITOR_LOCATION_NAV__;
  }

  listen(ui.goButton, 'click', () => navigateTo());
  listen(ui.select, 'change', () => navigateTo(ui.select.value));
  listen(window, 'pagehide', dispose, { once: true });

  const surface = Object.freeze({ navigateTo, getSnapshot, dispose });
  window.__WESTEROS_EDITOR_LOCATION_NAV__ = surface;
  return surface;
}

const api = window.__WESTEROS_WORLD_EDITOR__;
const liveSurface = window.__WESTEROS_EDITOR_LIVE_WORLD__;
const authoring = window.__WESTEROS_EDITOR_LIVE_AUTHORING__;
if (api && liveSurface && authoring) {
  try {
    installEditorLocationNavigator(api, liveSurface, authoring);
  } catch (error) {
    console.error('[EditorLocationNavigator] boot failed', error);
  }
}
