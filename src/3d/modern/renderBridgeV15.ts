/** Renderer-neutral frame packet bridge for WebGL/WebGPU and future native adapters. */
export type RenderBackendV15='webgl'|'webgl2'|'webgpu'|'unknown';
export interface RenderCapabilitiesV15{readonly backend:RenderBackendV15;readonly maxTextureSize:number;readonly maxSamples:number;readonly supportsCompute:boolean;readonly supportsTimestampQuery:boolean;readonly supportsInstancing:boolean;readonly supportsFloatTargets:boolean;}
export interface RenderBudgetV15{readonly frameMs:number;readonly drawCalls:number;readonly triangles:number;readonly instances:number;readonly textureBytes:number;readonly shadowCasters:number;readonly postEffects:number;}
export interface RenderPacketV15{readonly frame:number;readonly tick:number;readonly camera:{readonly x:number;readonly y:number;readonly z:number;readonly fov:number;readonly near:number;readonly far:number};readonly layers:readonly RenderLayerV15[];readonly budget:RenderBudgetV15;readonly qualityScale:number;}
export interface RenderLayerV15{readonly id:string;readonly visible:boolean;readonly priority:number;readonly drawCalls:number;readonly triangles:number;readonly instances:number;readonly materialGroup:string;readonly distance:number;readonly castsShadow:boolean;}
export interface RenderDecisionV15{readonly accepted:readonly string[];readonly culled:readonly string[];readonly budget:RenderBudgetV15;readonly qualityScale:number;readonly overBudget:boolean;}

const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,Number.isFinite(v)?v:a));

export class RenderBridgeV15{
  readonly #capabilities:RenderCapabilitiesV15;
  #qualityScale=1;
  #lastDecision:RenderDecisionV15={accepted:[],culled:[],budget:{frameMs:0,drawCalls:0,triangles:0,instances:0,textureBytes:0,shadowCasters:0,postEffects:0},qualityScale:1,overBudget:false};
  constructor(capabilities:RenderCapabilitiesV15){this.#capabilities=Object.freeze({...capabilities,maxTextureSize:Math.max(1,Math.trunc(capabilities.maxTextureSize)),maxSamples:Math.max(1,Math.trunc(capabilities.maxSamples)),});}
  get capabilities():RenderCapabilitiesV15{return this.#capabilities;}
  setQualityScale(scale:number):number{this.#qualityScale=clamp(scale,.5,1);return this.#qualityScale;}
  qualityScale():number{return this.#qualityScale;}

  build(packet:RenderPacketV15):RenderDecisionV15{
    const layers=[...packet.layers].filter((layer)=>layer.visible).sort((a,b)=>b.priority-a.priority||a.distance-b.distance||a.id.localeCompare(b.id));
    const budget=Object.freeze({...packet.budget});
    const drawLimit=Math.max(1,Math.floor(packet.budget.drawCalls*this.#qualityScale));
    const triangleLimit=Math.max(1,Math.floor(packet.budget.triangles*this.#qualityScale));
    const instanceLimit=Math.max(1,Math.floor(packet.budget.instances*this.#qualityScale));
    let draws=0,triangles=0,instances=0;const accepted:string[]=[],culled:string[]=[];
    for(const layer of layers){const nextDraws=draws+Math.max(0,Math.trunc(layer.drawCalls)),nextTriangles=triangles+Math.max(0,Math.trunc(layer.triangles)),nextInstances=instances+Math.max(0,Math.trunc(layer.instances));if(nextDraws<=drawLimit&&nextTriangles<=triangleLimit&&nextInstances<=instanceLimit){accepted.push(layer.id);draws=nextDraws;triangles=nextTriangles;instances=nextInstances;}else culled.push(layer.id);}
    const overBudget=packet.budget.drawCalls>drawLimit||packet.budget.triangles>triangleLimit||packet.budget.instances>instanceLimit;
    this.#lastDecision=Object.freeze({accepted:Object.freeze(accepted),culled:Object.freeze(culled),budget:Object.freeze({...budget,drawCalls:draws,triangles:triangles,instances:instances}),qualityScale:this.#qualityScale,overBudget});
    return this.#lastDecision;
  }

  negotiate(requested:Readonly<{webgpu?:boolean;msaa?:number;textureSize?:number;compute?:boolean}>={}):Readonly<{backend:RenderBackendV15;msaa:number;textureSize:number;compute:boolean;qualityScale:number}>{
    const backend=requested.webgpu&&this.#capabilities.backend==='webgpu'?'webgpu':this.#capabilities.backend==='unknown'?'webgl2':this.#capabilities.backend;
    return Object.freeze({backend,msaa:Math.min(this.#capabilities.maxSamples,Math.max(1,Math.trunc(requested.msaa??1))),textureSize:Math.min(this.#capabilities.maxTextureSize,Math.max(256,Math.trunc(requested.textureSize??2048))),compute:Boolean(requested.compute&&this.#capabilities.supportsCompute),qualityScale:this.#qualityScale});
  }

  lastDecision():RenderDecisionV15{return this.#lastDecision;}
  reset():void{this.#qualityScale=1;this.#lastDecision={accepted:[],culled:[],budget:{frameMs:0,drawCalls:0,triangles:0,instances:0,textureBytes:0,shadowCasters:0,postEffects:0},qualityScale:1,overBudget:false};}
}

export const detectRenderCapabilitiesV15=(gl:WebGLRenderingContext|WebGL2RenderingContext|undefined):RenderCapabilitiesV15=>{
  if(!gl)return Object.freeze({backend:'unknown',maxTextureSize:2048,maxSamples:1,supportsCompute:false,supportsTimestampQuery:false,supportsInstancing:false,supportsFloatTargets:false});
  const isWebgl2=typeof WebGL2RenderingContext!=='undefined'&&gl instanceof WebGL2RenderingContext;
  const maxTextureSize=Number(gl.getParameter(gl.MAX_TEXTURE_SIZE))||2048;
  const samples=isWebgl2?Number(gl.getParameter(gl.MAX_SAMPLES))||1:1;
  return Object.freeze({backend:isWebgl2?'webgl2':'webgl',maxTextureSize,maxSamples:samples,supportsCompute:false,supportsTimestampQuery:false,supportsInstancing:isWebgl2||Boolean(gl.getExtension('ANGLE_instanced_arrays')),supportsFloatTargets:Boolean(isWebgl2||gl.getExtension('OES_texture_float'))});
};
