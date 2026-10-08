/**
 * Double de test de `DependancesService` pour les specs des modules métier : toute
 * action est possible par défaut. Pour tester un refus, faire rejeter `assertPossible`
 * (ex. `new ConflictException({ message: '…' })`).
 */
export function dependancesDeTest() {
  const possible = (entite: string, id: string, action: string) => ({
    entite,
    id,
    nom: '',
    action,
    possible: true,
    raison: null,
    liens: [],
  });
  return {
    assertPossible: jest.fn(async (_u: unknown, entite: string, id: string, action: string) => possible(entite, id, action)),
    verifier: jest.fn(async (_u: unknown, entite: string, id: string, action: string) => possible(entite, id, action)),
    verifierTout: jest.fn(async () => []),
  };
}
