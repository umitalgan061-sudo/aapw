import { EntityIdV7, InterestComponentV7, Vec3V7, SpatialQueryResultV7, clampV7, distanceSquaredV7 } from './types.ts';

export interface InterestSourceV7 {
  readonly id: string;
  readonly position: Vec3V7;
  readonly weight: number;
  readonly radius: number;
  readonly alwaysRelevant?: boolean;
}

export interface InterestBudgetV7 {
  readonly maxSimulation: number;
  readonly maxRender: number;
  readonly maxNetwork: number;
}

export interface InterestDecisionV7 {
  readonly id: EntityIdV7;
  readonly simulation: boolean;
  readonly render: boolean;
  readonly network: boolean;
  readonly simulationLod: 0 | 1 | 2 | 3;
  readonly renderLod: 0 | 1 | 2 | 3;
  readonly score: number;
  readonly nearestSource: string | null;
}

interface CandidateV7 {
  readonly id: EntityIdV7;
  readonly component: InterestComponentV7;
  readonly position: Vec3V7;
  readonly distanceSquared: number;
  readonly source: InterestSourceV7 | null;
}

const lodFromDistance = (distance: number, distances: readonly [number, number, number, number]): 0 | 1 | 2 | 3 =>
  distance <= distances[0] ? 0 : distance <= distances[1] ? 1 : distance <= distances[2] ? 2 : 3;

export class InterestManagerV7 {
  readonly #budget: InterestBudgetV7;
  #distances: readonly [number, number, number, number] = [48, 110, 220, 420];

  constructor(budget: InterestBudgetV7) {
    this.#budget = Object.freeze({
      maxSimulation: Math.max(1, Math.trunc(budget.maxSimulation)),
      maxRender: Math.max(1, Math.trunc(budget.maxRender)),
      maxNetwork: Math.max(1, Math.trunc(budget.maxNetwork)),
    });
  }

  setLodDistances(distances: readonly [number, number, number, number]): void {
    if (distances.some((distance, index) => !Number.isFinite(distance) || (index > 0 && distance < distances[index - 1]!))) throw new RangeError('LOD distances must be sorted and finite');
    this.#distances = Object.freeze([...distances] as typeof this.#distances);
  }

  score(component: InterestComponentV7, distanceSquared: number, sourceWeight = 1): number {
    const distance = Math.sqrt(Math.max(0, distanceSquared));
    const distanceScore = 1 / (1 + distance * 0.02);
    const priority = clampV7(component.priority, -1000, 1000) / 1000;
    return (component.alwaysRelevant ? 10 : 0) + priority + distanceScore * sourceWeight;
  }

  decide(candidates: readonly CandidateV7[]): readonly InterestDecisionV7[] {
    const ranked = candidates.map((candidate) => {
      const distance = Math.sqrt(Math.max(0, candidate.distanceSquared));
      const score = this.score(candidate.component, candidate.distanceSquared, candidate.source?.weight ?? 1);
      const lod = candidate.component.alwaysRelevant ? 0 : lodFromDistance(distance, this.#distances);
      return {
        id: candidate.id,
        score,
        simulationLod: Math.min(lod, candidate.component.simulationLod) as 0 | 1 | 2 | 3,
        renderLod: Math.min(lod, candidate.component.renderLod) as 0 | 1 | 2 | 3,
        source: candidate.source,
        distance,
      };
    }).sort((a, b) => Number(b.score - a.score) || Number(a.id) - Number(b.id));

    const simulationIds = new Set(ranked.slice(0, this.#budget.maxSimulation).map((item) => Number(item.id)));
    const renderIds = new Set(ranked.slice(0, this.#budget.maxRender).map((item) => Number(item.id)));
    const networkIds = new Set(ranked.slice(0, this.#budget.maxNetwork).map((item) => Number(item.id)));

    return Object.freeze(ranked.map((item) => Object.freeze({
      id: item.id,
      simulation: item.source?.alwaysRelevant === true || simulationIds.has(Number(item.id)),
      render: item.source?.alwaysRelevant === true || renderIds.has(Number(item.id)),
      network: item.source?.alwaysRelevant === true || networkIds.has(Number(item.id)),
      simulationLod: item.simulationLod,
      renderLod: item.renderLod,
      score: Number(item.score.toFixed(6)),
      nearestSource: item.source?.id ?? null,
    })));
  }

  static buildCandidates(
    entities: readonly { readonly id: EntityIdV7; readonly component: InterestComponentV7; readonly position: Vec3V7 }[],
    sources: readonly InterestSourceV7[],
  ): readonly CandidateV7[] {
    return Object.freeze(entities.map((entity) => {
      const nearest = [...sources]
        .map((source) => ({ source, distanceSquared: distanceSquaredV7(entity.position, source.position) }))
        .filter(({ source, distanceSquared }) => source.alwaysRelevant || distanceSquared <= source.radius * source.radius)
        .sort((a, b) => a.distanceSquared - b.distanceSquared || a.source.id.localeCompare(b.source.id))[0];
      return Object.freeze({
        id: entity.id,
        component: entity.component,
        position: entity.position,
        distanceSquared: nearest?.distanceSquared ?? Number.POSITIVE_INFINITY,
        source: nearest?.source ?? null,
      });
    }));
  }

  static fromSpatial(
    spatial: readonly SpatialQueryResultV7[],
    positions: ReadonlyMap<EntityIdV7, Vec3V7>,
    components: ReadonlyMap<EntityIdV7, InterestComponentV7>,
  ): readonly CandidateV7[] {
    const output: CandidateV7[] = [];
    for (const hit of spatial) {
      const position = positions.get(hit.id);
      const component = components.get(hit.id);
      if (!position || !component) continue;
      output.push(Object.freeze({ id: hit.id, component, position, distanceSquared: hit.distanceSquared, source: null }));
    }
    return Object.freeze(output);
  }
}
