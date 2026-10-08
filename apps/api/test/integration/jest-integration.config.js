/**
 * Tests d'INTÉGRATION — hors suite normale (`npm test` ne regarde que src/**\/*.spec.ts).
 * Lancement : `npm run test:integration` (apps/api) — voir README.md de ce dossier.
 * Ils appellent l'API RÉELLE (et donc le microservice Java) et écrivent en base :
 * séquentiels, délai large.
 * @type {import('jest').Config}
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.int-spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  testEnvironment: 'node',
  testTimeout: 180_000,
  maxWorkers: 1,
};
