/** R11 strict TypeScript hardening ledger for adaptive rendering policies. */
export const R11_STRICT_RENDER_MODULES = Object.freeze([
  { id:'gpu-pressure', legacyPath:'src/3d/rendering/gpuPressureModel.js', typedPath:'src/3d/rendering/gpuPressureModel.ts', status:'strict' },
  { id:'render-pass-budget', legacyPath:'src/3d/rendering/renderPassBudgetPlanner.js', typedPath:'src/3d/rendering/renderPassBudgetPlanner.ts', status:'strict' },
  { id:'dynamic-resolution', legacyPath:'src/3d/rendering/dynamicResolutionGovernor.js', typedPath:'src/3d/rendering/dynamicResolutionGovernor.ts', status:'strict' },
] as const);
export interface R11StrictRenderSnapshot{readonly version:11;readonly strictCount:number;readonly totalTracked:number;readonly coveragePercent:number;}
export function getR11StrictRenderSnapshot():R11StrictRenderSnapshot{
 const totalTracked=R11_STRICT_RENDER_MODULES.length,strictCount=R11_STRICT_RENDER_MODULES.filter(m=>m.status==='strict').length;
 return Object.freeze({version:11,strictCount,totalTracked,coveragePercent:totalTracked===0?100:Number(((strictCount/totalTracked)*100).toFixed(2))});
}
