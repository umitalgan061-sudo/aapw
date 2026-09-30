/**
 * Settlement shop/trade adapter.
 * Existing economy/inventory owners perform mutations; this module only quotes.
 */
import { getSettlementItem, listSettlementItems, resolveTradeQuote } from './settlementCampaignContent.js';
import { evaluateTradeRule, normalizeRpgSnapshot } from './settlementCampaignRules.js';

export const SETTLEMENT_SHOP_ADAPTER_VERSION = 1;
const text=(value,fallback='')=>{const v=String(value??'').trim();return v?v.slice(0,160):fallback;};
const integer=value=>Math.max(0,Math.min(999999,Math.trunc(Number(value)||0)));
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
function modifier(snapshot,direction){const state=normalizeRpgSnapshot(snapshot);if(direction==='buy'&&state.perks.includes('merchant_road'))return{buyRate:-0.04};if(direction==='sell'&&state.perks.includes('market_eye'))return{sellRate:0.05};return{};}
function entry(itemId,snapshot,direction){const item=getSettlementItem(itemId);if(!item)return null;const state=normalizeRpgSnapshot(snapshot);const quote=resolveTradeQuote(item.id,1,direction,modifier(state,direction));return{id:item.id,label:item.label,category:item.category,owned:state.inventory[item.id]||0,weight:item.weight,unitPrice:quote.ok?quote.unitPrice:0,direction,tags:[...item.tags]};}
export function buildSettlementShopCatalog(snapshot={},options={}){const direction=options.direction==='sell'?'sell':'buy';const ids=Array.isArray(options.items)?options.items:listSettlementItems();return{version:SETTLEMENT_SHOP_ADAPTER_VERSION,direction,entries:ids.slice(0,24).map(id=>entry(text(id),snapshot,direction)).filter(Boolean)};}
export function quoteSettlementPurchase(itemId,quantity,snapshot={}){const state=normalizeRpgSnapshot(snapshot);const amount=Math.max(1,integer(quantity));const rule=evaluateTradeRule(itemId,amount,'buy',state);if(!rule.quote)return rule;const quote=resolveTradeQuote(itemId,amount,'buy',modifier(state,'buy'));return{...rule,quote,remainingCopper:Math.max(0,state.copper-quote.total)};}
export function quoteSettlementSale(itemId,quantity,snapshot={}){const state=normalizeRpgSnapshot(snapshot);const amount=Math.max(1,integer(quantity));const rule=evaluateTradeRule(itemId,amount,'sell',state);if(!rule.quote)return rule;const quote=resolveTradeQuote(itemId,amount,'sell',modifier(state,'sell'));return{...rule,quote,resultingCopper:state.copper+quote.total};}
export function buildTransactionEnvelope(direction,quote,context={}){return{schema:1,direction:direction==='sell'?'sell':'buy',itemId:text(quote?.itemId),quantity:integer(quote?.quantity),unitPrice:integer(quote?.unitPrice),total:integer(quote?.total),requestId:text(context.requestId),source:text(context.source,'settlement-market'),requiresAuthoritativeCommit:true};}
export function evaluateTransactionEnvelope(envelope,snapshot={}){const direction=envelope?.direction==='sell'?'sell':'buy';if(!envelope?.itemId||integer(envelope.quantity)<1)return{ok:false,reason:'invalid-transaction'};const rule=evaluateTradeRule(envelope.itemId,envelope.quantity,direction,snapshot);if(!rule.ok)return rule;if(integer(envelope.total)!==integer(rule.quote.total))return{ok:false,reason:'quote-stale'};return{ok:true,quote:clone(rule.quote)};}
export function describeSettlementWallet(snapshot={}){const state=normalizeRpgSnapshot(snapshot);const load=state.maxCarryWeight?state.carryWeight/state.maxCarryWeight:1;return{copper:state.copper,carryWeight:state.carryWeight,maxCarryWeight:state.maxCarryWeight,loadRatio:Math.max(0,Math.min(1,load)),encumbered:state.carryWeight>state.maxCarryWeight};}
export function canAffordSettlementQuote(snapshot,quote){const state=normalizeRpgSnapshot(snapshot);const total=integer(quote?.total);return{ok:total<=state.copper,copper:state.copper,total,remaining:state.copper-total};}
