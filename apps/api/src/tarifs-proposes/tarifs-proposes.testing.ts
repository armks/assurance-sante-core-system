import type { TarifsProposesService } from './tarifs-proposes.service';

/** Doublure de TarifsProposesService pour les tests des autres services (aucune ligne à réintégrer, rien en examen). */
export function tarifsProposesDeTest() {
  return {
    synchroniserLignes: jest.fn(async (): Promise<number> => 0),
    actesEnExamen: jest.fn(async () => [] as Awaited<ReturnType<TarifsProposesService['actesEnExamen']>>),
  };
}
