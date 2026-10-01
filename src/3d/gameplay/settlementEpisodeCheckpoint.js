/**
 * Settlement episode checkpoint codec.
 * Persistence ownership stays with the existing settlement runtime. This file
 * only defines a versioned, deterministic envelope for the episode cursor plus
 * the runtime's own exportState/importState hooks.
 */
import {
  SETTLEMENT_EPISODE_CONTENT_VERSION,
  getSettlementEpisode,
  listSettlementEpisodes,
} from './settlementEpisodeContent.js';

export const SETTLEMENT_EPISODE_CHECKPOINT_VERSION = 1;
export const SETTLEMENT_EPISODE_CHECKPOINT_LIMITS = Object.freeze({
  text: 160,
  episodes: 6,
  route: 24,
  history: 96,
  requests: 64,
});

const text = (value, fallback='') => {
  const normalized=String(value ?? '').trim();
  return normalized ? normalized.slice(0, SETTLEMENT_EPISODE_CHECKPOINT_LIMITS.text) : fallback;
};
const integer = (value,min,max,fallback=min) => {
  const n=Number(value);
  return Number.isFinite(n) ? Math.max(min,Math.min(max,Math.trunc(n))) : fallback;
};
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) freeze(nested);
  return value;
};

function stable(value) {
  if (value===null || typeof value!=='object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function checksum(value) {
  let hash=2166136261;
  const source=stable(value);
  for(let i=0;i<source.length;i+=1){
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash,16777619);
  }
  return (hash>>>0).toString(16).padStart(8,'0');
}

function normalizeRoute(route) {
  if(!Array.isArray(route)) return [];
  return route.map((entry)=>text(entry)).filter(Boolean).slice(-SETTLEMENT_EPISODE_CHECKPOINT_LIMITS.route);
}

function normalizeRuntimeState(raw={}) {
  const source=raw && typeof raw==='object' ? raw : {};
  return {
    version: integer(source.version,1,999,1),
    runtimeVersion: integer(source.runtimeVersion,1,999,1),
    contentVersion: integer(source.contentVersion,1,999,1),
    panel: text(source.panel,'overview'),
    activeService: text(source.activeService),
    route: normalizeRoute(source.route),
    history: Array.isArray(source.history) ? clone(source.history).slice(-SETTLEMENT_EPISODE_CHECKPOINT_LIMITS.history) : [],
    requestIds: Array.isArray(source.requestIds)
      ? source.requestIds.map((entry)=>text(entry)).filter(Boolean).slice(-SETTLEMENT_EPISODE_CHECKPOINT_LIMITS.requests)
      : [],
    lastAction: source.lastAction && typeof source.lastAction==='object' ? clone(source.lastAction) : null,
    revision: integer(source.revision,0,999999,0),
  };
}

export function buildSettlementEpisodeCheckpoint(directorSnapshot, runtimeExportState) {
  const source=directorSnapshot && typeof directorSnapshot==='object' ? directorSnapshot : {};
  const runtime=normalizeRuntimeState(runtimeExportState);
  const episodeId=text(source.episodeId);
  const episode=episodeId ? getSettlementEpisode(episodeId) : null;
  const cursor=episode ? integer(source.cursor,0,episode.beats.length,0) : 0;
  const payload={
    schema:'aapw.settlement-episode-checkpoint',
    version:SETTLEMENT_EPISODE_CHECKPOINT_VERSION,
    contentVersion:SETTLEMENT_EPISODE_CONTENT_VERSION,
    episodeId: episode?.id ?? null,
    cursor,
    phase:text(source.phase,'idle'),
    runtime,
  };
  return freeze({
    ...payload,
    checksum:checksum(payload),
  });
}

export function validateSettlementEpisodeCheckpoint(raw) {
  const source=raw && typeof raw==='object' ? raw : {};
  const errors=[];
  if(source.schema!=='aapw.settlement-episode-checkpoint') errors.push('schema');
  if(Number(source.version)!==SETTLEMENT_EPISODE_CHECKPOINT_VERSION) errors.push('version');
  if(Number(source.contentVersion)!==SETTLEMENT_EPISODE_CONTENT_VERSION) errors.push('content-version');
  const episodeId=source.episodeId==null ? '' : text(source.episodeId);
  if(episodeId && !listSettlementEpisodes().includes(episodeId)) errors.push(`episode:${episodeId}`);
  const episode=episodeId ? getSettlementEpisode(episodeId) : null;
  const cursor=integer(source.cursor,0,episode ? episode.beats.length : 0,0);
  if(episodeId && cursor>(episode?.beats.length ?? 0)) errors.push('cursor');
  if(!['idle','entered','service-open','ready','executing','complete','blocked','disposed'].includes(text(source.phase))) {
    errors.push('phase');
  }
  if(!source.runtime || typeof source.runtime!=='object') errors.push('runtime');
  const body={
    schema:source.schema,
    version:source.version,
    contentVersion:source.contentVersion,
    episodeId:episodeId || null,
    cursor,
    phase:text(source.phase,'idle'),
    runtime:normalizeRuntimeState(source.runtime),
  };
  if(text(source.checksum)!==checksum(body)) errors.push('checksum');
  return {ok:errors.length===0,errors,body};
}

export function migrateSettlementEpisodeCheckpoint(raw) {
  const source=raw && typeof raw==='object' ? raw : {};
  if(source.schema==='aapw.settlement-episode-checkpoint' && Number(source.version)===1) {
    return clone(source);
  }
  if(source.schema==='aapw.settlement-episode-checkpoint' && Number(source.version)===0) {
    const migrated={
      schema:'aapw.settlement-episode-checkpoint',
      version:1,
      contentVersion:SETTLEMENT_EPISODE_CONTENT_VERSION,
      episodeId:source.episodeId ?? null,
      cursor:source.cursor ?? 0,
      phase:source.phase ?? 'idle',
      runtime:normalizeRuntimeState(source.runtime),
    };
    return buildSettlementEpisodeCheckpoint(migrated,migrated.runtime);
  }
  return null;
}

export function createSettlementEpisodeCheckpointAdapter(options={}) {
  const director=options.director;
  const runtime=options.runtime;
  if(!director || typeof director.snapshot!=='function') {
    throw new TypeError('Checkpoint adapter requires episode director.snapshot().');
  }
  if(!runtime || typeof runtime.exportState!=='function' || typeof runtime.importState!=='function') {
    throw new TypeError('Checkpoint adapter requires runtime.exportState/importState().');
  }
  let disposed=false;
  const exportCheckpoint=()=>{
    if(disposed) return {ok:false,reason:'disposed'};
    const checkpoint=buildSettlementEpisodeCheckpoint(director.snapshot(),runtime.exportState());
    return {ok:true,checkpoint};
  };
  const validate=(raw)=>{
    if(disposed) return {ok:false,errors:['disposed']};
    const migrated=migrateSettlementEpisodeCheckpoint(raw);
    if(!migrated) return {ok:false,errors:['unsupported-checkpoint']};
    return validateSettlementEpisodeCheckpoint(migrated);
  };
  const restoreRuntime=async(raw)=>{
    if(disposed) return {ok:false,reason:'disposed'};
    const validated=validate(raw);
    if(!validated.ok) return {ok:false,reason:'invalid-checkpoint',errors:validated.errors};
    let imported;
    try { imported=await runtime.importState(clone(validated.body.runtime)); }
    catch(error) {
      return {ok:false,reason:'runtime-import-threw',message:text(error?.message,'Kayıt geri yüklenemedi.')};
    }
    return {
      ok:imported?.ok!==false,
      imported:clone(imported),
      episodeId:validated.body.episodeId,
      cursor:validated.body.cursor,
      phase:validated.body.phase,
    };
  };
  const digest=(raw)=>{
    const validated=validate(raw);
    return validated.ok ? checksum(validated.body) : null;
  };
  const reset=()=>{
    if(disposed) return {ok:false,reason:'disposed'};
    if(typeof director.reset!=='function') return {ok:false,reason:'director-reset-unavailable'};
    return clone(director.reset());
  };
  const dispose=()=>{
    disposed=true;
  };
  return Object.freeze({exportCheckpoint,validate,restoreRuntime,digest,reset,dispose});
}

export function inspectSettlementEpisodeCheckpoint(raw) {
  const result=validateSettlementEpisodeCheckpoint(raw);
  if(!result.ok) return result;
  const episode=result.body.episodeId ? getSettlementEpisode(result.body.episodeId) : null;
  const beat=episode?.beats[result.body.cursor] ?? null;
  return {
    ok:true,
    episodeId:result.body.episodeId,
    cursor:result.body.cursor,
    phase:result.body.phase,
    nextStep:beat?.stepId ?? null,
    nextAction:beat?.action ?? null,
    nextService:beat?.service ?? null,
    runtimeRevision:result.body.runtime.revision,
    digest:checksum(result.body),
  };
}
