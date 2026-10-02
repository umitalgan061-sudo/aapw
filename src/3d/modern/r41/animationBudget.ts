export interface AnimationActor{readonly id:string;readonly distance:number;readonly importance:number;readonly speaking:boolean;readonly combat:boolean;}
export class AnimationBudgetPolicy{
 evaluate(actors:readonly AnimationActor[]){return Object.freeze([...actors].sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id)).map(actor=>{const boosted=actor.speaking||actor.combat||actor.importance>.85;const tier=actor.distance<18?'hero':actor.distance<60?'near':actor.distance<180?'far':'frozen';const base=tier==='hero'?60:tier==='near'?30:tier==='far'?8:1;return Object.freeze({id:actor.id,tier,updateHz:Math.max(1,Math.round(base*(boosted?1:Math.max(.5,actor.importance)))),poseSampling:tier!=='frozen'});}));}
}
