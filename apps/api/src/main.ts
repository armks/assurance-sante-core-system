import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import compression from 'compression';
import { AppModule } from './app.module';

/**
 * Secrets sans lesquels le serveur ne doit PAS servir de trafic : un démarrage
 * « réussi » suivi d'un échec silencieux (401 au premier appel d'adjudication)
 * est pire qu'un refus net et explicite au boot.
 *
 * Appelé APRÈS `NestFactory.create` — c'est `ConfigModule.forRoot` qui charge
 * `apps/api/.env` dans `process.env`, pendant l'initialisation des modules.
 */
async function verifierSecretsObligatoires(
  app: INestApplication,
): Promise<void> {
  const secretJwtService = process.env.SERVICE_JWT_SECRET?.trim();
  if (!secretJwtService) {
    Logger.error(
      "Démarrage refusé : SERVICE_JWT_SECRET est absent ou vide dans l'environnement.\n" +
        'Ce secret HMAC signe le JWT de service utilisé pour appeler adjudication-service ;\n' +
        "sans lui, toute soumission de réclamation échouerait en 401 au moment de l'appel HTTP.\n" +
        'Renseignez SERVICE_JWT_SECRET dans apps/api/.env — valeur IDENTIQUE à adjudication-service/.env.',
      'Bootstrap',
    );
    await app.close();
    process.exit(1);
  }
}

/**
 * Une promesse rejetée sans `catch` (appel réseau, base indisponible...) fait quitter Node
 * par défaut : le port 3001 se fermait « tout seul ». On journalise et on garde le serveur
 * en vie ; le démarrage reste, lui, refusé net (voir `verifierSecretsObligatoires`).
 */
function garderLeServeurEnVie(): void {
  const journal = new Logger('Processus');
  process.on('unhandledRejection', (raison) => {
    journal.error(`Promesse rejetée non gérée : ${raison instanceof Error ? (raison.stack ?? raison.message) : String(raison)}`);
  });
  process.on('uncaughtException', (erreur) => {
    journal.error(`Exception non interceptée : ${erreur.stack ?? erreur.message}`);
  });
}

async function bootstrap(): Promise<void> {
  garderLeServeurEnVie();
  const app = await NestFactory.create(AppModule);

  await verifierSecretsObligatoires(app);

  // Réponses JSON compressées (gzip) : les listes volumineuses circulent 5 à 10 fois plus légères
  app.use(compression());

  // Toutes les routes sont préfixées /api/v1 → GET /api/v1/identity/me
  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
}

void bootstrap();
