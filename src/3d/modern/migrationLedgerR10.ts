/** R10 strict-TypeScript hardening ledger for runtime-facing UI/safety modules. */
export const R10_STRICT_MODULES = Object.freeze([
  { id:'interaction-prompt', path:'src/3d/ui/interactionPrompt.ts', status:'strict' },
  { id:'touch-joystick', path:'src/3d/ui/touchJoystick.ts', status:'strict' },
  { id:'health-bar', path:'src/3d/ui/healthBar.ts', status:'strict' },
  { id:'safe-mode', path:'src/3d/safeMode.ts', status:'strict' },
] as const);
export interface R10StrictSnapshot {
  readonly version:10;
  readonly strictCount:number;
  readonly totalTracked:number;
  readonly coveragePercent:number;
}
export function getR10StrictSnapshot():R10StrictSnapshot {
  const totalTracked=R10_STRICT_MODULES.length;
  const strictCount=R10_STRICT_MODULES.filter((module)=>module.status==='strict').length;
  return Object.freeze({version:10,strictCount,totalTracked,coveragePercent:totalTracked===0?100:Number(((strictCount/totalTracked)*100).toFixed(2))});
}
