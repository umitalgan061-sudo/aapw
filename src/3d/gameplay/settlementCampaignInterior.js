/**
 * Settlement interior/POI contract.
 * Connects authored service roles to stable interaction and placement metadata.
 * Scene and asset loading remain owned by existing world systems.
 */
import { getSettlementService } from './settlementCampaignContent.js';
export const SETTLEMENT_INTERIOR_CONTRACT_VERSION=1;
const text=(value,fallback='')=>{const v=String(value??'').trim();return v?v.slice(0,160):fallback;};
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
export const SETTLEMENT_INTERIOR_ROLES=Object.freeze(['blacksmith','tavern','market','farm','barracks','stable','house','gate']);
const INTERIORS=Object.freeze({
  blacksmith:{id:'blacksmith-workshop',service:'blacksmith',room:'forge',entrance:'front-door',anchor:'settlement-blacksmith',activities:['craft','trade','equip'],propFamilies:['forge','anvil','barrel','rack','workbench']},
  tavern:{id:'tavern-hall',service:'tavern',room:'common-room',entrance:'front-door',anchor:'settlement-tavern',activities:['talk','acceptQuest','advanceQuest','rest'],propFamilies:['counter','table','bench','lantern','barrel']},
  market:{id:'market-stalls',service:'market',room:'market-square',entrance:'open-edge',anchor:'settlement-market',activities:['trade','buy','sell','talk'],propFamilies:['stall','crate','basket','cloth','sign']},
  farm:{id:'farm-yard',service:'farm',room:'farmyard',entrance:'farm-gate',anchor:'settlement-farm',activities:['interact','trade','rest','travel'],propFamilies:['barn','cart','fence','hay','trough']},
  barracks:{id:'barracks-yard',service:'barracks',room:'training-yard',entrance:'barracks-door',anchor:'settlement-barracks',activities:['talk','train','acceptQuest','equip'],propFamilies:['rack','target','table','banner','chest']},
  stable:{id:'stable-yard',service:'stable',room:'stable',entrance:'stable-door',anchor:'settlement-stable',activities:['talk','trade','travel','rest'],propFamilies:['stall','trough','saddle-rack','hay','gate']},
  house:{id:'house-interior',service:'house',room:'living-room',entrance:'house-door',anchor:'settlement-house',activities:['interact','talk','save','rest'],propFamilies:['bed','chest','table','hearth','shelf']},
  gate:{id:'settlement-gate',service:'gate',room:'gatehouse',entrance:'main-gate',anchor:'settlement-gate',activities:['enter','exit','travel'],propFamilies:['gate','tower','torch','road-marker','barricade']},
});
const TRANSITIONS=Object.freeze({
  enter:{sourceKinds:['settlement','door'],targetKinds:['interior'],event:'settlement:enter'},
  exit:{sourceKinds:['interior','door'],targetKinds:['settlement'],event:'settlement:exit'},
  travel:{sourceKinds:['gate','stable'],targetKinds:['travel'],event:'settlement:travel'},
});
const placementId=(role,family,index)=>`settlement:${text(role)}:${text(family)}:${index}`;
export function getSettlementInterior(role){const value=INTERIORS[role];return value?{...clone(value),activities:[...value.activities],propFamilies:[...value.propFamilies]}:null;}
export function listSettlementInteriors(){return[...SETTLEMENT_INTERIOR_ROLES];}
export function buildSettlementInteriorCard(role){const interior=getSettlementInterior(role);if(!interior)return null;const service=getSettlementService(role);return{version:1,id:interior.id,service:service?clone(service):null,room:interior.room,entrance:interior.entrance,anchor:interior.anchor,activities:interior.activities.map(action=>({action,owner:service?.domain??role})),placementFamilies:interior.propFamilies.map((family,index)=>({family,placementId:placementId(role,family,index),sourceRequired:true,materialContractRequired:true}))};}
export function buildSettlementInteriorManifest(){return{version:1,interiors:SETTLEMENT_INTERIOR_ROLES.map(buildSettlementInteriorCard),transitions:clone(TRANSITIONS),placementOrder:['source-asset','material-assignment','placement-validation','ground-alignment','manifest','scene-attachment']};}
export function validateSettlementInteriorContract(manifest=buildSettlementInteriorManifest()){const errors=[];if(manifest.version!==1)errors.push('version');if(!Array.isArray(manifest.interiors))errors.push('interiors');const ids=new Set();for(const card of manifest.interiors??[]){if(!card?.id)errors.push('missing-interior-id');if(ids.has(card.id))errors.push(`duplicate:${card.id}`);ids.add(card.id);if(!card.service)errors.push(`service:${card.id}`);if(!card.placementFamilies?.length)errors.push(`placement:${card.id}`);for(const placement of card.placementFamilies??[]){if(!placement.sourceRequired)errors.push(`source:${placement.placementId}`);if(!placement.materialContractRequired)errors.push(`material:${placement.placementId}`);}}if(manifest.placementOrder?.at(-1)!=='scene-attachment')errors.push('attachment-order');return{ok:errors.length===0,errors};}
export function resolveSettlementInteriorAction(role,action){const interior=getSettlementInterior(role);if(!interior)return{ok:false,reason:'unknown-interior'};if(!interior.activities.includes(action))return{ok:false,reason:'action-not-supported',role,action};return{ok:true,role,action,service:interior.service,room:interior.room};}
export function resolveSettlementTransition(type,context={}){const transition=TRANSITIONS[type];if(!transition)return{ok:false,reason:'unknown-transition'};const sourceKind=text(context.sourceKind);const targetKind=text(context.targetKind);if(!transition.sourceKinds.includes(sourceKind))return{ok:false,reason:'invalid-source-kind'};if(!transition.targetKinds.includes(targetKind))return{ok:false,reason:'invalid-target-kind'};return{ok:true,type,event:transition.event,sourceKind,targetKind,sourceId:text(context.sourceId),targetId:text(context.targetId)};}
export function buildPlacementEvidence(role,context={}){const interior=getSettlementInterior(role);if(!interior)return{ok:false,reason:'unknown-interior'};if(!text(context.sourceAsset))return{ok:false,reason:'missing-source-asset'};return{ok:true,settlementRole:role,sourceAsset:text(context.sourceAsset),material:{assignmentRequired:true,validated:Boolean(context.materialValidated),manifestId:text(context.materialManifestId)},placement:{anchor:interior.anchor,groundAligned:Boolean(context.groundAligned),foundationRequired:Boolean(context.foundationRequired),scale:Number.isFinite(Number(context.scale))?Number(context.scale):null,orientation:text(context.orientation,'canonical')},evidence:{manifestProduced:Boolean(context.manifestProduced),sceneAttached:Boolean(context.sceneAttached)}};}
export function validatePlacementEvidence(evidence){const errors=[];if(!evidence?.ok)errors.push('evidence');if(!evidence?.sourceAsset)errors.push('source-asset');if(evidence?.material?.validated!==true)errors.push('material-validation');if(!evidence?.material?.manifestId)errors.push('material-manifest');if(evidence?.placement?.groundAligned!==true)errors.push('ground-alignment');if(evidence?.evidence?.manifestProduced!==true)errors.push('placement-manifest');return{ok:errors.length===0,errors};}
