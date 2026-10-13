import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { MemberCarteService } from './carte.service';
import { validerContactsMembre } from './contacts-membre';
import {
  ArchiverMembreDto,
  ChangerStatutDto,
  CreateAdherentDto,
  CreateBeneficiaireDto,
  ProposerSortantsDto,
  UpdateAdherentDto,
  UpdateBeneficiaireDto,
  ValiderSortantsDto,
} from './dto/member.dto';
import type { FichierTeleverse } from './import-adherents.service';
import {
  ContexteAppelant,
  ENTITE_ADHERENT,
  ENTITE_SOCIETE_AFFILIEE,
  MIME_TYPES_PHOTO_AUTORISES,
  ROLE_GESTION_MEMBRE_SOCIETE,
  ROLE_PROPOSITION_SORTANT_SOCIETE,
  ROLE_RECHERCHE_CARTE,
  ROLE_VALIDATION_ADHERENT,
  ROLES_GESTION_MEMBRE,
  ROLES_PHOTO_PERSONNEL,
  ROLES_VALIDATION_BENEFICIAIRE_ASSUREUR,
  ROLES_VALIDATION_IMPORT_ADHERENTS,
  STATUT_ADHERENT_PROPOSE_SORTANT,
  STATUT_BENEFICIAIRE_EN_ATTENTE_ASSUREUR,
  STATUT_BENEFICIAIRE_EN_ATTENTE_SOCIETE,
  TAILLE_MAX_PHOTO_OCTETS,
} from './member.types';
import { DependancesService } from '../dependances/dependances.service';

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

  private readonly dureeUrlSigneePhoto = Number(
    process.env.PHOTO_URL_TTL_SECONDS ?? 3600,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly cartes: MemberCarteService,
    private readonly dependances: DependancesService,
  ) {}

  // --- Adhérents -----------------------------------------------------

  async creerAdherent(user: AuthenticatedUser, dto: CreateAdherentDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertCreationDirecte(ctx);
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
    if (souscripteur.statut === 'ARCHIVE') {
      throw new ConflictException(
        `La société cliente « ${souscripteur.nom} » est archivée : aucun nouvel adhérent. Désarchivez-la d'abord.`,
      );
    }

    if (dto.policeId) {
      await this.assertPoliceDuSouscripteur(
        ctx.organisationId,
        dto.policeId,
        dto.souscripteurId,
      );
    }

    const contacts = validerContactsMembre(dto.telephone, dto.email, true);
    await this.assertEmailLibre(contacts.email, null);

    const id = await this.prisma.$transaction(async (tx) => {
      const adherent = await tx.adherent.create({
        data: {
          organisationId: ctx.organisationId,
          souscripteurId: dto.souscripteurId,
          policeId: dto.policeId ?? null,
          telephone: contacts.telephone,
          email: contacts.email,
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

  /**
   * Valide un adhérent PRINCIPAL — réservé EXCLUSIVEMENT à ASSUREUR_EXPLOITATION
   * (jamais DIRECTION/INFORMATIQUE, qui peuvent créer l'adhérent mais pas le
   * valider — deux étapes distinctes). Stampe `dateValidation`/`valideParId`,
   * seul repère utilisé par `BillingService.genererCotisationsPeriode` pour la
   * coupure de facturation mensuelle. Jamais applicable à un `Beneficiaire`.
   */
  async validerAdherent(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.includes(ROLE_VALIDATION_ADHERENT)) {
      throw new ForbiddenException('La validation d’un adhérent est réservée à ASSUREUR_EXPLOITATION.');
    }
    const adherent = await this.prisma.adherent.findFirst({
      where: { id, organisationId: ctx.organisationId, deletedAt: null },
    });
    if (!adherent) {
      throw new NotFoundException('Adhérent introuvable.');
    }
    if (adherent.dateValidation) {
      throw new ConflictException(`Cet adhérent est déjà validé depuis le ${adherent.dateValidation.toISOString().slice(0, 10)}.`);
    }

    await this.prisma.$transaction(async (tx) => {
      const maintenant = new Date();
      await tx.adherent.update({
        where: { id },
        data: { dateValidation: maintenant, valideParId: ctx.userId },
      });
      await this.audit(tx, ctx.userId, 'VALIDATION_ADHERENT', id, { dateValidation: maintenant.toISOString() }, 'adherents');
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
        // Périmètres APRÈS les filtres client : ils écrasent un
        // `souscripteurId` fourni (une société qui demandait celui d'une autre
        // lisait ses adhérents — fuite inter-société, audit des filtres).
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

  /**
   * Identification par numéro de carte à l'accueil du centre médical — ADDITIF
   * au code de consultation (ne le remplace pas). Purement informatif :
   * renvoie le statut de l'adhérent OU du bénéficiaire portant ce numéro (les
   * deux partagent la même séquence `cartes_membre_numero_seq`, donc jamais
   * d'ambiguïté entre les deux tables) — n'ouvre aucun dossier, ne crée ni ne
   * modifie rien. Réservé exclusivement à CENTRE_MEDICAL_ACCUEIL (pas les
   * autres rôles CENTRE_MEDICAL_*, ni le personnel ASSUREUR).
   */
  async rechercherParNumeroCarte(user: AuthenticatedUser, numeroCarte: string) {
    if (!numeroCarte || !numeroCarte.trim()) {
      throw new BadRequestException('numeroCarte est requis.');
    }
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.includes(ROLE_RECHERCHE_CARTE)) {
      throw new ForbiddenException(
        "La recherche par numéro de carte est réservée à l'accueil du centre médical.",
      );
    }

    const adherent = await this.prisma.adherent.findFirst({
      where: {
        numeroCarte,
        organisationId: ctx.organisationId,
        deletedAt: null,
      },
      select: {
        id: true,
        nom: true,
        prenom: true,
        statut: true,
        numeroCarte: true,
        numeroAdherent: true,
      },
    });
    if (adherent) {
      return { type: 'ADHERENT_TITULAIRE' as const, ...adherent };
    }

    const beneficiaire = await this.prisma.beneficiaire.findFirst({
      where: {
        numeroCarte,
        deletedAt: null,
        adherent: { organisationId: ctx.organisationId, deletedAt: null },
      },
      select: {
        id: true,
        nom: true,
        prenom: true,
        statut: true,
        numeroCarte: true,
        lienParente: true,
        adherent: {
          select: {
            id: true,
            nom: true,
            prenom: true,
            statut: true,
            numeroAdherent: true,
          },
        },
      },
    });
    if (beneficiaire) {
      return { type: 'BENEFICIAIRE' as const, ...beneficiaire };
    }

    throw new NotFoundException('Aucun membre trouvé pour ce numéro de carte.');
  }

  /** Un e-mail identifie l'adhérent (invitation, notifications) : jamais deux fiches avec le même. */
  private async assertEmailLibre(email: string | null, sauf: string | null): Promise<void> {
    if (!email) return;
    const pris = await this.prisma.adherent.findFirst({
      where: { email, deletedAt: null, ...(sauf ? { id: { not: sauf } } : {}) },
      select: { id: true },
    });
    if (pris) throw new ConflictException(`Cet e-mail est déjà utilisé par un autre adhérent (${email}).`);
  }

  async modifierAdherent(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateAdherentDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    const actuel = await this.chargerAdherent(ctx, id);
    this.assertGestion(ctx, actuel.souscripteurId);
    // ADR-007 : un adhérent archivé (RADIE) ne se modifie pas — réactivez-le d'abord (409, refus tracé)
    await this.dependances.assertPossible(user, 'adherent', id, 'modifier');

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
    if (dto.telephone !== undefined || dto.email !== undefined) {
      const contacts = validerContactsMembre(dto.telephone, dto.email, false);
      if (dto.telephone !== undefined) data.telephone = contacts.telephone;
      if (dto.email !== undefined) {
        await this.assertEmailLibre(contacts.email, id);
        data.email = contacts.email;
      }
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
    this.assertStatutHorsArchivage('adhérent', actuel.statut, dto.statut);

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

    // ADR-007 : aucune suppression d'un élément encore lié (409 + raison, refus tracé)
    await this.dependances.assertPossible(user, 'adherent', id, 'supprimer');

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

  // --- Archivage (sortie) et désarchivage — ADR-007, lot 4 ------------------------

  /** Le statut RADIE (archivage) ne se pose ni ne se quitte par le changement de statut libre. */
  private assertStatutHorsArchivage(qui: string, actuel: string, cible: string): void {
    if (cible === 'RADIE' || actuel === 'RADIE') {
      throw new ConflictException(
        `Pour archiver ou désarchiver un ${qui} (statut RADIE), utilisez les actions « Archiver » / « Désarchiver » : elles vérifient les blocages et tracent la sortie.`,
      );
    }
  }

  /**
   * Archivage = SORTIE (RADIE). Refusé (409, raison et nombres, refus tracé) tant qu'un dossier
   * est ouvert, qu'une réclamation est en cours ou qu'une cotisation est due — pour l'adhérent
   * ET ses bénéficiaires, qui sont archivés avec lui (même transaction). Mécanisme sortants
   * existant respecté : une SOCIETE_ADMINISTRATION ne radie pas, elle PROPOSE la sortie
   * (PROPOSE_SORTANT → l'assureur la valide) ; l'assureur archive directement.
   */
  async archiverAdherent(user: AuthenticatedUser, id: string, dto: ArchiverMembreDto) {
    const ctx = await this.contexteAppelant(user);
    const actuel = await this.chargerAdherent(ctx, id);
    this.assertGestion(ctx, actuel.souscripteurId);
    await this.dependances.assertPossible(user, 'adherent', id, 'archiver');

    if (!this.aRoleAssureur(ctx)) {
      const motif = dto.motif ?? 'Sortie demandée par la société';
      await this.prisma.$transaction(async (tx) => {
        await tx.adherent.update({
          where: { id },
          data: { statut: STATUT_ADHERENT_PROPOSE_SORTANT, statutSortantCible: 'RADIE', motifSortie: motif },
        });
        await this.audit(tx, ctx.userId, 'PROPOSITION_SORTANT', id, { statutCible: 'RADIE', motif }, 'adherents');
      });
      return { ...(await this.chargerAdherent(ctx, id)), proposition: true };
    }

    await this.prisma.$transaction(async (tx) => {
      const radies = await this.radierAvecBeneficiaires(tx, id, dto.motif ?? actuel.motifSortie ?? null);
      await this.audit(
        tx,
        ctx.userId,
        'ARCHIVAGE_ADHERENT',
        id,
        { de: actuel.statut, motif: dto.motif ?? null, beneficiairesArchives: radies },
        'adherents',
      );
    });
    return this.chargerAdherent(ctx, id);
  }

  /** Statut RADIE + bénéficiaires non radiés → RADIE, dans la transaction de l'appelant. */
  private async radierAvecBeneficiaires(tx: Prisma.TransactionClient, adherentId: string, motif: string | null): Promise<number> {
    await tx.adherent.update({
      where: { id: adherentId },
      data: { statut: 'RADIE', statutSortantCible: null, ...(motif ? { motifSortie: motif } : {}) },
    });
    const r = await tx.beneficiaire.updateMany({
      where: { adherentId, deletedAt: null, statut: { not: 'RADIE' } },
      data: { statut: 'RADIE' },
    });
    return r.count;
  }

  /**
   * Désarchivage = réactivation (ACTIF), réservée à l'assureur. Les bénéficiaires archivés avec
   * l'adhérent NE sont PAS réactivés à sa place : chacun l'est explicitement.
   */
  async desarchiverAdherent(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    const actuel = await this.chargerAdherent(ctx, id);
    if (!this.aRoleAssureur(ctx)) {
      throw new ForbiddenException("La réactivation d'un adhérent sorti est réservée au personnel de l'assureur.");
    }
    await this.dependances.assertPossible(user, 'adherent', id, 'desarchiver');

    await this.prisma.$transaction(async (tx) => {
      await tx.adherent.update({ where: { id }, data: { statut: 'ACTIF', statutSortantCible: null } });
      const restants = await tx.beneficiaire.count({ where: { adherentId: id, deletedAt: null, statut: 'RADIE' } });
      await this.audit(tx, ctx.userId, 'DESARCHIVAGE_ADHERENT', id, { de: actuel.statut, beneficiairesToujoursArchives: restants }, 'adherents');
    });
    return this.chargerAdherent(ctx, id);
  }

  async archiverBeneficiaire(user: AuthenticatedUser, adherentId: string, beneficiaireId: string, dto: ArchiverMembreDto) {
    const ctx = await this.contexteAppelant(user);
    const adherent = await this.chargerAdherent(ctx, adherentId);
    this.assertGestion(ctx, adherent.souscripteurId);
    const actuel = await this.chargerBeneficiaire(ctx, adherentId, beneficiaireId);
    await this.dependances.assertPossible(user, 'beneficiaire', beneficiaireId, 'archiver');

    await this.prisma.$transaction(async (tx) => {
      await tx.beneficiaire.update({ where: { id: beneficiaireId }, data: { statut: 'RADIE' } });
      await this.audit(tx, ctx.userId, 'ARCHIVAGE_BENEFICIAIRE', beneficiaireId, { adherentId, de: actuel.statut, motif: dto.motif ?? null }, 'beneficiaires');
    });
    return this.chargerBeneficiaire(ctx, adherentId, beneficiaireId);
  }

  async desarchiverBeneficiaire(user: AuthenticatedUser, adherentId: string, beneficiaireId: string) {
    const ctx = await this.contexteAppelant(user);
    const adherent = await this.chargerAdherent(ctx, adherentId);
    this.assertGestion(ctx, adherent.souscripteurId);
    const actuel = await this.chargerBeneficiaire(ctx, adherentId, beneficiaireId);
    await this.dependances.assertPossible(user, 'beneficiaire', beneficiaireId, 'desarchiver');
    if (adherent.statut === 'RADIE') {
      throw new ConflictException("Désarchivage impossible : l'adhérent titulaire est lui-même archivé. Réactivez-le d'abord.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.beneficiaire.update({ where: { id: beneficiaireId }, data: { statut: 'ACTIF' } });
      await this.audit(tx, ctx.userId, 'DESARCHIVAGE_BENEFICIAIRE', beneficiaireId, { adherentId, de: actuel.statut }, 'beneficiaires');
    });
    return this.chargerBeneficiaire(ctx, adherentId, beneficiaireId);
  }

  // --- Mouvements de personnel — SORTANTS (prisma/sql/056) -----------

  /**
   * SOCIETE_ADMINISTRATION coche des adhérents ACTIFS de SA PROPRE société à
   * suspendre/révoquer — statut → `PROPOSE_SORTANT` IMMÉDIATEMENT (visible
   * sans délai dans le fichier des membres), effectif (statutCible) seulement
   * après `validerSortants`. Contrairement aux entrants, aucun report au mois
   * suivant n'est demandé pour les sortants — l'effet, une fois validé, est
   * immédiat.
   */
  async proposerSortants(user: AuthenticatedUser, dto: ProposerSortantsDto) {
    const ctx = await this.contexteAppelant(user);
    if (
      !ctx.roleChain.includes(ROLE_PROPOSITION_SORTANT_SOCIETE) ||
      ctx.societeId !== dto.souscripteurId
    ) {
      throw new ForbiddenException(
        'La proposition de sortants est réservée à SOCIETE_ADMINISTRATION, pour sa propre société.',
      );
    }

    const resultats: { adherentId: string; statut: string }[] = [];
    for (const s of dto.sortants) {
      const adherent = await this.prisma.adherent.findFirst({
        where: { id: s.adherentId, souscripteurId: dto.souscripteurId, organisationId: ctx.organisationId, deletedAt: null },
      });
      if (!adherent) {
        throw new NotFoundException(`Adhérent ${s.adherentId} introuvable pour ce souscripteur.`);
      }
      if (adherent.statut !== 'ACTIF') {
        throw new ConflictException(
          `${adherent.nom} ${adherent.prenom} est déjà « ${adherent.statut} » — impossible de proposer sa sortie.`,
        );
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.adherent.update({
          where: { id: s.adherentId },
          data: {
            statut: STATUT_ADHERENT_PROPOSE_SORTANT,
            statutSortantCible: s.statutCible,
            motifSortie: s.motif,
          },
        });
        await this.audit(
          tx,
          ctx.userId,
          'PROPOSITION_SORTANT',
          s.adherentId,
          { statutCible: s.statutCible, motif: s.motif },
          'adherents',
        );
      });
      resultats.push({ adherentId: s.adherentId, statut: STATUT_ADHERENT_PROPOSE_SORTANT });
    }
    return { propositions: resultats };
  }

  /**
   * Réservé ASSUREUR_INFORMATIQUE/EXPLOITATION (`ROLES_VALIDATION_IMPORT_ADHERENTS`,
   * réutilisé tel quel) — rend effectif le mouvement de sortie : `PROPOSE_SORTANT`
   * → `statutSortantCible` (SUSPENDU ou RADIE), immédiatement.
   */
  async validerSortants(user: AuthenticatedUser, dto: ValiderSortantsDto) {
    const ctx = await this.contexteAppelant(user);
    if (
      !ctx.roleChain.some((code) =>
        (ROLES_VALIDATION_IMPORT_ADHERENTS as readonly string[]).includes(code),
      )
    ) {
      throw new ForbiddenException(
        'La validation des sortants est réservée à ASSUREUR_INFORMATIQUE et ASSUREUR_EXPLOITATION.',
      );
    }

    const resultats: { adherentId: string; statut: string }[] = [];
    for (const adherentId of dto.adherentIds) {
      const adherent = await this.prisma.adherent.findFirst({
        where: { id: adherentId, organisationId: ctx.organisationId, deletedAt: null },
      });
      if (!adherent) {
        throw new NotFoundException(`Adhérent ${adherentId} introuvable.`);
      }
      if (adherent.statut !== STATUT_ADHERENT_PROPOSE_SORTANT || !adherent.statutSortantCible) {
        throw new ConflictException(
          `${adherent.nom} ${adherent.prenom} n'est pas en attente de validation de sortie (statut actuel : ${adherent.statut}).`,
        );
      }

      const radiation = adherent.statutSortantCible === 'RADIE';
      // Sortie par RADIATION = archivage : mêmes blocages (dossier ouvert, réclamation en cours,
      // cotisation due) et mêmes bénéficiaires entraînés que l'action « Archiver ».
      if (radiation) {
        await this.dependances.assertPossible(user, 'adherent', adherentId, 'archiver');
      }
      await this.prisma.$transaction(async (tx) => {
        let beneficiairesArchives = 0;
        if (radiation) {
          beneficiairesArchives = await this.radierAvecBeneficiaires(tx, adherentId, adherent.motifSortie);
        } else {
          await tx.adherent.update({
            where: { id: adherentId },
            data: { statut: adherent.statutSortantCible! },
          });
        }
        await this.audit(
          tx,
          ctx.userId,
          'VALIDATION_SORTANT',
          adherentId,
          { statut: adherent.statutSortantCible, motif: adherent.motifSortie, ...(radiation ? { beneficiairesArchives } : {}) },
          'adherents',
        );
      });
      resultats.push({ adherentId, statut: adherent.statutSortantCible });
    }
    return { validations: resultats };
  }

  // --- Bénéficiaires -------------------------------------------------

  async ajouterBeneficiaire(
    user: AuthenticatedUser,
    adherentId: string,
    dto: CreateBeneficiaireDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertCreationDirecte(ctx);
    const adherent = await this.chargerAdherent(ctx, adherentId);
    this.assertGestion(ctx, adherent.souscripteurId);
    const contacts = validerContactsMembre(dto.telephone, dto.email, false);

    const id = await this.prisma.$transaction(async (tx) => {
      const benef = await tx.beneficiaire.create({
        data: {
          adherentId,
          lienParente: dto.lienParente,
          nom: dto.nom,
          prenom: dto.prenom,
          dateNaissance: new Date(dto.dateNaissance),
          sexe: dto.sexe,
          telephone: contacts.telephone,
          email: contacts.email,
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
    await this.dependances.assertPossible(user, 'beneficiaire', beneficiaireId, 'modifier');

    const data: Prisma.BeneficiaireUpdateInput = {};
    if (dto.lienParente !== undefined) data.lienParente = dto.lienParente;
    if (dto.nom !== undefined) data.nom = dto.nom;
    if (dto.prenom !== undefined) data.prenom = dto.prenom;
    if (dto.dateNaissance !== undefined) {
      data.dateNaissance = new Date(dto.dateNaissance);
    }
    if (dto.sexe !== undefined) data.sexe = dto.sexe;
    if (dto.telephone !== undefined || dto.email !== undefined) {
      const contacts = validerContactsMembre(dto.telephone, dto.email, false);
      if (dto.telephone !== undefined) data.telephone = contacts.telephone;
      if (dto.email !== undefined) data.email = contacts.email;
    }

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
    this.assertStatutHorsArchivage('bénéficiaire', actuel.statut, dto.statut);

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

    // ADR-007 : aucune suppression d'un élément encore lié (409 + raison, refus tracé)
    await this.dependances.assertPossible(user, 'beneficiaire', beneficiaireId, 'supprimer');

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

  // --- Bénéficiaires proposés par l'ADHÉRENT lui-même (double validation) --

  /**
   * L'adhérent propose l'ajout d'un bénéficiaire — crée immédiatement une
   * vraie ligne `Beneficiaire` (pas de staging JSON, contrairement aux
   * propositions société) mais SANS `numeroCarte` (colonne explicitement
   * mise à NULL, en dehors du défaut de séquence) et au statut
   * EN_ATTENTE_SOCIETE. Aucune carte, aucun droit ouvert tant que les deux
   * validations n'ont pas eu lieu (`STATUT_MEMBRE_ELIGIBLE` exclut ce statut).
   */
  async proposerMonBeneficiaire(
    user: AuthenticatedUser,
    dto: CreateBeneficiaireDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertEntiteAdherent(ctx);
    const contacts = validerContactsMembre(dto.telephone, dto.email, false);

    const id = await this.prisma.$transaction(async (tx) => {
      const benef = await tx.beneficiaire.create({
        data: {
          adherentId: ctx.adherentId!,
          lienParente: dto.lienParente,
          nom: dto.nom,
          prenom: dto.prenom,
          dateNaissance: new Date(dto.dateNaissance),
          sexe: dto.sexe,
          telephone: contacts.telephone,
          email: contacts.email,
          numeroCarte: null,
          statut: STATUT_BENEFICIAIRE_EN_ATTENTE_SOCIETE,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'PROPOSITION_BENEFICIAIRE_ADHERENT',
        benef.id,
        { adherentId: ctx.adherentId, lienParente: dto.lienParente },
        'beneficiaires',
      );
      return benef.id;
    });

    return this.chargerBeneficiaire(ctx, ctx.adherentId!, id);
  }

  /**
   * Modifie une proposition tant qu'elle reste éditable — refuse
   * explicitement (409) dès que `numeroCarte` est renseigné : au-delà, ses
   * informations sont IMMUABLES pour l'adhérent (seul un rôle ASSUREUR
   * conserve `modifierBeneficiaire`). Autorisé pendant EN_ATTENTE_SOCIETE ET
   * EN_ATTENTE_ASSUREUR — c'est bien la carte, pas la validation société, qui
   * verrouille (règle explicite du prompt).
   */
  async modifierMonBeneficiaire(
    user: AuthenticatedUser,
    beneficiaireId: string,
    dto: UpdateBeneficiaireDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertEntiteAdherent(ctx);
    const actuel = await this.chargerBeneficiaire(ctx, ctx.adherentId!, beneficiaireId);
    if (actuel.numeroCarte !== null) {
      throw new ConflictException(
        'Ce bénéficiaire a déjà sa carte de membre : ses informations ne sont plus modifiables. Contactez votre assureur pour toute correction.',
      );
    }

    const data: Prisma.BeneficiaireUpdateInput = {};
    if (dto.lienParente !== undefined) data.lienParente = dto.lienParente;
    if (dto.nom !== undefined) data.nom = dto.nom;
    if (dto.prenom !== undefined) data.prenom = dto.prenom;
    if (dto.dateNaissance !== undefined) {
      data.dateNaissance = new Date(dto.dateNaissance);
    }
    if (dto.sexe !== undefined) data.sexe = dto.sexe;
    if (dto.telephone !== undefined || dto.email !== undefined) {
      const contacts = validerContactsMembre(dto.telephone, dto.email, false);
      if (dto.telephone !== undefined) data.telephone = contacts.telephone;
      if (dto.email !== undefined) data.email = contacts.email;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.beneficiaire.update({ where: { id: beneficiaireId }, data });
      await this.audit(
        tx,
        ctx.userId,
        'MODIFICATION_BENEFICIAIRE_ADHERENT',
        beneficiaireId,
        { champs: Object.keys(data) },
        'beneficiaires',
      );
    });

    return this.chargerBeneficiaire(ctx, ctx.adherentId!, beneficiaireId);
  }

  /**
   * 1re validation — réservée à SOCIETE_ADMINISTRATION, pour un bénéficiaire
   * proposé par un adhérent de SA PROPRE société. EN_ATTENTE_SOCIETE →
   * EN_ATTENTE_ASSUREUR ; ne génère toujours pas de carte.
   */
  async validerBeneficiaireSociete(user: AuthenticatedUser, beneficiaireId: string) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.includes(ROLE_GESTION_MEMBRE_SOCIETE)) {
      throw new ForbiddenException(
        'La validation « société » d’un bénéficiaire est réservée à SOCIETE_ADMINISTRATION.',
      );
    }
    const benef = await this.prisma.beneficiaire.findFirst({
      where: { id: beneficiaireId, deletedAt: null },
      include: { adherent: { select: { organisationId: true, souscripteurId: true } } },
    });
    if (
      !benef ||
      benef.adherent.organisationId !== ctx.organisationId ||
      benef.adherent.souscripteurId !== ctx.societeId
    ) {
      throw new NotFoundException('Bénéficiaire introuvable.');
    }
    if (benef.statut !== STATUT_BENEFICIAIRE_EN_ATTENTE_SOCIETE) {
      throw new ConflictException(
        `Ce bénéficiaire n'est pas en attente de validation société (statut actuel : ${benef.statut}).`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.beneficiaire.update({
        where: { id: beneficiaireId },
        data: { statut: STATUT_BENEFICIAIRE_EN_ATTENTE_ASSUREUR },
      });
      await this.audit(
        tx,
        ctx.userId,
        'VALIDATION_SOCIETE_BENEFICIAIRE',
        beneficiaireId,
        { adherentId: benef.adherentId },
        'beneficiaires',
      );
    });

    return this.chargerBeneficiaire(ctx, benef.adherentId, beneficiaireId);
  }

  /**
   * 2e et dernière validation — réservée à ASSUREUR_INFORMATIQUE/EXPLOITATION.
   * EN_ATTENTE_ASSUREUR → ACTIF : SEUL moment où `numeroCarte` est attribué
   * (attribution manuelle de la même séquence que le défaut de colonne,
   * puisqu'un UPDATE ne déclenche jamais un `default` de création) — puis la
   * carte est générée automatiquement (réutilise `MemberCarteService`,
   * inchangé). Un échec de génération de carte ne bloque ni la validation ni
   * l'attribution du numéro (même tolérance que `validerImportAdherents`).
   */
  async validerBeneficiaireAssureur(user: AuthenticatedUser, beneficiaireId: string) {
    const ctx = await this.contexteAppelant(user);
    if (
      !ctx.roleChain.some((code) =>
        (ROLES_VALIDATION_BENEFICIAIRE_ASSUREUR as readonly string[]).includes(code),
      )
    ) {
      throw new ForbiddenException(
        'La validation « assureur » d’un bénéficiaire est réservée à ASSUREUR_INFORMATIQUE et ASSUREUR_EXPLOITATION.',
      );
    }
    const benef = await this.prisma.beneficiaire.findFirst({
      where: { id: beneficiaireId, deletedAt: null },
      include: { adherent: { select: { id: true, organisationId: true } } },
    });
    if (!benef || benef.adherent.organisationId !== ctx.organisationId) {
      throw new NotFoundException('Bénéficiaire introuvable.');
    }
    if (benef.statut !== STATUT_BENEFICIAIRE_EN_ATTENTE_ASSUREUR) {
      throw new ConflictException(
        `Ce bénéficiaire n'est pas en attente de validation assureur (statut actuel : ${benef.statut}).`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const [ligne] = await tx.$queryRaw<{ numero_carte: string }[]>`
        update beneficiaires
        set numero_carte = 'CM-' || lpad(nextval('cartes_membre_numero_seq')::text, 10, '0'),
            statut = 'ACTIF'
        where id = ${beneficiaireId}::uuid and numero_carte is null
        returning numero_carte`;
      if (!ligne) {
        throw new ConflictException('Ce bénéficiaire a déjà une carte — validation déjà effectuée.');
      }
      await this.audit(
        tx,
        ctx.userId,
        'VALIDATION_ASSUREUR_BENEFICIAIRE',
        beneficiaireId,
        { adherentId: benef.adherentId, numeroCarte: ligne.numero_carte },
        'beneficiaires',
      );
    });

    let echecCarte: string | null = null;
    try {
      await this.cartes.genererCarteBeneficiaire(user, benef.adherent.id, beneficiaireId);
    } catch (error) {
      echecCarte = error instanceof Error ? error.message : 'erreur inconnue';
      this.logger.error(
        `Génération de carte échouée pour le bénéficiaire ${beneficiaireId} (validation assureur) : ${echecCarte}`,
      );
    }

    return { ...(await this.chargerBeneficiaire(ctx, benef.adherent.id, beneficiaireId)), echecCarte };
  }

  // --- Photo de profil (adhérent + bénéficiaires, donnée non structurante) --

  /** L'adhérent modifie SA PROPRE photo, ou le personnel habilité
   * (`ROLES_PHOTO_PERSONNEL`) celle d'un adhérent de son organisation —
   * jamais de validation requise. */
  async televerserPhotoAdherent(
    user: AuthenticatedUser,
    adherentId: string,
    fichier: FichierTeleverse,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertPhotoAutorisee(ctx, adherentId, 'Vous ne pouvez modifier que votre propre photo.');
    this.validerImagePhoto(fichier);

    const adherent = await this.chargerAdherent(ctx, adherentId);
    const dossierFamille = this.identifiantFamille(
      adherent.nom,
      adherent.souscripteur.nom,
      adherent.numeroCarte,
    );
    const chemin = `${ctx.organisationId}/familles/${dossierFamille}/${dossierFamille}.${this.extensionPhoto(fichier.mimetype)}`;
    await this.televerserPhoto(chemin, fichier);
    await this.prisma.adherent.update({ where: { id: adherentId }, data: { photoUrl: chemin } });
    await this.audit(this.prisma, ctx.userId, 'MODIFICATION_PHOTO_ADHERENT', adherentId, { chemin }, 'adherents');

    return { url: await this.signerPhoto(chemin), expiresIn: this.dureeUrlSigneePhoto };
  }

  /** L'adhérent modifie la photo d'un de SES bénéficiaires, ou le personnel
   * habilité celle d'un bénéficiaire d'un adhérent de son organisation —
   * jamais de validation. */
  async televerserPhotoBeneficiaire(
    user: AuthenticatedUser,
    adherentId: string,
    beneficiaireId: string,
    fichier: FichierTeleverse,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertPhotoAutorisee(
      ctx,
      adherentId,
      'Vous ne pouvez modifier que la photo de vos propres bénéficiaires.',
    );
    // Scope organisation (et bénéficiaire rattaché à CET adhérent) vérifié par
    // `chargerAdherent`/`chargerBeneficiaire` — jamais de confiance dans les ids.
    const adherent = await this.chargerAdherent(ctx, adherentId);
    const benef = await this.chargerBeneficiaire(ctx, adherentId, beneficiaireId);
    this.validerImagePhoto(fichier);

    // Dossier famille TOUJOURS dérivé de l'adhérent titulaire (jamais du
    // bénéficiaire) — un seul dossier regroupe toute la famille. `numeroCarte`
    // du bénéficiaire est nullable tant que la double validation (prisma/sql/055)
    // n'est pas terminée ; repli sur son `id` (toujours unique) pour ne jamais
    // bloquer l'upload de la photo, donnée non structurante comme le reste de
    // ce mécanisme.
    const dossierFamille = this.identifiantFamille(
      adherent.nom,
      adherent.souscripteur.nom,
      adherent.numeroCarte,
    );
    const nomFichier = this.identifiantFamille(
      benef.nom,
      adherent.souscripteur.nom,
      benef.numeroCarte ?? benef.id,
    );
    const chemin = `${ctx.organisationId}/familles/${dossierFamille}/${nomFichier}.${this.extensionPhoto(fichier.mimetype)}`;
    await this.televerserPhoto(chemin, fichier);
    await this.prisma.beneficiaire.update({ where: { id: beneficiaireId }, data: { photoUrl: chemin } });
    await this.audit(
      this.prisma,
      ctx.userId,
      'MODIFICATION_PHOTO_BENEFICIAIRE',
      beneficiaireId,
      { adherentId, chemin },
      'beneficiaires',
    );

    return { url: await this.signerPhoto(chemin), expiresIn: this.dureeUrlSigneePhoto };
  }

  /** URL signée courte durée de la photo de l'adhérent (lecture déjà scopée
   * par `chargerAdherent` — même périmètre que la consultation du dossier). */
  async obtenirPhotoAdherent(user: AuthenticatedUser, adherentId: string) {
    const ctx = await this.contexteAppelant(user);
    const adherent = await this.chargerAdherent(ctx, adherentId);
    if (!adherent.photoUrl) {
      throw new NotFoundException('Aucune photo pour cet adhérent.');
    }
    return { url: await this.signerPhoto(adherent.photoUrl), expiresIn: this.dureeUrlSigneePhoto };
  }

  async obtenirPhotoBeneficiaire(
    user: AuthenticatedUser,
    adherentId: string,
    beneficiaireId: string,
  ) {
    const ctx = await this.contexteAppelant(user);
    await this.chargerAdherent(ctx, adherentId);
    const benef = await this.chargerBeneficiaire(ctx, adherentId, beneficiaireId);
    if (!benef.photoUrl) {
      throw new NotFoundException('Aucune photo pour ce bénéficiaire.');
    }
    return { url: await this.signerPhoto(benef.photoUrl), expiresIn: this.dureeUrlSigneePhoto };
  }

  /** URL signée (éphémère) d'une photo déjà autorisée par l'appelant — pour la fiche d'accueil (aucun contrôle ici). */
  async urlPhotoSignee(chemin: string | null): Promise<string | null> {
    if (!chemin) return null;
    try {
      return await this.signerPhoto(chemin);
    } catch {
      return null;
    }
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
  /**
   * La société cliente ne CRÉE plus d'adhérent ni de bénéficiaire : elle les PROPOSE (`PropositionsMembresService`), l'assureur valide.
   * Refus côté serveur même si l'écran est contourné (403). Les adhérents déjà créés restent modifiables comme avant.
   */
  private assertCreationDirecte(ctx: ContexteAppelant): void {
    if (!this.aRoleAssureur(ctx)) {
      throw new ForbiddenException(
        "La société cliente ne crée plus d'adhérent ni de bénéficiaire : elle les propose (POST /member/propositions-membres/...) et l'assureur les valide.",
      );
    }
  }

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

  /** Réservé aux comptes ADHERENT rattachés (self-service uniquement — ni
   * ASSUREUR, ni SOCIETE_AFFILIEE, qui ne passent jamais par ces méthodes). */
  private assertEntiteAdherent(ctx: ContexteAppelant): void {
    if (ctx.entite !== ENTITE_ADHERENT || !ctx.adherentId) {
      throw new ForbiddenException(
        'Cette action est réservée à un compte adhérent rattaché à son propre dossier.',
      );
    }
  }

  /**
   * Photo (adhérent ou bénéficiaire) : soit l'adhérent lui-même sur SON propre
   * dossier (self-service, inchangé), soit le personnel `ROLES_PHOTO_PERSONNEL`.
   * Pour le personnel, l'appartenance de l'adhérent à l'organisation de
   * l'appelant est vérifiée ensuite par `chargerAdherent` (404 hors
   * organisation, comme partout dans ce module — ne jamais révéler qu'un
   * adhérent existe dans une autre organisation).
   */
  private assertPhotoAutorisee(
    ctx: ContexteAppelant,
    adherentId: string,
    messageAdherent: string,
  ): void {
    if (ctx.entite === ENTITE_ADHERENT) {
      this.assertEntiteAdherent(ctx);
      if (adherentId !== ctx.adherentId) {
        throw new ForbiddenException(messageAdherent);
      }
      return;
    }
    if (
      ctx.roleChain.some((code) =>
        (ROLES_PHOTO_PERSONNEL as readonly string[]).includes(code),
      )
    ) {
      return;
    }
    throw new ForbiddenException(
      'La photo est modifiable par l’adhérent lui-même, ou par ASSUREUR_INFORMATIQUE / ASSUREUR_EXPLOITATION.',
    );
  }

  private validerImagePhoto(fichier: FichierTeleverse): void {
    if (!MIME_TYPES_PHOTO_AUTORISES.includes(fichier.mimetype)) {
      throw new BadRequestException('Formats de photo acceptés : JPEG, PNG, WEBP.');
    }
    if (fichier.size > TAILLE_MAX_PHOTO_OCTETS) {
      throw new BadRequestException('Photo trop volumineuse (max 5 Mo).');
    }
  }

  private extensionPhoto(mimetype: string): string {
    if (mimetype === 'image/png') return 'png';
    if (mimetype === 'image/webp') return 'webp';
    return 'jpg';
  }

  /** Normalise un segment pour un nom de fichier/dossier sûr : accents
   * retirés, majuscules, espaces remplacés par `_`, toute autre ponctuation
   * (tiret d'un numéro de carte généré `CM-0000000042`, apostrophe d'un nom
   * composé…) retirée sans substitution — c'est ce que montre l'exemple
   * DIALLO-AC-CM0000000007 : le `-` du numéro de carte disparaît, il ne
   * devient pas un `_` supplémentaire à côté des séparateurs de segments. */
  private segmentPourFichier(valeur: string): string {
    return valeur
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^A-Z0-9_]/g, '');
  }

  /** 2 premières lettres (A-Z uniquement, accents/espaces/chiffres ignorés)
   * du nom du souscripteur — jamais vide (repli `XX` si aucune lettre). */
  private deuxLettresSociete(nomSouscripteur: string): string {
    const lettres = nomSouscripteur
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '');
    return lettres.slice(0, 2) || 'XX';
  }

  /**
   * "Dossier famille" (v. `televerserPhotoAdherent`/`televerserPhotoBeneficiaire`) :
   * {NOM}-{2 lettres société}-{numero_carte}, normalisé pour être un chemin de
   * fichier Supabase Storage sûr. Utilisée à l'identique pour nommer le
   * dossier famille (à partir de l'ADHÉRENT titulaire) et chaque fichier
   * photo qu'il contient (à partir de la personne concernée — adhérent OU
   * l'un de ses bénéficiaires, jamais un dossier séparé par bénéficiaire).
   * Exemple : DIALLO-AC-CM0000000007.
   */
  private identifiantFamille(nom: string, nomSouscripteur: string, numeroCarte: string): string {
    return `${this.segmentPourFichier(nom)}-${this.deuxLettresSociete(nomSouscripteur)}-${this.segmentPourFichier(numeroCarte)}`;
  }

  private get baseStorage(): string {
    return `${(process.env.SUPABASE_URL ?? '').replace(/\/$/, '')}/storage/v1`;
  }

  private get serviceKey(): string {
    return process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  }

  /** Bucket privé `photos` (prisma/sql/055) — même recette que `cartes`
   * (`MemberCarteService.televerserEtSigner`) : écriture/signature via
   * `service_role` uniquement, jamais d'accès direct hors NestJS. */
  private async televerserPhoto(chemin: string, fichier: FichierTeleverse): Promise<void> {
    if (!process.env.SUPABASE_URL || !this.serviceKey) {
      throw new ServiceUnavailableException(
        'Stockage des photos indisponible : SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents.',
      );
    }
    const up = await fetch(`${this.baseStorage}/object/photos/${chemin}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.serviceKey}`,
        apikey: this.serviceKey,
        'Content-Type': fichier.mimetype,
        'x-upsert': 'true',
      },
      body: fichier.buffer as unknown as BodyInit,
    });
    if (!up.ok) {
      throw new ServiceUnavailableException(
        `Téléversement de la photo refusé (${up.status} : ${(await up.text()).slice(0, 200)}).`,
      );
    }
  }

  private async signerPhoto(chemin: string): Promise<string> {
    if (!process.env.SUPABASE_URL || !this.serviceKey) {
      throw new ServiceUnavailableException(
        'Stockage des photos indisponible : SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents.',
      );
    }
    const sign = await fetch(`${this.baseStorage}/object/sign/photos/${chemin}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.serviceKey}`,
        apikey: this.serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: this.dureeUrlSigneePhoto }),
    });
    if (!sign.ok) {
      throw new ServiceUnavailableException(`Signature de l'URL de photo refusée (${sign.status}).`);
    }
    const corps = (await sign.json()) as { signedURL?: string; signedUrl?: string };
    const rel = corps.signedURL ?? corps.signedUrl;
    if (!rel) {
      throw new ServiceUnavailableException("Réponse de signature inattendue (pas d'URL).");
    }
    return `${this.baseStorage}${rel.startsWith('/') ? '' : '/'}${rel}`;
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
