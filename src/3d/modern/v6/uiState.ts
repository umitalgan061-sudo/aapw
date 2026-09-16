/**
 * V6 UI state and presentation projection layer.
 * Pure state transitions, selectors, notification queues and accessibility
 * metadata. DOM/framework rendering is deliberately outside this module.
 */

export type Screen = 'game' | 'pause' | 'inventory' | 'map' | 'settings' | 'codex' | 'loading';
export type Modal = 'none' | 'confirm' | 'error' | 'keybind' | 'quit';
export type ToastKind = 'info' | 'success' | 'warning' | 'error';
export type InputMode = 'keyboard' | 'gamepad' | 'touch';

export interface UiToast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
  readonly createdTick: number;
  readonly expiresTick: number;
  readonly priority: number;
}

export interface UiDialog {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly destructive: boolean;
}

export interface HudState {
  readonly health: number;
  readonly maxHealth: number;
  readonly stamina: number;
  readonly maxStamina: number;
  readonly level: number;
  readonly experience: number;
  readonly nextExperience: number;
  readonly location: string;
  readonly objective?: string;
  readonly combat: boolean;
}

export interface InventoryItemView {
  readonly id: string;
  readonly name: string;
  readonly quantity: number;
  readonly selected: boolean;
  readonly usable: boolean;
  readonly equipped: boolean;
  readonly rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
}

export interface UiState {
  readonly screen: Screen;
  readonly modal: Modal;
  readonly dialog?: UiDialog;
  readonly inputMode: InputMode;
  readonly hud: HudState;
  readonly inventory: readonly InventoryItemView[];
  readonly selectedInventoryId?: string;
  readonly toasts: readonly UiToast[];
  readonly loadingProgress: number;
  readonly loadingLabel: string;
  readonly paused: boolean;
  readonly tick: number;
  readonly revision: number;
}

export type UiAction =
  | { readonly type: 'screen/open'; readonly screen: Screen }
  | { readonly type: 'screen/back' }
  | { readonly type: 'modal/open'; readonly modal: Modal; readonly dialog?: UiDialog }
  | { readonly type: 'modal/close' }
  | { readonly type: 'input/mode'; readonly mode: InputMode }
  | { readonly type: 'hud/update'; readonly patch: Partial<HudState> }
  | { readonly type: 'inventory/set'; readonly items: readonly InventoryItemView[] }
  | { readonly type: 'inventory/select'; readonly id?: string }
  | { readonly type: 'toast/add'; readonly toast: Omit<UiToast, 'id'> }
  | { readonly type: 'toast/remove'; readonly id: number }
  | { readonly type: 'loading/set'; readonly progress: number; readonly label?: string }
  | { readonly type: 'tick'; readonly tick: number }
  | { readonly type: 'pause/set'; readonly paused: boolean };

const INITIAL_HUD: HudState = {
  health: 100,
  maxHealth: 100,
  stamina: 100,
  maxStamina: 100,
  level: 1,
  experience: 0,
  nextExperience: 100,
  location: 'Unknown lands',
  combat: false,
};

function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function integer(value: number, fallback = 0): number { return Number.isSafeInteger(value) ? value : fallback; }
function safeText(value: string, fallback = ''): string { return value.trim().slice(0, 240) || fallback; }

function immutableItems(items: readonly InventoryItemView[]): InventoryItemView[] {
  return [...items]
    .filter((item) => item.id.length > 0)
    .map((item) => ({ ...item, quantity: Math.max(0, Math.floor(item.quantity)) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function cleanToast(toast: Omit<UiToast, 'id'>): Omit<UiToast, 'id'> {
  return {
    kind: toast.kind,
    message: safeText(toast.message),
    createdTick: Math.max(0, integer(toast.createdTick)),
    expiresTick: Math.max(integer(toast.createdTick), integer(toast.expiresTick)),
    priority: clamp(Number.isFinite(toast.priority) ? toast.priority : 0, -100, 100),
  };
}

export function createInitialUiState(): UiState {
  return {
    screen: 'game',
    modal: 'none',
    inputMode: 'keyboard',
    hud: { ...INITIAL_HUD },
    inventory: [],
    toasts: [],
    loadingProgress: 0,
    loadingLabel: '',
    paused: false,
    tick: 0,
    revision: 0,
  };
}

const SCREEN_BACK: Readonly<Record<Screen, Screen>> = {
  game: 'game',
  pause: 'game',
  inventory: 'game',
  map: 'game',
  settings: 'pause',
  codex: 'game',
  loading: 'game',
};

function nextRevision(state: UiState, patch: Omit<UiState, 'revision'>): UiState {
  return Object.freeze({ ...patch, revision: state.revision + 1 });
}

export function reduceUi(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'screen/open': {
      const screen = action.screen;
      const paused = screen === 'pause' || screen === 'settings';
      return nextRevision(state, { ...state, screen, paused, modal: 'none', dialog: undefined });
    }
    case 'screen/back': {
      const screen = SCREEN_BACK[state.screen];
      const paused = screen === 'pause' || screen === 'settings';
      return nextRevision(state, { ...state, screen, paused, modal: 'none', dialog: undefined });
    }
    case 'modal/open':
      return nextRevision(state, { ...state, modal: action.modal, dialog: action.dialog ? { ...action.dialog } : undefined });
    case 'modal/close':
      return nextRevision(state, { ...state, modal: 'none', dialog: undefined });
    case 'input/mode':
      return nextRevision(state, { ...state, inputMode: action.mode });
    case 'hud/update': {
      const merged = { ...state.hud, ...action.patch };
      const maxHealth = Math.max(1, Number(merged.maxHealth) || 1);
      const maxStamina = Math.max(1, Number(merged.maxStamina) || 1);
      return nextRevision(state, {
        ...state,
        hud: {
          ...merged,
          health: clamp(Number(merged.health) || 0, 0, maxHealth),
          maxHealth,
          stamina: clamp(Number(merged.stamina) || 0, 0, maxStamina),
          maxStamina,
          level: Math.max(1, Math.floor(Number(merged.level) || 1)),
          experience: Math.max(0, Number(merged.experience) || 0),
          nextExperience: Math.max(1, Number(merged.nextExperience) || 1),
          location: safeText(merged.location, 'Unknown lands'),
          objective: merged.objective ? safeText(merged.objective) : undefined,
          combat: Boolean(merged.combat),
        },
      });
    }
    case 'inventory/set':
      return nextRevision(state, { ...state, inventory: immutableItems(action.items), selectedInventoryId: action.items.find((item) => item.selected)?.id });
    case 'inventory/select': {
      const selected = action.id && state.inventory.some((item) => item.id === action.id) ? action.id : undefined;
      const inventory = state.inventory.map((item) => ({ ...item, selected: item.id === selected }));
      return nextRevision(state, { ...state, inventory, selectedInventoryId: selected });
    }
    case 'toast/add': {
      const toast = cleanToast(action.toast);
      const nextId = state.toasts.reduce((max, item) => Math.max(max, item.id), 0) + 1;
      const withId: UiToast = { id: nextId, ...toast };
      const toasts = [...state.toasts, withId].sort((a, b) => b.priority - a.priority || a.id - b.id).slice(0, 8);
      return nextRevision(state, { ...state, toasts });
    }
    case 'toast/remove':
      return nextRevision(state, { ...state, toasts: state.toasts.filter((toast) => toast.id !== action.id) });
    case 'loading/set':
      return nextRevision(state, { ...state, loadingProgress: clamp(action.progress, 0, 1), loadingLabel: safeText(action.label ?? state.loadingLabel) });
    case 'tick': {
      const tick = Math.max(state.tick, integer(action.tick));
      return nextRevision(state, { ...state, tick, toasts: state.toasts.filter((toast) => toast.expiresTick > tick) });
    }
    case 'pause/set':
      return nextRevision(state, { ...state, paused: action.paused, screen: action.paused ? 'pause' : 'game' });
    default:
      return state;
  }
}

export type UiSelector<T> = (state: UiState) => T;

export class UiStore {
  #state: UiState;
  readonly #listeners = new Set<(state: UiState) => void>();

  constructor(initial = createInitialUiState()) { this.#state = Object.freeze(initial); }
  get state(): UiState { return this.#state; }

  dispatch(action: UiAction): UiState {
    const next = reduceUi(this.#state, action);
    if (next === this.#state) return next;
    this.#state = next;
    for (const listener of [...this.#listeners]) listener(next);
    return next;
  }

  subscribe(listener: (state: UiState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  select<T>(selector: UiSelector<T>): T { return selector(this.#state); }
  reset(): void { this.#state = createInitialUiState(); for (const listener of [...this.#listeners]) listener(this.#state); }
}

export function hudHealthPercent(state: UiState): number { return clamp(state.hud.health / Math.max(1, state.hud.maxHealth), 0, 1); }
export function hudStaminaPercent(state: UiState): number { return clamp(state.hud.stamina / Math.max(1, state.hud.maxStamina), 0, 1); }
export function hudExperiencePercent(state: UiState): number { return clamp(state.hud.experience / Math.max(1, state.hud.nextExperience), 0, 1); }
export function selectedInventory(state: UiState): InventoryItemView | undefined { return state.inventory.find((item) => item.id === state.selectedInventoryId); }
export function visibleToasts(state: UiState): readonly UiToast[] { return state.toasts.filter((toast) => toast.expiresTick > state.tick); }

export interface UiA11yNode {
  readonly id: string;
  readonly role: string;
  readonly label: string;
  readonly value?: string;
  readonly hint?: string;
  readonly disabled?: boolean;
}

export function projectA11y(state: UiState): readonly UiA11yNode[] {
  const nodes: UiA11yNode[] = [
    { id: 'hud.health', role: 'meter', label: 'Health', value: `${Math.round(state.hud.health)}/${Math.round(state.hud.maxHealth)}` },
    { id: 'hud.stamina', role: 'meter', label: 'Stamina', value: `${Math.round(state.hud.stamina)}/${Math.round(state.hud.maxStamina)}` },
    { id: 'hud.location', role: 'status', label: 'Location', value: state.hud.location },
  ];
  if (state.hud.objective) nodes.push({ id: 'hud.objective', role: 'status', label: 'Objective', value: state.hud.objective });
  if (state.modal !== 'none' && state.dialog) nodes.push({ id: 'modal.dialog', role: 'dialog', label: state.dialog.title, value: state.dialog.body });
  return nodes;
}

export function serializeUi(state: UiState): string {
  return JSON.stringify({
    screen: state.screen,
    modal: state.modal,
    inputMode: state.inputMode,
    hud: state.hud,
    inventory: state.inventory,
    selectedInventoryId: state.selectedInventoryId,
    loadingProgress: state.loadingProgress,
    loadingLabel: state.loadingLabel,
    paused: state.paused,
    tick: state.tick,
  });
}
