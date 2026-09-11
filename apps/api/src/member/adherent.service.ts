import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ChangerStatutDto,
  CreateAdherentDto,
  CreateBeneficiaireDto,
  UpdateAdherentDto,
  UpdateBeneficiaireDto,
} from './dto/member.dto';
import {
  ContexteAppelant,
  ENTITE_ADHERENT,
  ENTITE_SOCIETE_AFFILIEE,
  ROLE_GESTION_MEMBRE_SOCIETE,
  ROLES_GESTION_MEMBRE,
} from './member.types';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * AdherentService — fichier des membres (v9 phase 3, PROMPT 12).
 *
 * Adhérents (titulaires) + bénéficiaires (ayants droit). `numero_adherent` et
 * `numero_carte` sont générés **en base** (séquences `adherents_numero_seq` /
 * `cartes_membre_numero_seq`, prisma/sql/022) : atomique, sans collision, même
 * sous insertions concurrentes — le service ne les calcule pas, il les expose.
 *
 * Écriture réservée au personnel ASSUREUR habilité (ROLES_GESTION_MEMBRE) et à
 * SOCIETE_ADMINISTRATION pour les adhérents de SON souscripteur. Défense en
 * profondeur : ces règles doublent la policy RLS `adherents_ecriture` — le
 * chemin NestJS passe par `postgres` (pooler) et contourne la RLS.
 */
@Injectable()
export class AdherentService {
  private readonly logger = new Logger(AdherentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  // --- Adhérents -----------------------------------------------------

  async creerAdherent(user: AuthenticatedUser, dto: CreateAdherentDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx, dto.souscripteurId);

    const souscripteur = await this.prisma.souscripteur.findFirst({
      where: {
        id: dto.souscripteurId,
        organisationId: ctx.organisationId,
        deletedAt: null,
      },
    });
    if (!souscripteur) {
      throw new NotFoundException(
        'Souscripteur inconnu ou hors de votre organisation.',
      );
    }

    if (dto.policeId) {
      await this.assertPoliceDuSouscripteur(
        ctx.organisationId,
        dto.policeId,
        dto.souscripteurId,
      );
    }

    const id = await this.prisma.$transaction(async (tx) => {
      const adherent = await tx.adherent.create({
        data: {
          organisationId: ctx.organisationId,
          souscripteurId: dto.souscripteurId,
          policeId: dto.policeId ?? null,
          nom: dto.nom,
          prenom: dto.prenom,
          dateNaissance: new Date(dto.dateNaissance),
          sexe: dto.sexe,
          ibanOuRib: dto.ibanOuRib ?? null,
          banqueNom: dto.banqueNom ?? null,
          modePaiementPrefere: dto.modePaiementPrefere ?? null,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'CREATION_ADHERENT',
        adherent.id,
        {
          numeroAdherent: adherent.numeroAdherent,
          numeroCarte: adherent.numeroCarte,
          souscripteurId: dto.souscripteurId,
        },
        'adherents',
      );
      return adherent.id;
    });

    return this.chargerAdherent(ctx, id);
  }

  async listerAdherents(
    user: AuthenticatedUser,
    filtres: { statut?: string; souscripteurId?: string; q?: string },
  ) {
    const ctx = await this.contexteAppelant(user);
    return this.prisma.adherent.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        // Lecture scopée à SON souscripteur pour TOUT rôle SOCIETE_AFFILIEE
        // (administration, assurée, comptable, réception) — pas seulement
        // SOCIETE_ADMINISTRATION, qui seul a le droit d'ÉCRIRE (assertGestion).
        ...(ctx.entite === ENTITE_SOCIETE_AFFILIEE
          ? { souscripteurId: ctx.societeId ?? '__aucun__' }
          : {}),
        // Fuite inter-adhérent corrigée (audit dashboard adhérent) : un compte
        // ADHERENT ne liste jamais que lui-même, jamais le fichier des membres
        // de toute l'organisation.
        ...(ctx.entite === ENTITE_ADHERENT
          ? { id: ctx.adherentId ?? '__aucun__' }
          : {}),
        ...(filtres.statut ? { statut: filtres.statut } : {}),
        ...(filtres.souscripteurId
          ? { souscripteurId: filtres.souscripteurId }
          : {}),
        ...(filtres.q
          ? {
              OR: [
                { nom: { contains: filtres.q, mode: 'insensitive' } },
                { prenom: { contains: filtres.q, mode: 'insensitive' } },
                { numeroAdherent: { contains: filtres.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
      include: {
        _count: { select: { beneficiaires: { where: { deletedAt: null } } } },
        souscripteur: { select: { id: true, nom: true, type: true } },
        police: {
          select: {
            id: true,
            numeroPolice: true,
            statut: true,
            produit: { select: { nom: true, version: true } },
          },
        },
      },
    });
  }

  async obtenirAdherent(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    return this.chargerAdherent(ctx, id);
  }

  async modifierAdherent(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateAdherentDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    const actuel = await this.chargerAdherent(ctx, id);
    this.assertGestion(ctx, actuel.souscripteurId);

    if (dto.policeId) {
      await this.assertPoliceDuSouscripteur(
        ctx.organisationId,
        dto.policeId,
        actuel.souscripteurId,
      );
    }

    const data: Prisma.AdherentUpdateInput = {};
    if (dto.policeId !== undefined) {
      data.police = { connect: { id: dto.policeId } };
    }
    if (dto.nom !== undefined) data.nom = dto.nom;
    if (dto.prenom !== undefined) data.prenom = dto.prenom;
    if (dto.dateNaissance !== undefined) {
      data.dateNaissance = new Date(dto.dateNaissance);
    }
    if (dto.sexe !== undefined) data.sexe = dto.sexe;
    if (dto.ibanOuRib !== undefined) data.ibanOuRib = dto.ibanOuRib;
    if (dto.banqueNom !== undefined) data.banqueNom = dto.banqueNom;
    if (dto.modePaiementPrefere !== undefined) {
      data.modePaiementPrefere = dto.modePaiementPrefere;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.adherent.update({ where: { id }, data });
      await this.audit(
        tx,
        ctx.userId,
        'MODIFICATION_ADHERENT',
        id,
        { champs: Object.keys(data) },
        'adherents',
      );
    });

    return this.chargerAdherent(ctx, id);
  }

  async changerStatutAdherent(
    user: AuthenticatedUser,
    id: string,
    dto: ChangerStatutDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    const actuel = await this.chargerAdherent(ctx, id);
    this.assertGestion(ctx, actuel.souscripteurId);

    await this.prisma.$transaction(async (tx) => {
      await tx.adherent.update({
        where: { id },
        data: { statut: dto.statut },
      });
      await this.audit(
        tx,
        ctx.userId,
        'CHANGEMENT_STATUT_ADHERENT',
        id,
        { de: actuel.statut, vers: dto.statut, motif: dto.motif ?? null },
        'adherents',
      );
    });

    return this.chargerAdherent(ctx, id);
  }

  async supprimerAdherent(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    const actuel = await this.chargerAdherent(ctx, id);
    this.assertGestion(ctx, actuel.souscripteurId);

    await this.prisma.$transaction(async (tx) => {
      const maintenant = new Date();
      await tx.adherent.update({
        where: { id },
        data: { deletedAt: maintenant },
      });
      await tx.beneficiaire.updateMany({
        where: { adherentId: id, deletedAt: null },
        data: { deletedAt: maintenant },
      });
      await this.audit(
        tx,
        ctx.userId,
        'SUPPRESSION_ADHERENT',
        id,
        null,
        'adherents',
      );
    });
  }

  // --- Bénéficiaires -------------------------------------------------

  async ajouterBeneficiaire(
    user: AuthenticatedUser,
    adherentId: string,
    dto: CreateBeneficiaireDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    const adherent = await this.chargerAdherent(ctx, adherentId);
    this.assertGestion(ctx, adherent.souscripteurId);

    const id = await this.prisma.$transaction(async (tx) => {
      const benef = await tx.beneficiaire.create({
        data: {
          adherentId,
          lienParente: dto.lienParente,
          nom: dto.nom,
          prenom: dto.prenom,
          dateNaissance: new Date(dto.dateNaissance),
          sexe: dto.sexe,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'AJOUT_BENEFICIAIRE',
        benef.id,
        {
          adherentId,
          numeroCarte: benef.numeroCarte,
          lienParente: dto.lienParente,
        },
        'beneficiaires',
      );
      return benef.id;
    });

    return this.chargerBeneficiaire(ctx, adherentId, id);
  }

  async listerBeneficiaires(user: AuthenticatedUser, adherentId: string) {
    const ctx = await this.contexteAppelant(user);
    await this.chargerAdherent(ctx, adherentId);
    return this.prisma.beneficiaire.findMany({
      where: { adherentId, deletedAt: null },
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    });
  }

  async modifierBeneficiaire(
    user: AuthenticatedUser,
    adherentId: string,
    beneficiaireId: string,
    dto: UpdateBeneficiaireDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    const adherent = await this.chargerAdherent(ctx, adherentId);
    this.assertGestion(ctx, adherent.souscripteurId);
    await this.chargerBeneficiaire(ctx, adherentId, beneficiaireId);

    const data: Prisma.BeneficiaireUpdateInput = {};
    if (dto.lienParente !== undefined) data.lienParente = dto.lienParente;
    if (dto.nom !== undefined) data.nom = dto.nom;
    if (dto.prenom !== undefined) data.prenom = dto.prenom;
    if (dto.dateNaissance !== undefined) {
      data.dateNaissance = new Date(dto.dateNaissance);
    }
    if (dto.sexe !== undefined) data.sexe = dto.sexe;

    await this.prisma.$transaction(async (tx) => {
      await tx.beneficiaire.update({ where: { id: beneficiaireId }, data });
      await this.audit(
        tx,
        ctx.userId,
        'MODIFICATION_BENEFICIAIRE',
        beneficiaireId,
        { adherentId, champs: Object.keys(data) },
        'beneficiaires',
      );
    });

    return this.chargerBeneficiaire(ctx, adherentId, beneficiaireId);
  }

  async changerStatutBeneficiaire(
    user: AuthenticatedUser,
    adherentId: string,
    beneficiaireId: string,
    dto: ChangerStatutDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    const adherent = await this.chargerAdherent(ctx, adherentId);
    this.assertGestion(ctx, adherent.souscripteurId);
    const actuel = await this.chargerBeneficiaire(
      ctx,
      adherentId,
      beneficiaireId,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.beneficiaire.update({
        where: { id: beneficiaireId },
        data: { statut: dto.statut },
      });
      await this.audit(
        tx,
        ctx.userId,
        'CHANGEMENT_STATUT_BENEFICIAIRE',
        beneficiaireId,
        {
          adherentId,
          de: actuel.statut,
          vers: dto.statut,
          motif: dto.motif ?? null,
        },
        'beneficiaires',
      );
    });

    return this.chargerBeneficiaire(ctx, adherentId, beneficiaireId);
  }

  async supprimerBeneficiaire(
    user: AuthenticatedUser,
    adherentId: string,
    beneficiaireId: string,
  ) {
    const ctx = await this.contexteAppelant(user);
    const adherent = await this.chargerAdherent(ctx, adherentId);
    this.assertGestion(ctx, adherent.souscripteurId);
    await this.chargerBeneficiaire(ctx, adherentId, beneficiaireId);

    await this.prisma.$transaction(async (tx) => {
      await tx.beneficiaire.update({
        where: { id: beneficiaireId },
        data: { deletedAt: new Date() },
      });
      await this.audit(
        tx,
        ctx.userId,
        'SUPPRESSION_BENEFICIAIRE',
        beneficiaireId,
        { adherentId },
        'beneficiaires',
      );
    });
  }

  // --- Helpers ------------------------------------------------------

  private async contexteAppelant(
    user: AuthenticatedUser,
  ): Promise<ContexteAppelant> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) {
      throw new ForbiddenException(
        "Ce compte n'est rattaché à aucune organisation.",
      );
    }
    return {
      userId: profil.id,
      organisationId: profil.organisationId,
      roleChain: permissions?.roleChain ?? [],
      societeId: profil.societeId ?? null,
      entite: profil.entite ?? null,
      adherentId: profil.adherentId ?? null,
    };
  }

  private aRoleAssureur(ctx: ContexteAppelant): boolean {
    return ctx.roleChain.some((code) =>
      (ROLES_GESTION_MEMBRE as readonly string[]).includes(code),
    );
  }

  /**
   * Écriture autorisée si : rôle ASSUREUR habilité, OU SOCIETE_ADMINISTRATION
   * dont le `societe_id` correspond au souscripteur de l'adhérent visé.
   */
  private assertGestion(
    ctx: ContexteAppelant,
    souscripteurId: string | null,
  ): void {
    if (this.aRoleAssureur(ctx)) return;

    if (
      ctx.roleChain.includes(ROLE_GESTION_MEMBRE_SOCIETE) &&
      souscripteurId !== null &&
      ctx.societeId === souscripteurId
    ) {
      return;
    }

    throw new ForbiddenException(
      "La gestion du fichier des membres est réservée au personnel ASSUREUR habilité, ou à SOCIETE_ADMINISTRATION pour ses propres adhérents.",
    );
  }

  private async assertPoliceDuSouscripteur(
    organisationId: string,
    policeId: string,
    souscripteurId: string,
  ): Promise<void> {
    const police = await this.prisma.police.findFirst({
      where: { id: policeId, organisationId, deletedAt: null },
    });
    if (!police) {
      throw new NotFoundException('Police inconnue ou hors de votre organisation.');
    }
    if (police.souscripteurId !== souscripteurId) {
      throw new ForbiddenException(
        "Cette police n'appartient pas au souscripteur de l'adhérent.",
      );
    }
  }

  private async chargerAdherent(ctx: ContexteAppelant, id: string) {
    const adherent = await this.prisma.adherent.findFirst({
      where: { id, organisationId: ctx.organisationId, deletedAt: null },
      include: {
        beneficiaires: {
          where: { deletedAt: null },
          orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
        },
        souscripteur: { select: { id: true, nom: true, type: true } },
        police: {
          select: {
            id: true,
            numeroPolice: true,
            statut: true,
            dateDebut: true,
            dateFin: true,
            produit: { select: { id: true, nom: true, version: true } },
          },
        },
      },
    });
    if (!adherent) {
      throw new NotFoundException('Adhérent introuvable.');
    }
    // Tout rôle SOCIETE_AFFILIEE (administration, assurée, comptable,
    // réception) ne voit que les adhérents de SON souscripteur.
    if (
      ctx.entite === ENTITE_SOCIETE_AFFILIEE &&
      adherent.souscripteurId !== ctx.societeId
    ) {
      throw new NotFoundException('Adhérent introuvable.');
    }
    // Fuite inter-adhérent corrigée (audit dashboard adhérent, même famille que
    // le fix reclamations du 2026-09-11) : un compte ADHERENT ne voit que SON
    // PROPRE enregistrement, jamais celui d'un autre adhérent de la même
    // organisation même en appelant cette route avec son ID direct. 404 (pas
    // 403) pour ne pas révéler qu'un autre adhérent existe à cet ID.
    if (ctx.entite === ENTITE_ADHERENT && adherent.id !== ctx.adherentId) {
      throw new NotFoundException('Adhérent introuvable.');
    }
    return adherent;
  }

  private async chargerBeneficiaire(
    ctx: ContexteAppelant,
    adherentId: string,
    beneficiaireId: string,
  ) {
    const benef = await this.prisma.beneficiaire.findFirst({
      where: { id: beneficiaireId, adherentId, deletedAt: null },
    });
    if (!benef) {
      throw new NotFoundException('Bénéficiaire introuvable.');
    }
    return benef;
  }

  /** Écriture d'audit — toujours via `log_audit()` (v9 §1.6). */
  private async audit(
    db: Db,
    userId: string,
    action: string,
    enregistrementId: string,
    details: Prisma.InputJsonValue | null,
    tableCible: string,
  ): Promise<void> {
    try {
      await db.$executeRaw`
        SELECT log_audit(
          ${action}::text,
          ${tableCible}::text,
          ${enregistrementId}::uuid,
          ${userId}::uuid,
          ${details === null ? null : JSON.stringify(details)}::jsonb
        )`;
    } catch (error) {
      this.logger.error(
        `Échec log_audit(${action}, ${enregistrementId}) : ${
          error instanceof Error ? error.message : 'erreur inconnue'
        }`,
      );
      throw error;
    }
  }
}
