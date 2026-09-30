import { describe, expect, it } from 'vitest';
import {
  JsonPersistenceCoordinator,
  MemoryStorage,
} from '../../../src/3d/modern/r32/persistenceCoordinator.ts';

describe('R32 persistence coordinator', () => {
  const options={
    namespace:'test',
    schema:'player',
    version:2,
    maxBytes:1024*64,
    backupCount:2,
  };

  it('round trips typed JSON state with checksums', async () => {
    const storage=new MemoryStorage();
    const coordinator=new JsonPersistenceCoordinator<
      { name:string;level:number }
    >(storage,options);

    await coordinator.save(
      {name:'Arya',level:4},
      120,
    );

    const loaded=await coordinator.load();

    expect(loaded?.envelope.payload).toEqual({
      name:'Arya',
      level:4,
    });

    expect(loaded?.envelope.version).toBe(2);
    expect(coordinator.stats().writes).toBe(1);
  });

  it('runs sequential migrations', async () => {
    const storage=new MemoryStorage();
    const old={
      schema:'player',
      version:1,
      revision:1,
      createdAtTick:10,
      checksum:'',
      payload:{name:'Bran',level:2},
      metadata:{},
    };

    const checksumSource=old.payload;
    old.checksum=(
      await new JsonPersistenceCoordinator(
        storage,
        {
          ...options,
          version:1,
        },
      ).save(checksumSource,10)
    ).envelope.checksum;

    await storage.set(
      'test:player:current',
      JSON.stringify(old),
    );

    const coordinator=new JsonPersistenceCoordinator<
      { name:string;level:number;xp:number }
    >(storage,options);

    coordinator.registerMigration({
      fromVersion:1,
      toVersion:2,
      migrate:(payload) => ({
        ...(payload as {name:string;level:number}),
        xp:0,
      }),
    });

    const loaded=await coordinator.load();

    expect(loaded?.envelope.payload).toEqual({
      name:'Bran',
      level:2,
      xp:0,
    });
  });

  it('recovers from a previous backup after corruption', async () => {
    const storage=new MemoryStorage();
    const coordinator=new JsonPersistenceCoordinator<{value:number}>(
      storage,
      {
        ...options,
        version:1,
        backupCount:2,
      },
    );

    await coordinator.save({value:1},1);
    await coordinator.save({value:2},2);

    await storage.set(
      'test:player:current',
      '{"schema":"player","version":1,"revision":3,"payload":',
    );

    const loaded=await coordinator.load();

    expect(loaded?.envelope.payload).toEqual({
      value:1,
    });
    expect(coordinator.stats().failures).toBeGreaterThan(0);
  });
});
