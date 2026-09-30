/** R22 strict UI ledger: player HUD and interaction HUD production owners are strict TypeScript. */
export const R22_STRICT_UI_MODULES = Object.freeze([
  { id: 'controls-help', legacyPath: 'src/3d/ui/controlsHelp.js', typedPath: 'src/3d/ui/controlsHelp.ts', implementationPath: 'src/3d/ui/controlsHelpLegacy.ts', status: 'strict' },
  { id: 'health-bar', legacyPath: 'src/3d/ui/healthBar.js', typedPath: 'src/3d/ui/healthBar.ts', implementationPath: 'src/3d/ui/healthBarLegacy.ts', status: 'strict' },
  { id: 'interaction-prompt', legacyPath: 'src/3d/ui/interactionPrompt.js', typedPath: 'src/3d/ui/interactionPrompt.ts', implementationPath: 'src/3d/ui/interactionPromptLegacy.ts', status: 'strict' },
  { id: 'settlement-compass', legacyPath: 'src/3d/ui/settlementCompass.js', typedPath: 'src/3d/ui/settlementCompass.ts', implementationPath: 'src/3d/ui/settlementCompassLegacy.ts', status: 'strict' },
] as const);

export interface R22StrictUiSnapshot {
  readonly version: 22;
  readonly strictCount: number;
  readonly totalTracked: number;
  readonly coveragePercent: number;
}

export function getR22StrictUiSnapshot(): R22StrictUiSnapshot {
  const totalTracked = R22_STRICT_UI_MODULES.length;
  const strictCount = R22_STRICT_UI_MODULES.filter((module) => module.status === 'strict').length;
  return Object.freeze({
    version: 22,
    strictCount,
    totalTracked,
    coveragePercent: totalTracked === 0 ? 100 : Number(((strictCount / totalTracked) * 100).toFixed(2)),
  });
}
