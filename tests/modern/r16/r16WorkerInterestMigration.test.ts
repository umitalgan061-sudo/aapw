import { describe, expect, it } from 'vitest';
import { R16WorkerScheduler } from '../../../src/3d/modern/r16/workerScheduler.js';
import { R16WorldInterest } from '../../../src/3d/modern/r16/worldInterest.js';
import { R16MigrationLedger } from '../../../src/3d/modern/r16/migrationAudit.js';

describe('R16 worker, interest and migration controls', () => {
  it('respects worker concurrency', () => {
    const scheduler=new R16WorkerScheduler({maxWorkItemsPerBudget:8});
    scheduler.registerLane({id:'sim',concurrency:1,budget:'simulation',latencyTargetMs:4});
    scheduler.enqueue('sim',{id:'w1',units:2,priority:1,enqueuedTick:1,expiresTick:10,payload:null});
    scheduler.enqueue('sim',{id:'w2',units:2,priority:2,enqueuedTick:1,expiresTick:10,payload:null});
    expect(scheduler.dispatch(2)).toHaveLength(1);
  });

  it('caps interest bands deterministically', () => {
    const interest=new R16WorldInterest({near:1,mid:2,far:3,sleeping:4});
    interest.upsert({id:'a',x:1,y:0,z:0,importance:1,active:true});
    interest.upsert({id:'b',x:1,y:0,z:0,importance:.5,active:true});
    const result=interest.decide({x:0,y:0,z:0},{near:2,mid:4,far:8});
    expect(result.find(x=>x.band==='near')?.ids).toEqual(['a']);
  });

  it('requires parity before promotion', () => {
    const ledger=new R16MigrationLedger();
    ledger.register({id:'player',owner:'gameplay',legacyPath:'legacy.js',modernPath:'player.ts'});
    expect(ledger.promote('player')).toBe(false);
    ledger.record('player',true,'parity pass');
    expect(ledger.promote('player')).toBe(true);
    expect(ledger.audit().promoted).toBe(1);
  });
});
