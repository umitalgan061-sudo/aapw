import { describe, expect, it } from 'vitest';
import { R16ReplayController } from '../../../src/3d/modern/r16/replayController.js';
import { R16ReplayJournal } from '../../../src/3d/modern/r16/replayJournal.js';
import { R16RuntimeGuard } from '../../../src/3d/modern/r16/runtimeGuard.js';
import { R16PlatformSnapshotter } from '../../../src/3d/modern/r16/platformSnapshot.js';
import { createR16Runtime } from '../../../src/3d/modern/r16/runtime.js';

describe('R16 replay, guard and snapshot controls',()=>{
  it('records commands and walks them in deterministic order',()=>{
    const runtime=createR16Runtime();runtime.commands.register({topic:'noop',apply:()=>({ok:true,value:null})});
    const journal=new R16ReplayJournal({maxJournalEntries:8});const controller=new R16ReplayController(journal);controller.startRecording(0);
    runtime.commands.enqueue('noop',null,1,'replay',1);const receipts=runtime.commands.tick(1);
    const command=runtime.commands.receipt(receipts[0]?.id??'');
    expect(command).toBeTruthy();
    journal.record(runtime.commands.receipt(receipts[0]?.id??'') ? {
      version:16,tick:1,seed:16092026,source:'replay',id:'cmd',topic:'noop',payload:null,createdTick:1,deadlineTick:10,priority:1
    }:{
      version:16,tick:1,seed:16092026,source:'replay',id:'cmd',topic:'noop',payload:null,createdTick:1,deadlineTick:10,priority:1
    },receipts[0]);
    expect(controller.next().done).toBe(false);
  });
  it('reports guard violations without throwing',()=>{
    const guard=new R16RuntimeGuard();
    expect(guard.assert(true,'ok','invariant','runtime','fine',1).ok).toBe(true);
    expect(guard.assert(false,'bad','integrity','network','tampered',2,'fatal').ok).toBe(false);
    expect(guard.report().passed).toBe(false);
    guard.clear('bad');
    expect(guard.report().passed).toBe(true);
  });
  it('captures and verifies a whole runtime diagnostics snapshot',()=>{
    const runtime=createR16Runtime();runtime.start();runtime.frame();
    const snapshotter=new R16PlatformSnapshotter();const snapshot=snapshotter.capture(runtime);
    expect(snapshotter.verify(snapshot).ok).toBe(true);
    expect(snapshot.digest.length).toBeGreaterThan(0);
  });
});
