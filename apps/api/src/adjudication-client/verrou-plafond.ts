import type { Prisma } from '@prisma/client';

/**
 * Verrou transactionnel du plafond annuel d'une PERSONNE assurée — MÊME clé que
 * le microservice (`AdjudicationService.java` : adhérent, sinon bénéficiaire,
 * sinon police ; `pg_advisory_xact_lock(hashtextextended(<uuid>, 0))`). Une
 * facture tiers payant et une adjudication de réclamation pour la même personne
 * sont donc sérialisées entre elles : chacune lit le cumul de l'année APRÈS le
 * commit de la précédente. Relâché au commit / rollback de `tx`.
 */
export async function verrouillerPlafondPersonne(
  tx: Prisma.TransactionClient,
  personne: {
    adherentId: string | null;
    beneficiaireId: string | null;
    policeId: string;
  },
): Promise<void> {
  const cle =
    personne.adherentId ?? personne.beneficiaireId ?? personne.policeId;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cle}, 0))`;
}

/**
 * Durée maximale d'une transaction qui appelle le microservice verrou tenu :
 * attente du verrou + appel HTTP (timeout `ADJUDICATION_TIMEOUT_MS`, 12 s) + écritures.
 */
export const DELAI_TRANSACTION_FACTURE_MS =
  Number(process.env.ADJUDICATION_TIMEOUT_MS ?? 12_000) + 18_000;
