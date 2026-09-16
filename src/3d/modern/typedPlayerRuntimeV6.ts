import type { TickId, Vec3V4 } from './runtimeContractsV4';
import { type InputSnapshotV6, type PlayerStateV6, type MutableVec3V6, playerId, sceneObjectId, finiteOrV6, validatePlayerV6 } from './typedSceneContractsV6';

export interface PlayerRuntimeConfigV6 {
  readonly maxSpeed?: number;
  readonly sprintSpeed?: number;
  readonly acceleration?: number;
  readonly deceleration?: number;
  readonly airControl?: number;
  readonly jumpVelocity?: number;
  readonly gravity?: number;
  readonly groundSnap?: number;
  readonly maxHealth?: number;
  readonly maxStamina?: number;
  readonly sprintDrain?: number;
  readonly staminaRecovery?: number;
  readonly turnSpeed?: number;
}

export interface GroundProbeV6 { readonly heightAt: (x:number,z:number)=>number; readonly normalAt?: (x:number,z:number)=>Vec3V4; }
export interface PlayerRuntimeMetricsV6 { readonly ticks:number; readonly groundedTicks:number; readonly jumps:number; readonly damageEvents:number; readonly deaths:number; readonly revives:number; readonly sprintTicks:number; readonly staminaExhaustions:number; }

const defaults: Required<PlayerRuntimeConfigV6> = Object.freeze({ maxSpeed:7.5, sprintSpeed:11, acceleration:28, deceleration:35, airControl:0.35, jumpVelocity:9.5, gravity:26, groundSnap:0.25, maxHealth:100, maxStamina:100, sprintDrain:28, staminaRecovery:16, turnSpeed:10 });
const magnitudeXZ = (value: MutableVec3V6): number => Math.hypot(value.x,value.z);
const clamp = (value:number,min:number,max:number):number=>Math.max(min,Math.min(max,value));
const finite = (value:unknown,fallback=0):number=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
const approach = (current:number,target:number,step:number):number => current<target?Math.min(target,current+step):Math.max(target,current-step);

export class TypedPlayerRuntimeV6 {
  readonly config: Required<PlayerRuntimeConfigV6>;
  readonly ground: GroundProbeV6;
  #state: PlayerStateV6;
  #metrics: PlayerRuntimeMetricsV6 = Object.freeze({ticks:0,groundedTicks:0,jumps:0,damageEvents:0,deaths:0,revives:0,sprintTicks:0,staminaExhaustions:0});
  #lastTick: TickId = 0 as TickId;

  constructor(ground: GroundProbeV6, config: PlayerRuntimeConfigV6 = {}, initial?: Partial<PlayerStateV6>) {
    this.config = { ...defaults, ...config };
    this.ground = ground;
    const maxHealth = this.config.maxHealth;
    const maxStamina = this.config.maxStamina;
    const state: PlayerStateV6 = {
      id: initial?.id ?? playerId('player-1'), objectId: initial?.objectId ?? sceneObjectId('player:1'),
      position:{ x:finite(initial?.position?.x), y:finite(initial?.position?.y,ground.heightAt(finite(initial?.position?.x),finite(initial?.position?.z))), z:finite(initial?.position?.z) },
      velocity:{ x:0,y:0,z:0 }, yaw:finite(initial?.yaw), grounded:initial?.grounded ?? true,
      health:clamp(finite(initial?.health,maxHealth),0,maxHealth), maxHealth, stamina:clamp(finite(initial?.stamina,maxStamina),0,maxStamina), maxStamina, sprinting:false, alive:true,
    };
    this.#state = Object.freeze({ ...state, position:Object.freeze({ ...state.position }), velocity:Object.freeze({ ...state.velocity }) });
    validatePlayerV6(this.#state);
  }

  state(): PlayerStateV6 { return Object.freeze({ ...this.#state, position:Object.freeze({ ...this.#state.position }), velocity:Object.freeze({ ...this.#state.velocity }) }); }
  metrics(): PlayerRuntimeMetricsV6 { return this.#metrics; }

  spawn(position: Vec3V4): void {
    const y = finite(this.ground.heightAt(position.x,position.z),position.y);
    this.#state = Object.freeze({ ...this.#state, position:Object.freeze({x:finite(position.x),y,z:finite(position.z)}), velocity:Object.freeze({x:0,y:0,z:0}), grounded:true, alive:true, health:this.#state.maxHealth, stamina:this.#state.maxStamina, sprinting:false });
  }

  tick(input: InputSnapshotV6, deltaSeconds: number, tick: TickId): PlayerStateV6 {
    const dt = clamp(finite(deltaSeconds,1/60),0.001,0.1);
    const state = this.#state;
    if (!state.alive) { this.#lastTick=tick; return this.state(); }
    const wantsSprint = input.sprint && state.stamina > 0.01 && (Math.abs(input.moveX)+Math.abs(input.moveZ) > 0.01);
    const speed = wantsSprint ? this.config.sprintSpeed : this.config.maxSpeed;
    const desiredX = clamp(input.moveX,-1,1) * speed;
    const desiredZ = clamp(input.moveZ,-1,1) * speed;
    const control = state.grounded ? 1 : clamp(this.config.airControl,0,1);
    const acceleration = (Math.abs(desiredX)+Math.abs(desiredZ)) > 0 ? this.config.acceleration : this.config.deceleration;
    const vx = approach(state.velocity.x,desiredX,acceleration*control*dt);
    const vz = approach(state.velocity.z,desiredZ,acceleration*control*dt);
    let vy = state.velocity.y - this.config.gravity*dt;
    let grounded = state.grounded;
    if (input.jump && grounded) { vy=this.config.jumpVelocity; grounded=false; this.#metrics=Object.freeze({ ...this.#metrics,jumps:this.#metrics.jumps+1 }); }
    const position = { x:state.position.x+vx*dt, y:state.position.y+vy*dt, z:state.position.z+vz*dt };
    const groundY = finite(this.ground.heightAt(position.x,position.z),0);
    if (position.y <= groundY + this.config.groundSnap && vy <= 0) { position.y=groundY; vy=0; grounded=true; }
    const stamina = wantsSprint ? Math.max(0,state.stamina-this.config.sprintDrain*dt) : Math.min(state.maxStamina,state.stamina+this.config.staminaRecovery*dt);
    const exhausted = state.stamina > 0 && stamina <= 0;
    if (exhausted) this.#metrics=Object.freeze({ ...this.#metrics,staminaExhaustions:this.#metrics.staminaExhaustions+1 });
    if (wantsSprint) this.#metrics=Object.freeze({ ...this.#metrics,sprintTicks:this.#metrics.sprintTicks+1 });
    if (grounded) this.#metrics=Object.freeze({ ...this.#metrics,groundedTicks:this.#metrics.groundedTicks+1 });
    const planar = Math.hypot(vx,vz);
    const yawTarget = planar>0.05 ? Math.atan2(vx,vz) : state.yaw;
    const yaw = approachAngle(state.yaw,yawTarget,Math.max(0,this.config.turnSpeed)*dt);
    this.#state = Object.freeze({ ...state, position:Object.freeze(position), velocity:Object.freeze({x:vx,y:vy,z:vz}), yaw, grounded, stamina, sprinting:wantsSprint && !exhausted });
    this.#metrics=Object.freeze({ ...this.#metrics,ticks:this.#metrics.ticks+1 });
    this.#lastTick=tick;
    return this.state();
  }

  damage(amount:number,tick:TickId): boolean {
    if (!this.#state.alive) return false;
    const safe = Math.max(0,finite(amount)); if (safe<=0) return false;
    const health=Math.max(0,this.#state.health-safe); const dead=health<=0;
    this.#state=Object.freeze({ ...this.#state,health,alive:!dead,sprinting:dead?false:this.#state.sprinting,velocity:dead?Object.freeze({x:0,y:0,z:0}):this.#state.velocity });
    this.#metrics=Object.freeze({ ...this.#metrics,damageEvents:this.#metrics.damageEvents+1,deaths:this.#metrics.deaths+(dead?1:0) });
    this.#lastTick=tick; return true;
  }

  revive(position?:Vec3V4): boolean {
    if (this.#state.alive) return false;
    if (position) this.spawn(position); else this.#state=Object.freeze({ ...this.#state,health:this.#state.maxHealth,stamina:this.#state.maxStamina,alive:true,grounded:true });
    this.#metrics=Object.freeze({ ...this.#metrics,revives:this.#metrics.revives+1 }); return true;
  }

  heal(amount:number): number { const healed=Math.max(0,finite(amount)); if (!this.#state.alive) return 0; const next=Math.min(this.#state.maxHealth,this.#state.health+healed); const delta=next-this.#state.health; this.#state=Object.freeze({ ...this.#state,health:next }); return delta; }
  setYaw(yaw:number): void { this.#state=Object.freeze({ ...this.#state,yaw:finite(yaw,this.#state.yaw) }); }
  lastTick(): TickId { return this.#lastTick; }
}

function approachAngle(current:number,target:number,maxStep:number):number {
  let delta=(target-current+Math.PI)%(Math.PI*2)-Math.PI;
  if (delta<-Math.PI) delta+=Math.PI*2;
  const step=clamp(maxStep,0,Math.abs(delta));
  return current + Math.sign(delta)*step;
}

export function directionFromInputV6(input:Pick<InputSnapshotV6,'moveX'|'moveZ'>,yaw:number):Vec3V4 {
  const forward={x:Math.sin(yaw),z:Math.cos(yaw)}; const right={x:Math.cos(yaw),z:-Math.sin(yaw)};
  const x=forward.x*(-input.moveZ)+right.x*input.moveX; const z=forward.z*(-input.moveZ)+right.z*input.moveX; const length=Math.hypot(x,z)||1;
  return Object.freeze({x:x/length,y:0,z:z/length});
}
