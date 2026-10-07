import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AdjudicationClientService,
  MESSAGES_INDISPONIBILITE,
} from '../adjudication-client/adjudication-client.service';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { AdherentService } from './adherent.service';
import { ROLES_LECTURE_PLAFONDS } from './member.types';

/** Restant d'une personne de la famille pour une garantie (`restant` null : pas de plafond personne). */
export interface PlafondPersonne {
  type: 'TITULAIRE' | 'BENEFICIAIRE';
  id: string;
  nom: string;
  prenom: string;
  consomme: number;
  restant: number | null;
}

export interface PlafondGarantie {
  garantieId: string;
  categorieActe: string;
  plafondPersonne: number | null;
  plafondFamille: number | null;
  consommeFamille: number | null;
  restantFamille: number | null;
  personnes: PlafondPersonne[];
}

export interface PlafondsFamille {
  /** Période de cumul en cours, bornes incluses (`YYYY-MM-DD`) ; null sans police. */
  periode: { mode: 'ANNEE_POLICE' | 'ANNEE_CIVILE'; debut: string; fin: string } | null;
  garanties: PlafondGarantie[];
}

/**
 * Plafonds annuels restants d'une famille (prisma/sql/069), affichés à l'adhérent
 * et à sa société. Le CALCUL (cumuls, période, restant) est fait par le
 * microservice d'adjudication — ce service ne fait que contrôler l'accès et
 * nommer les personnes.
 */
@Injectable()
export class PlafondsService {
  private readonly logger = new Logger(PlafondsService.name);

  constructor(
    private readonly identity: IdentityService,
    private readonly adherents: AdherentService,
    private readonly adjudication: AdjudicationClientService,
  ) {}

  async plafondsFamille(user: AuthenticatedUser, adherentId: string): Promise<PlafondsFamille> {
    const { permissions } = await this.identity.getMe(user);
    const roles = permissions?.roleChain ?? [];
    if (!roles.some((r) => (ROLES_LECTURE_PLAFONDS as readonly string[]).includes(r))) {
      throw new ForbiddenException(
        "Le suivi des plafonds est réservé à l'adhérent, à sa société (contact principal ou administration) et au personnel de l'assureur habilité.",
      );
    }
    // Périmètre : son propre dossier pour un adhérent, ses propres adhérents pour
    // une société, son organisation pour l'assureur (404 sinon).
    const adherent = await this.adherents.obtenirAdherent(user, adherentId);
    if (!adherent.police) {
      return { periode: null, garanties: [] };
    }

    let etat;
    try {
      etat = await this.adjudication.etatPlafonds(adherent.police.id, adherent.id);
    } catch (err) {
      this.logger.error(
        `Plafonds de l'adhérent ${adherent.id} indisponibles : ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(MESSAGES_INDISPONIBILITE.plafonds);
    }

    const beneficiaires = new Map(adherent.beneficiaires.map((b) => [b.id, b]));
    return {
      periode: etat.periode,
      garanties: etat.garanties.map((g) => ({
        garantieId: g.garantie_id,
        categorieActe: g.categorie_acte,
        plafondPersonne: g.plafond_personne,
        plafondFamille: g.plafond_famille,
        consommeFamille: g.consomme_famille,
        restantFamille: g.restant_famille,
        personnes: g.personnes.flatMap((p): PlafondPersonne[] => {
          if (p.adherent_id) {
            return [{
              type: 'TITULAIRE',
              id: adherent.id,
              nom: adherent.nom,
              prenom: adherent.prenom,
              consomme: p.consomme,
              restant: p.restant,
            }];
          }
          const b = p.beneficiaire_id ? beneficiaires.get(p.beneficiaire_id) : undefined;
          return b
            ? [{
                type: 'BENEFICIAIRE',
                id: b.id,
                nom: b.nom,
                prenom: b.prenom,
                consomme: p.consomme,
                restant: p.restant,
              }]
            : [];
        }),
      })),
    };
  }
}
