import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type CleStatistique = 'codesConsultation' | 'ordonnancesTraitees' | 'ticketsSoins' | 'facturesReglees';

export interface StatistiquesPubliques {
  /** Dernier jour inclus (AAAA-MM-JJ) : les compteurs s'arrêtent la veille à minuit (UTC = heure d'Abidjan). */
  arreteAu: string;
  seuilMinimum: number;
  /** `null` = volume sous le seuil : le nombre n'est PAS transmis, même arrondi. */
  compteurs: Record<CleStatistique, number | null>;
}

/** Plancher absolu du seuil, quelle que soit la configuration. */
export const SEUIL_PLANCHER = 10;
const SEUIL_PAR_DEFAUT = 100;

/**
 * Arrondi vers le bas, pour affichage « plus de N » : à la dizaine sous 1 000,
 * à la centaine sous 10 000, au millier au-delà. `null` sous le seuil.
 */
export function arrondiPublic(valeur: number, seuil: number): number | null {
  if (valeur < seuil) return null;
  const pas = valeur < 1_000 ? 10 : valeur < 10_000 ? 100 : 1_000;
  return Math.floor(valeur / pas) * pas;
}

/**
 * Statistiques publiques de la page d'accueil : quatre compteurs AGRÉGÉS sur
 * toute la plateforme (toutes organisations confondues : la page publique n'a
 * pas de contexte de tenant). Jamais de détail, jamais de ventilation par
 * organisation, établissement ou société.
 *
 * Protection contre la déduction (données de santé et volumes d'activité) :
 *   1. instantané quotidien : seuls les enregistrements créés avant aujourd'hui
 *      00:00 UTC sont comptés, calculés une fois par jour (cache mémoire). Aucun
 *      incrément en temps réel ne peut être rapproché d'une visite précise ;
 *   2. arrondi vers le bas (`arrondiPublic`) ;
 *   3. seuil minimum par compteur (`STATS_SEUIL_MINIMUM`, 100 par défaut,
 *      jamais moins de 10) : sous le seuil, le nombre n'est pas renvoyé du tout.
 */
@Injectable()
export class StatistiquesService {
  private readonly logger = new Logger(StatistiquesService.name);
  private cache: { jour: string; donnees: StatistiquesPubliques } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Horloge (surchargée dans les tests). */
  maintenant(): Date {
    return new Date();
  }

  get seuil(): number {
    const brut = Number(process.env.STATS_SEUIL_MINIMUM);
    const seuil = Number.isFinite(brut) && brut > 0 ? Math.floor(brut) : SEUIL_PAR_DEFAUT;
    return Math.max(seuil, SEUIL_PLANCHER);
  }

  async obtenir(): Promise<StatistiquesPubliques> {
    const debutJour = new Date(this.maintenant());
    debutJour.setUTCHours(0, 0, 0, 0);
    const jour = debutJour.toISOString().slice(0, 10);
    if (this.cache?.jour === jour && this.cache.donnees.seuilMinimum === this.seuil) {
      return this.cache.donnees;
    }

    const avant = { lt: debutJour };
    const [codes, ordonnances, tickets, facturesEtab, facturesPharma] = await Promise.all([
      this.prisma.codeConsultation.count({ where: { createdAt: avant } }),
      this.prisma.ordonnance.count({
        where: {
          createdAt: avant,
          deletedAt: null,
          statut: { in: ['PARTIELLEMENT_DELIVREE', 'COMPLETEMENT_DELIVREE'] },
        },
      }),
      this.prisma.ticketSoins.count({ where: { createdAt: avant, statut: { not: 'ANNULE' } } }),
      this.prisma.factureMensuelleEtablissement.count({ where: { createdAt: avant, statut: 'PAYEE' } }),
      this.prisma.factureMensuellePharmacie.count({ where: { createdAt: avant, statut: 'PAYEE' } }),
    ]);

    const veille = new Date(debutJour.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const seuil = this.seuil;
    const donnees: StatistiquesPubliques = {
      arreteAu: veille,
      seuilMinimum: seuil,
      compteurs: {
        codesConsultation: arrondiPublic(codes, seuil),
        ordonnancesTraitees: arrondiPublic(ordonnances, seuil),
        ticketsSoins: arrondiPublic(tickets, seuil),
        facturesReglees: arrondiPublic(facturesEtab + facturesPharma, seuil),
      },
    };
    this.cache = { jour, donnees };
    this.logger.log(`Statistiques publiques recalculées (arrêtées au ${veille}).`);
    return donnees;
  }
}
