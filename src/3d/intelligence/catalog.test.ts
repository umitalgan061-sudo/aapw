import { describe, expect, it } from 'vitest';
import { ACTOR_ARCHETYPES, WORLD_PROFILES, TUNING_PROFILES } from './catalog.js';
import { ADVERSARIAL_CASES } from './adversarialMatrix.js';

const numeric=(value:number)=>Number.isFinite(value)&&value>=0&&value<=1;

describe('catalog invariant matrix',()=>{
 for(const archetype of ACTOR_ARCHETYPES){
  it(`${archetype.id} has bounded behavioral coefficients`,()=>{
   expect(archetype.id.length).toBeGreaterThan(3);
   expect(numeric(archetype.combatReadiness)).toBe(true);
   expect(numeric(archetype.sociability)).toBe(true);
   expect(numeric(archetype.bravery)).toBe(true);
   expect(numeric(archetype.mobility)).toBe(true);
   expect(numeric(archetype.memoryRetention)).toBe(true);
   expect(archetype.preferredGoals.length).toBeGreaterThan(0);
  });
 }
 for(const world of WORLD_PROFILES){
  it(`${world.id} exposes a bounded world envelope`,()=>{
   expect(numeric(world.danger)).toBe(true);
   expect(numeric(world.visibility)).toBe(true);
   expect(world.acousticRange).toBeGreaterThan(0);
   expect(numeric(world.resourceRichness)).toBe(true);
   expect(world.populationCap).toBeGreaterThan(0);
   expect(world.tags.length).toBeGreaterThan(0);
  });
 }
});

describe('adversarial regression matrix',()=>{
 for(const scenario of ADVERSARIAL_CASES.slice(0,50)){
  it(`${scenario.id} remains explicit`,()=>{
   expect(scenario.description.length).toBeGreaterThan(5);
   expect(scenario.danger).toBeGreaterThanOrEqual(0);
   expect(scenario.danger).toBeLessThanOrEqual(1);
   expect(scenario.stimulusCount).toBeGreaterThanOrEqual(-1024);
   expect(['critical','high','normal','low','sleeping']).toContain(scenario.expectedTier);
  });
 }
});

describe('tuning matrix',()=>{
 it('contains cross-product tuning profiles',()=>{expect(TUNING_PROFILES.length).toBeGreaterThan(100);});
 it('keeps all scale factors finite',()=>{for(const profile of TUNING_PROFILES.slice(0,300)){expect(Number.isFinite(profile.perceptionScale)).toBe(true);expect(Number.isFinite(profile.decisionScale)).toBe(true);expect(Number.isFinite(profile.eventScale)).toBe(true);expect(Number.isFinite(profile.interestScale)).toBe(true);expect(Number.isFinite(profile.questScale)).toBe(true);}});
});
