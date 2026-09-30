import { describe,expect,it } from 'vitest';
import { R16BudgetScheduler } from '../../../src/3d/modern/r16/budgetScheduler.js';
import { R16EventLog } from '../../../src/3d/modern/r16/eventLog.js';
import { R16PersistenceJournal } from '../../../src/3d/modern/r16/persistence.js';
import { R16Telemetry } from '../../../src/3d/modern/r16/observability.js';
import { R16HealthSupervisor } from '../../../src/3d/modern/r16/health.js';
import { R16SnapshotStore } from '../../../src/3d/modern/r16/snapshotStore.js';

describe('R16 bounded subsystems',()=>{
  it('keeps work inside per-budget limits',()=>{
    const scheduler=new R16BudgetScheduler({maxWorkItemsPerBudget:4});
    for(let i=0;i<4;i++)scheduler.enqueue({id:'w'+i,budget:'simulation',units:400,priority:i,enqueuedTick:1,expiresTick:10,payload:i});
    const decision=scheduler.consume('simulation',2);expect(decision.accepted.length).toBeLessThanOrEqual(4);expect(decision.pressure).toBeGreaterThanOrEqual(0);
  });
  it('retains only the bounded event tail',()=>{
    const events=new R16EventLog({seed:1,maxEvents:3});for(let i=0;i<7;i++)events.emit('tick',{i},i,'system','debug');expect(events.stats().count).toBe(3);expect(events.stats().dropped).toBe(4);
  });
  it('creates restorable checkpoints and telemetry summaries',()=>{
    const snapshots=new R16SnapshotStore({maxSnapshots:2});const snap=snapshots.capture({player:{hp:100}},5);const journal=new R16PersistenceJournal({maxJournalEntries:4});expect(journal.checkpoint(snap.snapshot).ok).toBe(true);
    const telemetry=new R16Telemetry({maxTelemetrySamples:8});for(let i=0;i<4;i++)telemetry.record('frame.ms',i+1,i,'ms');expect(telemetry.metric('frame.ms')?.p95).toBeGreaterThan(0);
  });
  it('classifies health degradation without throwing',()=>{
    const health=new R16HealthSupervisor({maxEvents:16});health.report('render',.7,'warn','pressure',3);expect(health.state()).toBe('degraded');health.recover('render',4);expect(health.state()).toBe('healthy');
  });
});
