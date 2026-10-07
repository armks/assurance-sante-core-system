import type { Prisma } from '@prisma/client';

/**
 * Verrou transactionnel des plafonds annuels — MÊME clé que le microservice
 * (`AdjudicationService.java`), `pg_advisory_xact_lock(hashtextextended(<uuid>, 0))` :
 * - produit SANS plafond famille : la PERSONNE (adhérent, sinon bénéficiaire, sinon
 *   police) ;
 * - produit AVEC au moins un plafond famille (prisma/sql/069) : la FAMILLE, c.-à-d.
 *   l'adhérent titulaire — aussi pour un bénéficiaire (rattaché via
 *   `beneficiaires.adherent_id`). Deux membres d'une même famille partagent alors
 *   la clé : leurs factures et adjudications sont sérialisées.
 * La règle est au niveau du PRODUIT (et non de la garantie) : une facture couvre
 * plusieurs garanties, et la facture comme l'adjudication doivent toujours
 * choisir la même clé pour se sérialiser entre elles. Chacune lit alors les
 * cumuls APRÈS le commit de la précédente. Relâché au commit / rollback de `tx`.
 */
export async function verrouillerPlafond(
  tx: Prisma.TransactionClient,
  personne: {
    adherentId: string | null;
    beneficiaireId: string | null;
    policeId: string;
    produitId: string;
  },
): Promise<void> {
  let cle = personne.adherentId ?? personne.beneficiaireId ?? personne.policeId;
  const plafondFamille = await tx.garantie.count({
    where: {
      produitId: personne.produitId,
      deletedAt: null,
      plafondAnnuelFamille: { not: null },
    },
  });
  if (plafondFamille > 0) {
    const titulaire =
      personne.adherentId ??
      (personne.beneficiaireId
        ? (
            await tx.beneficiaire.findUnique({
              where: { id: personne.beneficiaireId },
              select: { adherentId: true },
            })
          )?.adherentId
        : null);
    if (titulaire) cle = titulaire;
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cle}, 0))`;
}

/**
 * Durée maximale d'une transaction qui appelle le microservice verrou tenu :
 * attente du verrou + appel HTTP (timeout `ADJUDICATION_TIMEOUT_MS`, 12 s) + écritures.
 */
export const DELAI_TRANSACTION_FACTURE_MS =
  Number(process.env.ADJUDICATION_TIMEOUT_MS ?? 12_000) + 18_000;
