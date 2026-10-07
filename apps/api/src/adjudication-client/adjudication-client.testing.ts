import type {
  DemandeSimulation,
  ResultatSimulation,
} from './adjudication-client.service';

/**
 * AIDE DE TEST UNIQUEMENT (jamais importée par le code applicatif).
 *
 * Client d'adjudication factice : `simuler` répond PAR DÉFAUT « 80 % de chaque
 * ligne, sans plafond » — valeur conventionnelle des tests existants, PAS la
 * règle de calcul (elle vit dans le microservice Java : `SimulationServiceTest`,
 * et le test HTTP réel vérifie la chaîne complète). Un test qui attend d'autres
 * montants fixe sa réponse avec `simuler.mockResolvedValueOnce(...)` ; un test
 * peut aussi vérifier la demande envoyée (`simuler.mock.calls`).
 */
export function adjudicationClientDeTest() {
  return {
    evaluer: jest.fn(),
    simuler: jest.fn(async (d: DemandeSimulation): Promise<ResultatSimulation> => ({
      lignes: d.lignes.map((l) => ({
        decision: 'AUTO_ADJUDIQUE' as const,
        montant_couvert: Math.round(Number(l.montant) * 80) / 100,
        plafond_restant_apres: null,
        codes_rejet: [],
      })),
    })),
  };
}

/** Réponse de simulation à montants fixés (dans l'ordre des lignes). */
export function reponseSimulation(...montantsCouverts: number[]): ResultatSimulation {
  return {
    lignes: montantsCouverts.map((m) => ({
      decision: 'AUTO_ADJUDIQUE' as const,
      montant_couvert: m,
      plafond_restant_apres: null,
      codes_rejet: [],
    })),
  };
}
