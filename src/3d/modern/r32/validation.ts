import {AssetDescriptor,RuntimeConfigR32,RuntimeError,RuntimeMode,TaskLane,TaskPriority,clampFinite} from './contracts.ts';
const lanes:readonly TaskLane[]=['simulation','world','render','network','assets','telemetry'];const priorities:readonly TaskPriority[]=['critical','high','normal','low','background'];
export interface ValidationIssue{readonly code:string;readonly path:string;readonly message:string;readonly severity:'error'|'warning';}
export interface ValidationReport{readonly valid:boolean;readonly issues:readonly ValidationIssue[];readonly targetHz:number;}
export function validateConfig(config:RuntimeConfigR32):ValidationReport{
  const issues:ValidationIssue[]=[];
  if(config.fixedStepSeconds<=0||config.fixedStepSeconds>0.25)issues.push({code:'R32_CONFIG_STEP',path:'fixedStepSeconds',message:'Fixed step is outside supported range.',severity:'error'});
  if(config.maxCatchUpSteps<1||config.maxCatchUpSteps>32)issues.push({code:'R32_CONFIG_CATCHUP',path:'maxCatchUpSteps',message:'Catch-up limit is outside supported range.',severity:'error'});
  for(const lane of lanes){const b=config.budgets[lane];if(b.lane!==lane)issues.push({code:'R32_CONFIG_LANE',path:'budgets.'+lane,message:'Lane key does not match budget lane.',severity:'error'});if(b.hardMilliseconds<b.softMilliseconds)issues.push({code:'R32_CONFIG_BUDGET',path:'budgets.'+lane,message:'Hard budget must not be below soft budget.',severity:'error'});}
  if(config.assets.byteBudget<=0||config.assets.recordLimit<=0)issues.push({code:'R32_CONFIG_ASSET',path:'assets',message:'Asset limits must be positive.',severity:'error'});
  if(config.network.maxPacketBytes<=0||config.network.maxInFlight<=0)issues.push({code:'R32_CONFIG_NETWORK',path:'network',message:'Network limits must be positive.',severity:'error'});
  return{valid:!issues.some(i=>i.severity==='error'),issues,targetHz:clampFinite(1/config.fixedStepSeconds,1,240)};
}
export function validateAssetDescriptor(d:AssetDescriptor):void{
  const invalid:string[]=[];if(!d.id)invalid.push('id');if(!d.url)invalid.push('url');if(d.maxBytes<=0||!Number.isFinite(d.maxBytes))invalid.push('maxBytes');if(!Number.isInteger(d.version)||d.version<0)invalid.push('version');if(!priorities.includes(d.priority))invalid.push('priority');
  if(invalid.length)throw new RuntimeError({code:'R32_ASSET_DESCRIPTOR',message:'Invalid asset descriptor fields: '+invalid.join(', '),recoverable:false});
}
export const isRuntimeMode=(value:unknown):value is RuntimeMode=>value==='booting'||value==='running'||value==='paused'||value==='recovering'||value==='stopping'||value==='stopped';
export const isTaskLane=(value:unknown):value is TaskLane=>typeof value==='string'&&lanes.includes(value as TaskLane);
