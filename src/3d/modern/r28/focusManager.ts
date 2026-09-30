export type FocusScope = 'game' | 'menu' | 'dialogue' | 'settings' | 'debug';

export interface FocusTarget {
  readonly id: string;
  readonly scope: FocusScope;
  readonly order: number;
  readonly disabled?: boolean;
  readonly element?: HTMLElement;
}

export class RuntimeFocusManager {
  #scope: FocusScope = 'game';
  #targets = new Map<string, FocusTarget>();
  #current: string | null = null;

  register(target: FocusTarget): void {
    if (!target.id.trim()) throw new RangeError('Focus target id is required');
    this.#targets.set(target.id, target);
  }

  remove(id: string): boolean {
    if (this.#current === id) this.#current = null;
    return this.#targets.delete(id);
  }

  setScope(scope: FocusScope): void {
    this.#scope = scope;
    const current = this.#targets.get(this.#current ?? '');
    if (!current || current.scope !== scope || current.disabled) this.#current = null;
  }

  current(): FocusTarget | undefined {
    return this.#current ? this.#targets.get(this.#current) : undefined;
  }

  focus(id: string): boolean {
    const target = this.#targets.get(id);
    if (!target || target.disabled || target.scope !== this.#scope) return false;
    this.#current = id;
    target.element?.focus?.();
    return true;
  }

  focusNext(direction: 1 | -1 = 1): FocusTarget | undefined {
    const candidates = [...this.#targets.values()]
      .filter((target) => target.scope === this.#scope && !target.disabled)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    if (candidates.length === 0) return undefined;
    const currentIndex = candidates.findIndex((target) => target.id === this.#current);
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : candidates.length - 1
      : (currentIndex + direction + candidates.length) % candidates.length;
    const next = candidates[nextIndex];
    if (!next) return undefined;
    this.#current = next.id;
    next.element?.focus?.();
    return next;
  }

  trap(container: HTMLElement): () => void {
    const listener = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const target = event.target;
      if (!(target instanceof Node) || !container.contains(target)) {
        event.preventDefault();
        this.focusNext(event.shiftKey ? -1 : 1);
      }
    };
    document.addEventListener('keydown', listener, true);
    return () => document.removeEventListener('keydown', listener, true);
  }

  announce(message: string, politeness: 'polite' | 'assertive' = 'polite'): void {
    const live = document.createElement('div');
    live.setAttribute('aria-live', politeness);
    live.setAttribute('role', 'status');
    live.style.cssText = 'position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden;';
    live.textContent = message.slice(0, 512);
    document.body.appendChild(live);
    window.setTimeout(() => live.remove(), 1500);
  }
}
