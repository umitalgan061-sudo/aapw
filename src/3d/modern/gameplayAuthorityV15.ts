/** Unified deterministic gameplay state authority built for player/NPC/control-plane integration. */
export type GameplayModeV15='exploration'|'combat'|'stealth'|'dialogue'|'mounted'|'dead';
export type StanceV15='neutral'|'aggressive'|'defensive'|'stealth';
export interface GameplayTransformV15{readonly x:number;readonly y:number;readonly z:number;readonly yaw:number;readonly grounded:boolean;readonly velocityX:number;readonly velocityY:number;readonly velocityZ:number;}
export interface GameplayVitalsV15{readonly health:number;readonly maxHealth:number;readonly stamina:number;readonly maxStamina:number;readonly poise:number;readonly maxPoise:number;readonly invulnerableMs:number;readonly staggerMs:number;}
export interface GameplayStateV15{readonly id:string;readonly mode:GameplayModeV15;readonly stance:StanceV15;readonly transform:GameplayTransformV15;readonly vitals:GameplayVitalsV15;readonly revision:number;readonly actionCooldownMs:number;readonly comboIndex:number;}
export interface GameplayInputV15{readonly moveX:number;readonly moveZ:number;readonly sprint:boolean;readonly jump:boolean;readonly dodge:boolean;readonly lightAttack:boolean;readonly heavyAttack:boolean;readonly guard:boolean;readonly interact:boolean;}
export interface GameplayEventV15{readonly type:'move'|'jump'|'dodge'|'attack'|'guard'|'damage'|'death'|'recover';readonly actorId:string;readonly tick:number;readonly value:number;}
export interface GameplayOptionsV15{readonly speed?:number;readonly sprintMultiplier?:number;readonly acceleration?:number;readonly gravity?:number;readonly jumpVelocity?:number;readonly maxStamina?:number;readonly attackCooldownMs?:number;readonly now?:()=>number;}

const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,Number.isFinite(v)?v:a));
const normalize=(x:number,z:number):[number,number]=>{const m=Math.hypot(x,z);return m<1e-6?[0,0]:[x/m,z/m];};

export class GameplayAuthorityV15{
  readonly #id:string;readonly #speed:number;readonly #sprintMultiplier:number;readonly #acceleration:number;readonly #gravity:number;readonly #jumpVelocity:number;readonly #maxStamina:number;readonly #attackCooldown:number;
  readonly #now:()=>number;#state:GameplayStateV15;#events:GameplayEventV15[]=[];
  constructor(id='player-1',options:GameplayOptionsV15={}){this.#id=id.trim()||'player-1';this.#speed=Math.max(.1,options.speed??6);this.#sprintMultiplier=Math.max(1,options.sprintMultiplier??1.5);this.#acceleration=Math.max(.1,options.acceleration??24);this.#gravity=Math.max(0,options.gravity??24);this.#jumpVelocity=Math.max(0,options.jumpVelocity??9);this.#maxStamina=Math.max(1,options.maxStamina??100);this.#attackCooldown=Math.max(0,options.attackCooldownMs??350);this.#now=options.now??(()=>Date.now());this.#state=this.defaultState();}

  defaultState():GameplayStateV15{return Object.freeze({id:this.#id,mode:'exploration',stance:'neutral',transform:{x:0,y:0,z:0,yaw:0,grounded:true,velocityX:0,velocityY:0,velocityZ:0},vitals:{health:100,maxHealth:100,stamina:this.#maxStamina,maxStamina:this.#maxStamina,poise:100,maxPoise:100,invulnerableMs:0,staggerMs:0},revision:0,actionCooldownMs:0,comboIndex:0});}
  state():GameplayStateV15{return this.#state;}
  drainEvents():readonly GameplayEventV15[]{const events=Object.freeze([...this.#events]);this.#events.length=0;return events;}

  step(input:GameplayInputV15,deltaMs:number,tick:number):GameplayStateV15{
    const dt=clamp(deltaMs,0,100)/1000;let state=this.#state;const [mx,mz]=normalize(input.moveX,input.moveZ);const requestedSpeed=this.#speed*(input.sprint?this.#sprintMultiplier:1);
    const targetX=mx*requestedSpeed,targetZ=mz*requestedSpeed;
    const vx=this.#approach(state.transform.velocityX,targetX,this.#acceleration*dt);const vz=this.#approach(state.transform.velocityZ,targetZ,this.#acceleration*dt);
    let vy=state.transform.velocityY-this.#gravity*dt;let y=state.transform.y+vy*dt;let grounded=state.transform.grounded;
    if(input.jump&&grounded&&state.vitals.stamina>=10){vy=this.#jumpVelocity;grounded=false;y+=vy*dt;state=this.#withVitals(state,{stamina:state.vitals.stamina-10});this.#events.push({type:'jump',actorId:this.#id,tick,value:1});}
    if(y<=0){y=0;vy=0;grounded=true;}else grounded=false;
    let stamina=state.vitals.stamina;
    if(input.sprint&&Math.hypot(mx,mz)>.1&&stamina>0)stamina=Math.max(0,stamina-dt*12);else stamina=Math.min(state.vitals.maxStamina,stamina+dt*8);
    let cooldown=Math.max(0,state.actionCooldownMs-deltaMs);let combo=state.comboIndex;let mode:GameplayModeV15=state.mode;
    if(state.vitals.health<=0){mode='dead';}
    else if(input.guard){mode='combat';}
    else if(input.lightAttack||input.heavyAttack){if(cooldown<=0){mode='combat';cooldown=this.#attackCooldown;combo=(combo+1)%4;this.#events.push({type:'attack',actorId:this.#id,tick,value:input.heavyAttack?2:1);}}}
    else if(Math.hypot(vx,vz)>.1)mode=input.sprint?'combat':'exploration';
    else if(cooldown<=0)mode='exploration';
    const yaw=Math.abs(mx)+Math.abs(mz)>0.001?Math.atan2(mx,mz):state.transform.yaw;
    const moving=Math.hypot(vx,vz)>.01;this.#events.push({type:'move',actorId:this.#id,tick,value:moving?1:0});
    this.#state=Object.freeze({...state,mode,stance:input.guard?'defensive':mode==='combat'?'aggressive':'neutral',transform:Object.freeze({x:state.transform.x+vx*dt,y,z:state.transform.z+vz*dt,yaw,grounded,velocityX:vx,velocityY:vy,velocityZ:vz}),vitals:Object.freeze({...state.vitals,stamina:stamina,invulnerableMs:Math.max(0,state.vitals.invulnerableMs-deltaMs),staggerMs:Math.max(0,state.vitals.staggerMs-deltaMs)}),revision:state.revision+1,actionCooldownMs:cooldown,comboIndex:combo});
    if(this.#state.vitals.staggerMs<=0&&state.vitals.staggerMs>0)this.#events.push({type:'recover',actorId:this.#id,tick,value:1});
    return this.#state;
  }

  damage(amount:number,tick:number,poiseDamage=amount*.5):GameplayStateV15{
    if(this.#state.mode==='dead'||this.#state.vitals.invulnerableMs>0)return this.#state;
    const value=Math.max(0,Number.isFinite(amount)?amount:0);const health=Math.max(0,this.#state.vitals.health-value);const poise=Math.max(0,this.#state.vitals.poise-Math.max(0,poiseDamage));const dead=health<=0;
    this.#state=Object.freeze({...this.#state,mode:dead?'dead':'combat',vitals:Object.freeze({...this.#state.vitals,health,poise,staggerMs:poise<=0?500:this.#state.vitals.staggerMs,invulnerableMs:dead?0:150}),revision:this.#state.revision+1});
    this.#events.push({type:'damage',actorId:this.#id,tick,value});if(dead)this.#events.push({type:'death',actorId:this.#id,tick,value:1});return this.#state;
  }

  heal(amount:number):GameplayStateV15{const value=Math.max(0,Number.isFinite(amount)?amount:0);this.#state=Object.freeze({...this.#state,vitals:Object.freeze({...this.#state.vitals,health:Math.min(this.#state.vitals.maxHealth,this.#state.vitals.health+value)}),revision:this.#state.revision+1});return this.#state;}
  setMode(mode:GameplayModeV15):GameplayStateV15{this.#state=Object.freeze({...this.#state,mode,revision:this.#state.revision+1});return this.#state;}
  reset():void{this.#state=this.defaultState();this.#events.length=0;}
  snapshot():GameplayStateV15{return JSON.parse(JSON.stringify(this.#state)) as GameplayStateV15;}

  #withVitals(state:GameplayStateV15,patch:Partial<GameplayVitalsV15>):GameplayStateV15{return {...state,vitals:{...state.vitals,...patch}};}
  #approach(current:number,target:number,amount:number):number{return current<target?Math.min(target,current+amount):Math.max(target,current-amount);}
}

export const makeGameplayInputV15=(input:Partial<GameplayInputV15>={}):GameplayInputV15=>Object.freeze({moveX:clamp(input.moveX??0,-1,1),moveZ:clamp(input.moveZ??0,-1,1),sprint:Boolean(input.sprint),jump:Boolean(input.jump),dodge:Boolean(input.dodge),lightAttack:Boolean(input.lightAttack),heavyAttack:Boolean(input.heavyAttack),guard:Boolean(input.guard),interact:Boolean(input.interact)});
