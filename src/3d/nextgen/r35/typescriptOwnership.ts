export type OwnershipKind = 'typed' | 'compatibility' | 'legacy' | 'vendor' | 'untyped';

export interface OwnershipEntry {
  readonly path: string;
  readonly kind: OwnershipKind;
  readonly hasTypeScriptOwner: boolean;
  readonly hasCompatibilityMarker: boolean;
  readonly importsTypedOwner: boolean;
  readonly exportsNamedSurface: boolean;
}

export interface OwnershipFinding {
  readonly path: string;
  readonly severity: 'error' | 'warning';
  readonly code: 'missing-owner' | 'missing-marker' | 'missing-import' | 'missing-export' | 'active-javascript' | 'legacy-allowed' | 'vendor-allowed';
  readonly message: string;
}

export interface OwnershipReport {
  readonly ok: boolean;
  readonly scanned: number;
  readonly typed: number;
  readonly compatibility: number;
  readonly legacy: number;
  readonly vendor: number;
  readonly untyped: number;
  readonly findings: readonly OwnershipFinding[];
}

export interface OwnershipPolicy {
  readonly allowVendor: boolean;
  readonly allowLegacy: boolean;
  readonly requireCompatibilityMarker: boolean;
  readonly requireOwnerImport: boolean;
  readonly requireNamedExport: boolean;
}

const DEFAULT_POLICY: OwnershipPolicy = {
  allowVendor: true,
  allowLegacy: true,
  requireCompatibilityMarker: true,
  requireOwnerImport: true,
  requireNamedExport: true,
};

function isJavaScript(path: string): boolean {
  return path.endsWith('.js') || path.endsWith('.mjs');
}

export function evaluateTypeScriptOwnership(
  entries: readonly OwnershipEntry[],
  policy: Partial<OwnershipPolicy> = {},
): OwnershipReport {
  const rules = { ...DEFAULT_POLICY, ...policy };
  const findings: OwnershipFinding[] = [];
  let typed = 0;
  let compatibility = 0;
  let legacy = 0;
  let vendor = 0;
  let untyped = 0;

  for (const entry of entries) {
    if (entry.kind === 'typed') {
      typed += 1;
      continue;
    }
    if (entry.kind === 'legacy') {
      legacy += 1;
      if (!rules.allowLegacy) findings.push({
        path: entry.path, severity: 'error', code: 'legacy-allowed',
        message: 'legacy JavaScript is disabled by the active ownership policy',
      });
      continue;
    }
    if (entry.kind === 'vendor') {
      vendor += 1;
      if (!rules.allowVendor) findings.push({
        path: entry.path, severity: 'error', code: 'vendor-allowed',
        message: 'vendored JavaScript is disabled by the active ownership policy',
      });
      continue;
    }
    if (isJavaScript(entry.path) && entry.kind === 'compatibility') {
      compatibility += 1;
      if (rules.requireCompatibilityMarker && !entry.hasCompatibilityMarker) findings.push({
        path: entry.path, severity: 'error', code: 'missing-marker',
        message: 'JavaScript compatibility boundary is missing its marker',
      });
      if (rules.requireOwnerImport && !entry.importsTypedOwner) findings.push({
        path: entry.path, severity: 'error', code: 'missing-import',
        message: 'compatibility file does not import its TypeScript owner',
      });
      if (rules.requireNamedExport && !entry.exportsNamedSurface) findings.push({
        path: entry.path, severity: 'error', code: 'missing-export',
        message: 'compatibility file does not re-export its TypeScript owner surface',
      });
      if (!entry.hasTypeScriptOwner) findings.push({
        path: entry.path, severity: 'error', code: 'missing-owner',
        message: 'compatibility file has no TypeScript implementation owner',
      });
      continue;
    }
    untyped += 1;
    findings.push({
      path: entry.path,
      severity: isJavaScript(entry.path) ? 'error' : 'warning',
      code: 'active-javascript',
      message: isJavaScript(entry.path)
        ? 'active JavaScript implementation is not represented as a TypeScript-owned boundary'
        : 'source was classified as untyped; review ownership metadata',
    });
  }

  const errors = findings.filter((finding) => finding.severity === 'error');
  return Object.freeze({
    ok: errors.length === 0,
    scanned: entries.length,
    typed,
    compatibility,
    legacy,
    vendor,
    untyped,
    findings: Object.freeze(findings),
  });
}

export function summarizeOwnership(report: OwnershipReport): string {
  return '[ ' + (report.ok ? 'PASS' : 'FAIL') + ' ] typescript-ownership' +
    ' scanned=' + report.scanned +
    ' typed=' + report.typed +
    ' compatibility=' + report.compatibility +
    ' legacy=' + report.legacy +
    ' vendor=' + report.vendor +
    ' untyped=' + report.untyped +
    ' findings=' + report.findings.length;
}

export function createCompatibilityEntry(path: string, hasTypeScriptOwner = true): OwnershipEntry {
  return {
    path,
    kind: 'compatibility',
    hasTypeScriptOwner,
    hasCompatibilityMarker: true,
    importsTypedOwner: true,
    exportsNamedSurface: true,
  };
}

export function createTypedEntry(path: string): OwnershipEntry {
  return {
    path,
    kind: 'typed',
    hasTypeScriptOwner: true,
    hasCompatibilityMarker: false,
    importsTypedOwner: false,
    exportsNamedSurface: true,
  };
}

export function createLegacyEntry(path: string): OwnershipEntry {
  return {
    path,
    kind: 'legacy',
    hasTypeScriptOwner: false,
    hasCompatibilityMarker: false,
    importsTypedOwner: false,
    exportsNamedSurface: false,
  };
}

export function createVendorEntry(path: string): OwnershipEntry {
  return {
    path,
    kind: 'vendor',
    hasTypeScriptOwner: false,
    hasCompatibilityMarker: false,
    importsTypedOwner: false,
    exportsNamedSurface: false,
  };
}

export function mergeOwnershipReports(reports: readonly OwnershipReport[]): OwnershipReport {
  return Object.freeze({
    ok: reports.every((report) => report.ok),
    scanned: reports.reduce((sum, report) => sum + report.scanned, 0),
    typed: reports.reduce((sum, report) => sum + report.typed, 0),
    compatibility: reports.reduce((sum, report) => sum + report.compatibility, 0),
    legacy: reports.reduce((sum, report) => sum + report.legacy, 0),
    vendor: reports.reduce((sum, report) => sum + report.vendor, 0),
    untyped: reports.reduce((sum, report) => sum + report.untyped, 0),
    findings: Object.freeze(reports.flatMap((report) => report.findings)),
  });
}
