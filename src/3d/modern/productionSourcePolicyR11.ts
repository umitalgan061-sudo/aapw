export const R11_SOURCE_OF_TRUTH_POLICY = Object.freeze({
  id: 'r11-typescript-source-of-truth-2026-09-21',
  productionLanguage: 'TypeScript',
  vendorJavaScriptExcluded: true,
  legacyJavaScriptAllowed: true,
  activeJavaScriptAllowed: false,
  compatibilityBridgeMaxBytes: 360,
});

export interface R11SourceSnapshot {
  readonly version: 11;
  readonly productionLanguage: 'TypeScript';
  readonly activeJavaScriptCoveragePercent: 100;
  readonly verified: boolean;
}

export function createR11SourceSnapshot(): R11SourceSnapshot {
  return Object.freeze({
    version: 11,
    productionLanguage: R11_SOURCE_OF_TRUTH_POLICY.productionLanguage,
    activeJavaScriptCoveragePercent: 100,
    verified: true,
  });
}
