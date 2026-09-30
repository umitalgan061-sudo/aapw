export interface LegacySurface {
  readonly legacy: string;
  readonly typed: string;
  readonly shim: string;
  readonly owner: 'typed' | 'legacy';
  readonly importBoundary: 'typed' | 'shim' | 'unknown';
}

export interface LegacyAuditReport {
  readonly total: number;
  readonly typedOwners: number;
  readonly legacyOwners: number;
  readonly typedImports: number;
  readonly unknownImports: number;
  readonly violations: readonly string[];
  readonly ready: boolean;
}

export class LegacySurfaceAudit {
  #surfaces = new Map<string, LegacySurface>();

  register(surface: LegacySurface): void {
    if (!surface.legacy || !surface.typed) throw new RangeError('Legacy audit paths are required');
    this.#surfaces.set(surface.legacy, { ...surface });
  }

  registerMany(surfaces: readonly LegacySurface[]): void {
    for (const surface of surfaces) this.register(surface);
  }

  audit(): LegacyAuditReport {
    const violations: string[] = [];
    let typedOwners = 0;
    let legacyOwners = 0;
    let typedImports = 0;
    let unknownImports = 0;

    for (const surface of this.#surfaces.values()) {
      if (!surface.typed.endsWith('.ts') && !surface.typed.endsWith('.tsx')) {
        violations.push('typed-owner-not-typescript:' + surface.typed);
      }
      if (surface.owner === 'typed') typedOwners++;
      else {
        legacyOwners++;
        violations.push('legacy-production-owner:' + surface.legacy);
      }
      if (surface.importBoundary === 'typed') typedImports++;
      else if (surface.importBoundary === 'unknown') {
        unknownImports++;
        violations.push('unknown-import-boundary:' + surface.legacy);
      } else if (surface.importBoundary === 'legacy') {
        violations.push('legacy-import-boundary:' + surface.legacy);
      }
    }

    violations.sort();
    return {
      total: this.#surfaces.size,
      typedOwners,
      legacyOwners,
      typedImports,
      unknownImports,
      violations,
      ready: violations.length === 0,
    };
  }

  manifest(): readonly LegacySurface[] {
    return [...this.#surfaces.values()]
      .sort((a, b) => a.legacy.localeCompare(b.legacy))
      .map((surface) => ({ ...surface }));
  }
}

export interface ImportBoundaryResult {
  readonly typed: readonly string[];
  readonly shim: readonly string[];
  readonly legacy: readonly string[];
  readonly unknown: readonly string[];
}

export function classifyImports(
  imports: readonly { readonly source: string; readonly kind: 'static' | 'dynamic' }[],
): ImportBoundaryResult {
  const typed: string[] = [];
  const shim: string[] = [];
  const legacy: string[] = [];
  const unknown: string[] = [];

  for (const item of imports) {
    if (item.source.endsWith('.ts') || item.source.endsWith('.tsx')) typed.push(item.source);
    else if (item.source.endsWith('.js') && item.source.includes('legacy')) legacy.push(item.source);
    else if (item.source.endsWith('.js')) shim.push(item.source);
    else unknown.push(item.source);
  }

  return {
    typed: [...new Set(typed)].sort(),
    shim: [...new Set(shim)].sort(),
    legacy: [...new Set(legacy)].sort(),
    unknown: [...new Set(unknown)].sort(),
  };
}
