import { hashJson, stableSerialize, clamp } from './deterministic';

export interface ContentRecord { readonly id: string; readonly version: number; readonly type: string; readonly payload: Readonly<Record<string, unknown>>; readonly digest: string; }
export interface ContentValidation { readonly accepted: boolean; readonly errors: readonly string[]; readonly warnings: readonly string[]; }

export class ContentRegistry {
  #items = new Map<string, ContentRecord>();
  register(record: Omit<ContentRecord, 'digest'>): ContentRecord | null {
    if (!/^[A-Za-z0-9_.:-]{1,96}$/.test(record.id) || record.version < 1 || record.payload === null) return null;
    const digest = hashJson({ id: record.id, version: record.version, type: record.type, payload: record.payload });
    const next = Object.freeze({ ...record, digest });
    const current = this.#items.get(record.id);
    if (current && current.version >= record.version) return current;
    this.#items.set(record.id, next); return next;
  }
  get(id: string): ContentRecord | null { return this.#items.get(id) ?? null; }
  remove(id: string): boolean { return this.#items.delete(id); }
  validate(id: string): ContentValidation {
    const item = this.#items.get(id); if (!item) return Object.freeze({ accepted: false, errors: ['missing content'], warnings: [] });
    const errors: string[] = []; const warnings: string[] = [];
    if (item.type.length === 0 || item.type.length > 64) errors.push('invalid content type');
    if (stableSerialize(item.payload).length > 65536) errors.push('payload exceeds content budget');
    if (item.version > 1000000) warnings.push('unusually high content version');
    return Object.freeze({ accepted: errors.length === 0, errors: Object.freeze(errors), warnings: Object.freeze(warnings) });
  }
  ids(): readonly string[] { return Object.freeze([...this.#items.keys()].sort()); }
  clear(): void { this.#items.clear(); }
}
export function clampContentPriority(priority: number): number { return clamp(priority, 0, 100); }
