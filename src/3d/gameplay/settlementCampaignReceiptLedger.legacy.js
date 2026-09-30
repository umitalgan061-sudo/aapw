/**
 * Settlement economic receipt adapter.
 * Receipts prove operations against the existing economy, rather than owning it.
 */
import { resolveTradeQuote, resolveCraftingRecipe, getSettlementItem, getSettlementRecipe } from './settlementCampaignContent.js';
export const SETTLEMENT_RECEIPT_VERSION = 1;
const LIMIT = 64;
const text=(value,fallback='')=>{const v=String(value??'').trim();return v?v.slice(0,160):fallback;};
const integer=(value,fallback=0)=>Math.max(0,Math.min(999999,Math.trunc(Number(value)||fallback)));
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const id=(prefix,input,sequence)=>`${prefix}:${text(input,'anonymous')}:${integer(sequence)}`;
export function createTradeReceipt(input={}){
  const direction=input.direction==='sell'?'sell':'buy';const quote=resolveTradeQuote(input.itemId,input.quantity,direction,input.modifiers);if(!quote.ok)return{ok:false,reason:quote.reason};
  const item=getSettlementItem(quote.itemId);return{ok:true,receipt:{version:1,id:id(direction,input.requestId,input.sequence),type:'trade',source:text(input.source,'settlement-market'),direction,itemId:item.id,itemLabel:item.label,quantity:quote.quantity,unitPrice:quote.unitPrice,total:quote.total,timestamp:Number.isFinite(Number(input.timestamp))?Number(input.timestamp):null}};
}
export function createCraftReceipt(input={}){
  const recipe=getSettlementRecipe(input.recipeId);if(!recipe)return{ok:false,reason:'unknown-recipe'};const check=resolveCraftingRecipe(recipe.id,input.snapshot);if(!check.ok)return{ok:false,reason:check.reason,missing:check.missing};
  return{ok:true,receipt:{version:1,id:id('craft',input.requestId,input.sequence),type:'craft',source:text(input.source,'settlement-blacksmith'),recipeId:recipe.id,productId:recipe.id,quantity:1,xp:recipe.xp,minutes:recipe.minutes,station:recipe.station,timestamp:Number.isFinite(Number(input.timestamp))?Number(input.timestamp):null}};
}
export function validateReceipt(raw){
  const receipt=raw&&typeof raw==='object'?raw:null;if(!receipt)return{ok:false,reason:'missing-receipt'};if(receipt.version!==1)return{ok:false,reason:'unsupported-receipt-version'};if(!text(receipt.id))return{ok:false,reason:'missing-receipt-id'};
  if(receipt.type==='trade'){if(!getSettlementItem(receipt.itemId))return{ok:false,reason:'unknown-item'};if(!['buy','sell'].includes(receipt.direction))return{ok:false,reason:'invalid-direction'};if(integer(receipt.quantity)<1)return{ok:false,reason:'invalid-quantity'};if(integer(receipt.unitPrice)<1||integer(receipt.total)<1)return{ok:false,reason:'invalid-price'};}
  if(receipt.type==='craft'){if(!getSettlementRecipe(receipt.recipeId))return{ok:false,reason:'unknown-recipe'};if(integer(receipt.quantity)!==1)return{ok:false,reason:'invalid-craft-quantity'};}
  return{ok:true,receipt:clone(receipt)};
}
export function appendSettlementReceipt(history=[],receipt){
  const checked=validateReceipt(receipt);if(!checked.ok)return{ok:false,reason:checked.reason,history:Array.isArray(history)?history.slice(-LIMIT):[]};
  const list=Array.isArray(history)?history:[];if(list.some(entry=>entry?.id===checked.receipt.id))return{ok:false,reason:'duplicate-receipt',history:list.slice(-LIMIT)};return{ok:true,history:[...list,checked.receipt].slice(-LIMIT)};
}
export function summarizeSettlementReceipts(history=[]){
  const valid=[];const invalid=[];for(const entry of Array.isArray(history)?history.slice(-LIMIT):[]){const checked=validateReceipt(entry);if(checked.ok)valid.push(checked.receipt);else invalid.push({id:text(entry?.id),reason:checked.reason});}
  const spent=valid.filter(v=>v.type==='trade'&&v.direction==='buy').reduce((sum,v)=>sum+v.total,0);const earned=valid.filter(v=>v.type==='trade'&&v.direction==='sell').reduce((sum,v)=>sum+v.total,0);const crafted=valid.filter(v=>v.type==='craft').reduce((sum,v)=>sum+v.quantity,0);
  return{ok:invalid.length===0,valid,invalid,spent,earned,crafted};
}
export function reconcileSettlementReceipts(history=[],source={}){const summary=summarizeSettlementReceipts(history);const expected={spent:integer(source.spent),earned:integer(source.earned),crafted:integer(source.crafted)};return{ok:summary.ok&&summary.spent===expected.spent&&summary.earned===expected.earned&&summary.crafted===expected.crafted,summary,expected};}
