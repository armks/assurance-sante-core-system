import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
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

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  await verifierSecretsObligatoires(app);

  // Toutes les routes sont préfixées /api/v1 → GET /api/v1/identity/me
  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
}

void bootstrap();
