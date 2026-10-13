import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { acteurCourant, type PerimetreActeur } from '../common/acteur.context';

/** Opérations d'écriture journalisées : création / modification / suppression. */
const OPERATIONS_JOURNALISEES: Record<string, 'CREATION' | 'MODIFICATION' | 'SUPPRESSION'> = {
  create: 'CREATION',
  createMany: 'CREATION',
  createManyAndReturn: 'CREATION',
  update: 'MODIFICATION',
  updateMany: 'MODIFICATION',
  upsert: 'MODIFICATION',
  delete: 'SUPPRESSION',
  deleteMany: 'SUPPRESSION',
};

/** Tables jamais journalisées : le journal lui-même et l'audit applicatif (déjà une trace d'identité). */
const MODELES_EXCLUS = new Set(['JournalAction', 'AuditLog']);

/** Noms des champs écrits (jamais les valeurs : données de santé / personnelles). */
function champsEcrits(args: unknown): string[] {
  const a = (args ?? {}) as { data?: unknown; create?: unknown; update?: unknown };
  const source = a.update ?? a.data ?? a.create;
  const ligne = Array.isArray(source) ? source[0] : source;
  return ligne && typeof ligne === 'object' ? Object.keys(ligne as object).slice(0, 60) : [];
}

/**
 * Client Prisma partagé — connexion SQL directe à la base Postgres de Supabase
 * (v18 §5 : NestJS se connecte via Prisma pour garder un vrai contrôle
 * transactionnel, la RLS Postgres restant active en défense en profondeur).
 *
 * Traçabilité : chaque écriture (création, modification, suppression) faite dans le traitement d'une requête
 * authentifiée est inscrite au journal des actions (`journal_actions`, prisma/sql/092) avec l'identité de
 * l'utilisateur, son rôle et son rattachement au moment de l'action. Le client exposé est donc l'extension
 * du client de base ; la transaction interactive l'utilise aussi. Une écriture hors requête (tâche interne) n'est attribuée à personne.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private static readonly logger = new Logger('Journal');

  constructor() {
    super();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const base = this as PrismaClient;
    const charger = (userId: string): Promise<PerimetreActeur> =>
      base.profil
        .findUnique({
          where: { id: userId },
          select: { role: true, organisationId: true, etablissementId: true, pharmacieId: true, societeId: true },
        })
        .then((p) => p ?? { role: null, organisationId: null, etablissementId: null, pharmacieId: null, societeId: null });

    const etendu = base.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const resultat = await query(args);
            const nature = OPERATIONS_JOURNALISEES[operation];
            const acteur = acteurCourant();
            if (!nature || !acteur || MODELES_EXCLUS.has(model)) return resultat;
            try {
              acteur.perimetre ??= charger(acteur.userId);
              const perimetre = await acteur.perimetre;
              const id = resultat && typeof resultat === 'object' && 'id' in resultat ? String((resultat as { id: unknown }).id) : null;
              const lot = resultat && typeof resultat === 'object' && 'count' in resultat ? (resultat as { count: number }).count : null;
              await base.journalAction.create({
                data: {
                  userId: acteur.userId,
                  ...perimetre,
                  tableCible: model,
                  enregistrementId: id,
                  operation: nature,
                  champsModifies: nature === 'SUPPRESSION' ? [] : champsEcrits(args),
                  requete: lot !== null ? `${operation}:${lot}` : operation,
                },
              });
            } catch (e) {
              // la trace ne doit jamais faire échouer l'opération métier déjà réalisée ; l'échec est signalé
              PrismaService.logger.error(`Écriture non journalisée (${model}.${operation}) : ${e instanceof Error ? e.message : e}`);
            }
            return resultat;
          },
        },
      },
    });
    // Le service exposé est le client étendu : ses méthodes de classe (cycle de vie) restent héritées par la chaîne de prototypes.
    return etendu as unknown as this;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
