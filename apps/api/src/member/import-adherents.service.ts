import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isEmail } from 'class-validator';
import ExcelJS from 'exceljs';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdherentService } from './adherent.service';
import { MemberCarteService } from './carte.service';
import { ProposerAdherentDto, ProposerBeneficiaireDto } from './dto/member.dto';
import {
  ContexteAppelant,
  ROLE_PROPOSITION_SORTANT_SOCIETE,
  ROLES_IMPORT_ADHERENTS,
  ROLES_PROPOSITION_ADHERENTS_SOCIETE,
  ROLES_VALIDATION_IMPORT_ADHERENTS,
  STATUTS_SORTANT_CIBLE,
} from './member.types';

/** Forme minimale d'un fichier téléversé (multer, mémoire) — même convention
 * que les autres modules à upload (contestation/, payment/). */
export interface FichierTeleverse {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/** Adhérent PRINCIPAL — issu d'un import Excel OU d'une proposition société. */
interface LigneAdherentProposee {
  type: 'ADHERENT';
  nom: string;
  prenom: string;
  telephone: string;
  email: string;
  dateNaissance: string; // ISO (YYYY-MM-DD)
}

/** Bénéficiaire proposé par une société, rattaché à un `Adherent` EXISTANT de
 * cette même société (jamais un adhérent proposé dans le même lot — hors
 * périmètre, non demandé). `adherentNom` est un instantané d'affichage
 * uniquement, jamais utilisé pour la création (toujours `adherentId`, la FK réelle). */
interface LigneBeneficiaireProposee {
  type: 'BENEFICIAIRE';
  adherentId: string;
  adherentNom: string;
  lienParente: string;
  nom: string;
  prenom: string;
  dateNaissance: string;
  sexe: string;
}

type LigneValide = LigneAdherentProposee | LigneBeneficiaireProposee;

export interface LigneErreur {
  ligne: number;
  donnees: Record<string, string>;
  erreurs: string[];
}

const TAILLE_MAX_FICHIER_OCTETS = 5 * 1024 * 1024;
const MIME_TYPES_AUTORISES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream', // certains navigateurs/OS n'envoient pas le MIME xlsx exact
];

/** Colonnes Excel — toujours un ADHERENT (jamais un BENEFICIAIRE, réservé
 * aux propositions société interactives). */
type ColonneExcel = keyof Omit<LigneAdherentProposee, 'type'>;

/** Alias d'en-tête acceptés (normalisés : minuscule, sans accent, sans espace/tiret/underscore). */
const ALIAS_ENTETES: Record<string, ColonneExcel> = {
  nom: 'nom',
  prenom: 'prenom',
  telephone: 'telephone',
  tel: 'telephone',
  email: 'email',
  mail: 'email',
  datenaissance: 'dateNaissance',
  datedenaissance: 'dateNaissance',
  ddn: 'dateNaissance',
};

function normaliserEntete(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
}

// Téléphone : chiffres uniquement, + optionnel en tête, 8 à 15 chiffres —
// permissif (formats CI et internationaux), pas de norme unique imposée.
const REGEX_TELEPHONE = /^\+?[0-9]{8,15}$/;

type Db = PrismaService | Prisma.TransactionClient;

/**
 * ImportAdherentsService — import en masse d'adhérents (titulaires) depuis un
 * fichier Excel pour une société cliente déjà créée avec sa police/formule
 * (`member/`, un domaine métier strict — réutilise `MemberCarteService` du
 * même module plutôt que de dupliquer la génération de carte).
 *
 * Deux étapes séparées, jamais fusionnées : `importerAdherentsExcel` ne crée
 * AUCUN `Adherent` — seule `validerImportAdherents` (rôles distincts) le fait,
 * réutilisant la séquence `adherents_numero_seq` déjà en place (numérotation
 * chronologique automatique, comme `creerAdherent`).
 */
@Injectable()
export class ImportAdherentsService {
  private readonly logger = new Logger(ImportAdherentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly cartes: MemberCarteService,
    private readonly adherents: AdherentService,
  ) {}

  private async contexteAppelant(user: AuthenticatedUser): Promise<ContexteAppelant> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) {
      throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
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

  private assertImport(ctx: ContexteAppelant): void {
    const autorise = ctx.roleChain.some((code) =>
      (ROLES_IMPORT_ADHERENTS as readonly string[]).includes(code),
    );
    if (!autorise) {
      throw new ForbiddenException(
        "L'import d'adhérents est réservé à ASSUREUR_INFORMATIQUE et ASSUREUR_COMPTABLE.",
      );
    }
  }

  private assertValidation(ctx: ContexteAppelant): void {
    const autorise = ctx.roleChain.some((code) =>
      (ROLES_VALIDATION_IMPORT_ADHERENTS as readonly string[]).includes(code),
    );
    if (!autorise) {
      throw new ForbiddenException(
        "La validation d'un import est réservée à ASSUREUR_INFORMATIQUE et ASSUREUR_EXPLOITATION.",
      );
    }
  }

  /** Proposition d'ajout par une société — réservée à SOCIETE_ASSUREE/
   * SOCIETE_ADMINISTRATION, et seulement pour SA PROPRE société (même
   * principe que `AdherentService.assertGestion`). */
  private assertProposition(ctx: ContexteAppelant, souscripteurId: string): void {
    const aLeRole = ctx.roleChain.some((code) =>
      (ROLES_PROPOSITION_ADHERENTS_SOCIETE as readonly string[]).includes(code),
    );
    if (!aLeRole || ctx.societeId !== souscripteurId) {
      throw new ForbiddenException(
        "La proposition d'adhérents/bénéficiaires est réservée à SOCIETE_ASSUREE et SOCIETE_ADMINISTRATION, pour leur propre société.",
      );
    }
  }

  /**
   * Parse le fichier .xlsx et journalise l'import en EN_ATTENTE_VALIDATION —
   * AUCUN `Adherent` créé ici. Chaque ligne en erreur (email en doublon,
   * téléphone invalide, champ obligatoire manquant) est listée précisément
   * dans `erreursDetail`, sans jamais bloquer l'import des lignes valides.
   */
  async importerAdherentsExcel(user: AuthenticatedUser, souscripteurId: string, fichier: FichierTeleverse) {
    const ctx = await this.contexteAppelant(user);
    this.assertImport(ctx);

    const souscripteur = await this.prisma.souscripteur.findFirst({
      where: { id: souscripteurId, organisationId: ctx.organisationId, deletedAt: null },
    });
    if (!souscripteur) {
      throw new NotFoundException('Souscripteur introuvable.');
    }

    if (!MIME_TYPES_AUTORISES.includes(fichier.mimetype) && !fichier.originalname.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException('Seul un fichier .xlsx est accepté.');
    }
    if (fichier.size > TAILLE_MAX_FICHIER_OCTETS) {
      throw new BadRequestException('Fichier trop volumineux (max 5 Mo).');
    }

    const { lignesValides, erreursDetail } = await this.parserEtValider(ctx, fichier);
    const nbLignesTotal = lignesValides.length + erreursDetail.length;
    if (nbLignesTotal === 0) {
      throw new BadRequestException(
        "Fichier vide ou colonnes non reconnues (attendues : nom, prénom, téléphone, email, date de naissance).",
      );
    }

    const importCree = await this.prisma.$transaction(async (tx) => {
      const imp = await tx.importAdherents.create({
        data: {
          organisationId: ctx.organisationId,
          souscripteurId,
          fichierNom: fichier.originalname,
          statut: 'EN_ATTENTE_VALIDATION',
          nbLignesTotal,
          nbLignesValides: lignesValides.length,
          nbLignesErreur: erreursDetail.length,
          lignesValides: lignesValides as unknown as object,
          erreursDetail: erreursDetail as unknown as object,
          importeParId: ctx.userId,
        },
      });
      await this.audit(tx, ctx.userId, 'IMPORT_ADHERENTS_EXCEL', imp.id, {
        souscripteurId,
        fichierNom: fichier.originalname,
        nbLignesTotal,
        nbLignesValides: lignesValides.length,
        nbLignesErreur: erreursDetail.length,
      });
      return imp;
    });

    return importCree;
  }

  /**
   * Mouvements de personnel — ENTRANTS à effet différé (prisma/sql/056) :
   * variante Excel de `proposerAdherent`, réservée aux mêmes rôles société
   * (`ROLES_PROPOSITION_ADHERENTS_SOCIETE`). Réutilise TEL QUEL le parsing de
   * `importerAdherentsExcel`/`parserEtValider` (mêmes colonnes, mêmes règles
   * de doublon) mais APPEND au brouillon de la société au lieu de créer un
   * import distinct — tolérant aux erreurs par ligne, comme l'import Excel
   * d'origine. `moisEffet` (sinon calculé au mois calendaire suivant) est
   * posé sur le brouillon ENTIER : `validerImportAdherents` (déjà construit,
   * inchangé dans son contrat) stampera `dateValidation` en conséquence pour
   * CHAQUE adhérent créé à partir de ce lot.
   */
  async importerEntrantsExcel(
    user: AuthenticatedUser,
    souscripteurId: string,
    fichier: FichierTeleverse,
    moisEffetStr?: string,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertProposition(ctx, souscripteurId);

    if (!MIME_TYPES_AUTORISES.includes(fichier.mimetype) && !fichier.originalname.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException('Seul un fichier .xlsx est accepté.');
    }
    if (fichier.size > TAILLE_MAX_FICHIER_OCTETS) {
      throw new BadRequestException('Fichier trop volumineux (max 5 Mo).');
    }

    const { lignesValides, erreursDetail } = await this.parserEtValider(ctx, fichier);
    if (lignesValides.length === 0 && erreursDetail.length === 0) {
      throw new BadRequestException(
        "Fichier vide ou colonnes non reconnues (attendues : nom, prénom, téléphone, email, date de naissance).",
      );
    }

    const brouillon = await this.brouillonSociete(ctx, souscripteurId);
    const lignesActuelles = (brouillon.lignesValides as unknown as LigneValide[]) ?? [];
    const emailsDejaProposes = new Set(
      lignesActuelles.filter((l): l is LigneAdherentProposee => l.type === 'ADHERENT').map((l) => l.email),
    );

    const aAjouter = lignesValides.filter((l) => !emailsDejaProposes.has(l.email));
    const doublonsBrouillon: LigneErreur[] = lignesValides
      .filter((l) => emailsDejaProposes.has(l.email))
      .map((l) => ({
        ligne: 0,
        donnees: { nom: l.nom, prenom: l.prenom, email: l.email },
        erreurs: [`déjà proposé dans votre liste en cours (${l.email})`],
      }));

    const lignesMaj = [...lignesActuelles, ...aAjouter];
    const erreursActuelles = (brouillon.erreursDetail as unknown as LigneErreur[]) ?? [];
    const erreursMaj = [...erreursActuelles, ...erreursDetail, ...doublonsBrouillon];
    const moisEffet = this.resoudreMoisEffet(moisEffetStr);

    const imp = await this.prisma.importAdherents.update({
      where: { id: brouillon.id },
      data: {
        lignesValides: lignesMaj as unknown as object,
        erreursDetail: erreursMaj as unknown as object,
        nbLignesTotal: lignesMaj.length + erreursMaj.length,
        nbLignesValides: lignesMaj.length,
        nbLignesErreur: erreursMaj.length,
        moisEffet,
      },
    });
    await this.audit(this.prisma, ctx.userId, 'IMPORT_ENTRANTS_EXCEL', imp.id, {
      souscripteurId,
      nbAjoutes: aAjouter.length,
      nbErreurs: erreursDetail.length + doublonsBrouillon.length,
      moisEffet: moisEffet.toISOString().slice(0, 10),
    });
    return imp;
  }

  /**
   * Mouvements de personnel — SORTANTS via Excel (prisma/sql/056), colonnes
   * adaptées (identifiant adhérent + motif — jamais nom/prénom/téléphone/
   * email/date de naissance, sans rapport ici). Réservé EXCLUSIVEMENT à
   * SOCIETE_ADMINISTRATION (comme `proposerSortants`, jamais SOCIETE_ASSUREE
   * — un mouvement de sortie est plus sensible qu'une simple proposition
   * d'ajout). Chaque ligne valide est appliquée via `AdherentService.
   * proposerSortants` (même effet immédiat, statut PROPOSE_SORTANT) — une
   * ligne invalide (identifiant introuvable, adhérent déjà non-ACTIF, doublon
   * dans le fichier) est listée en erreur sans bloquer les autres.
   */
  async importerSortantsExcel(user: AuthenticatedUser, souscripteurId: string, fichier: FichierTeleverse) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.includes(ROLE_PROPOSITION_SORTANT_SOCIETE) || ctx.societeId !== souscripteurId) {
      throw new ForbiddenException(
        "L'import de sortants est réservé à SOCIETE_ADMINISTRATION, pour sa propre société.",
      );
    }

    if (!MIME_TYPES_AUTORISES.includes(fichier.mimetype) && !fichier.originalname.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException('Seul un fichier .xlsx est accepté.');
    }
    if (fichier.size > TAILLE_MAX_FICHIER_OCTETS) {
      throw new BadRequestException('Fichier trop volumineux (max 5 Mo).');
    }

    const { sortants, erreursDetail } = await this.parserEtValiderSortants(ctx, souscripteurId, fichier);
    if (sortants.length === 0 && erreursDetail.length === 0) {
      throw new BadRequestException('Fichier vide ou colonnes non reconnues (attendues : identifiant, motif).');
    }

    const propositions =
      sortants.length > 0
        ? (await this.adherents.proposerSortants(user, { souscripteurId, sortants })).propositions
        : [];

    return { nbProposes: propositions.length, propositions, erreursDetail };
  }

  /**
   * Personnel ASSUREUR habilité : tous les imports de l'organisation, JAMAIS
   * les BROUILLON (propositions société encore en cours d'édition, pas
   * encore soumises — même principe que « visibles par la société jusqu'à
   * ce qu'elle consolide »). Société (SOCIETE_ASSUREE/ADMINISTRATION) : SES
   * PROPRES imports uniquement, tout statut (y compris son brouillon en cours).
   */
  async listerImportsAdherents(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    const rolesAssureur: readonly string[] = [...ROLES_IMPORT_ADHERENTS, ...ROLES_VALIDATION_IMPORT_ADHERENTS];
    const estAssureur = ctx.roleChain.some((code) => rolesAssureur.includes(code));
    const estSociete = ctx.roleChain.some((code) =>
      (ROLES_PROPOSITION_ADHERENTS_SOCIETE as readonly string[]).includes(code),
    );
    if (!estAssureur && !estSociete) {
      throw new ForbiddenException("Accès réservé au personnel habilité à l'import des adhérents.");
    }
    return this.prisma.importAdherents.findMany({
      where: {
        organisationId: ctx.organisationId,
        ...(estAssureur && !estSociete ? { statut: { not: 'BROUILLON' } } : {}),
        ...(estSociete && !estAssureur ? { souscripteurId: ctx.societeId ?? '__aucun__' } : {}),
      },
      include: {
        souscripteur: { select: { id: true, nom: true } },
        importePar: { select: { role: true } },
        validePar: { select: { role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Le brouillon EN COURS de la société pour ce souscripteur (ou `null`). */
  async obtenirBrouillonSociete(user: AuthenticatedUser, souscripteurId: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertProposition(ctx, souscripteurId);
    return this.prisma.importAdherents.findFirst({
      where: { organisationId: ctx.organisationId, souscripteurId, statut: 'BROUILLON' },
    });
  }

  /** Trouve le brouillon ouvert de la société, ou en crée un. */
  private async brouillonSociete(ctx: ContexteAppelant, souscripteurId: string) {
    const existant = await this.prisma.importAdherents.findFirst({
      where: { organisationId: ctx.organisationId, souscripteurId, statut: 'BROUILLON' },
    });
    if (existant) return existant;
    return this.prisma.importAdherents.create({
      data: {
        organisationId: ctx.organisationId,
        souscripteurId,
        fichierNom: null,
        statut: 'BROUILLON',
        nbLignesTotal: 0,
        nbLignesValides: 0,
        nbLignesErreur: 0,
        lignesValides: [] as unknown as object,
        erreursDetail: [] as unknown as object,
        importeParId: ctx.userId,
      },
    });
  }

  /** Charge un brouillon dont l'appelant (société) est propriétaire et qui
   * est encore éditable — 404 si absent/pas le sien, 409 si déjà soumis. */
  private async chargerBrouillonPourEdition(ctx: ContexteAppelant, importId: string) {
    const imp = await this.prisma.importAdherents.findFirst({
      where: { id: importId, organisationId: ctx.organisationId },
    });
    if (!imp) {
      throw new NotFoundException('Proposition introuvable.');
    }
    this.assertProposition(ctx, imp.souscripteurId);
    if (imp.statut !== 'BROUILLON') {
      throw new ConflictException(`Cette liste n'est plus modifiable (statut actuel : ${imp.statut}).`);
    }
    return imp;
  }

  /**
   * Ajoute une proposition d'adhérent PRINCIPAL au brouillon en cours de la
   * société (créé automatiquement s'il n'existe pas encore) — mêmes règles
   * de validation que l'import Excel (champs requis, format email/téléphone,
   * email non dupliqué), appliquées immédiatement : une ligne invalide est
   * refusée tout de suite (400), jamais stockée en erreur pour plus tard —
   * périmètre différent de l'import par lot.
   */
  async proposerAdherent(user: AuthenticatedUser, souscripteurId: string, dto: ProposerAdherentDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertProposition(ctx, souscripteurId);

    const { erreurs, dateNaissanceISO, telephoneNormalise, emailNormalise } = this.validerChampsAdherent(
      dto.nom,
      dto.prenom,
      dto.telephone,
      dto.email,
      dto.dateNaissance,
    );
    if (erreurs.length > 0) {
      throw new BadRequestException({ message: 'Ligne invalide.', erreurs });
    }

    const existant = await this.prisma.adherent.findFirst({
      where: { organisationId: ctx.organisationId, email: emailNormalise, deletedAt: null },
      select: { id: true },
    });
    if (existant) {
      throw new ConflictException(`Cet email est déjà utilisé par un adhérent existant (${emailNormalise}).`);
    }

    const brouillon = await this.brouillonSociete(ctx, souscripteurId);
    const lignes = (brouillon.lignesValides as unknown as LigneValide[]) ?? [];
    if (lignes.some((l) => l.type === 'ADHERENT' && l.email === emailNormalise)) {
      throw new ConflictException(`Cet email est déjà proposé dans votre liste en cours (${emailNormalise}).`);
    }

    const nouvelleLigne: LigneAdherentProposee = {
      type: 'ADHERENT',
      nom: dto.nom.trim(),
      prenom: dto.prenom.trim(),
      telephone: telephoneNormalise,
      email: emailNormalise,
      dateNaissance: dateNaissanceISO!,
    };
    const lignesMaj = [...lignes, nouvelleLigne];

    const imp = await this.prisma.importAdherents.update({
      where: { id: brouillon.id },
      data: {
        lignesValides: lignesMaj as unknown as object,
        nbLignesTotal: lignesMaj.length,
        nbLignesValides: lignesMaj.length,
        // Mouvement de personnel à effet différé (prisma/sql/056) — s'applique
        // à TOUT le lot, pas seulement cette ligne (dernier appel gagne).
        // Omis = comportement historique inchangé (coupure gouvernée par
        // `validerAdherent`, séparément).
        ...(dto.moisEffet ? { moisEffet: this.resoudreMoisEffet(dto.moisEffet) } : {}),
      },
    });
    await this.audit(this.prisma, ctx.userId, 'PROPOSITION_ADHERENT', imp.id, { nom: dto.nom, prenom: dto.prenom });
    return imp;
  }

  /** Ajoute une proposition de bénéficiaire, rattaché à un adhérent EXISTANT
   * de la propre société de l'appelant. */
  async proposerBeneficiaire(user: AuthenticatedUser, souscripteurId: string, dto: ProposerBeneficiaireDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertProposition(ctx, souscripteurId);

    const adherent = await this.prisma.adherent.findFirst({
      where: { id: dto.adherentId, souscripteurId, organisationId: ctx.organisationId, deletedAt: null },
    });
    if (!adherent) {
      throw new NotFoundException('Adhérent introuvable pour votre société.');
    }
    if (!dto.nom.trim() || !dto.prenom.trim()) {
      throw new BadRequestException('Nom et prénom sont requis.');
    }
    const dateNaissance = this.parserDate(dto.dateNaissance);
    if (!dateNaissance) {
      throw new BadRequestException('Date de naissance invalide.');
    }

    const brouillon = await this.brouillonSociete(ctx, souscripteurId);
    const lignes = (brouillon.lignesValides as unknown as LigneValide[]) ?? [];
    const nouvelleLigne: LigneBeneficiaireProposee = {
      type: 'BENEFICIAIRE',
      adherentId: dto.adherentId,
      adherentNom: `${adherent.nom} ${adherent.prenom}`,
      lienParente: dto.lienParente,
      nom: dto.nom.trim(),
      prenom: dto.prenom.trim(),
      dateNaissance: dateNaissance.toISOString().slice(0, 10),
      sexe: dto.sexe,
    };
    const lignesMaj = [...lignes, nouvelleLigne];

    const imp = await this.prisma.importAdherents.update({
      where: { id: brouillon.id },
      data: { lignesValides: lignesMaj as unknown as object, nbLignesTotal: lignesMaj.length, nbLignesValides: lignesMaj.length },
    });
    await this.audit(this.prisma, ctx.userId, 'PROPOSITION_BENEFICIAIRE', imp.id, {
      adherentId: dto.adherentId,
      nom: dto.nom,
      prenom: dto.prenom,
    });
    return imp;
  }

  /** Modifie une proposition d'adhérent PRINCIPAL par son index dans le
   * brouillon — tant que non soumis (`statut = BROUILLON`). */
  async modifierPropositionAdherent(
    user: AuthenticatedUser,
    importId: string,
    index: number,
    dto: ProposerAdherentDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    const imp = await this.chargerBrouillonPourEdition(ctx, importId);
    const lignes = (imp.lignesValides as unknown as LigneValide[]) ?? [];
    const ligne = lignes[index];
    if (!ligne || ligne.type !== 'ADHERENT') {
      throw new NotFoundException('Ligne introuvable.');
    }

    const { erreurs, dateNaissanceISO, telephoneNormalise, emailNormalise } = this.validerChampsAdherent(
      dto.nom,
      dto.prenom,
      dto.telephone,
      dto.email,
      dto.dateNaissance,
    );
    if (erreurs.length > 0) {
      throw new BadRequestException({ message: 'Ligne invalide.', erreurs });
    }

    const existant = await this.prisma.adherent.findFirst({
      where: { organisationId: ctx.organisationId, email: emailNormalise, deletedAt: null },
      select: { id: true },
    });
    if (existant) {
      throw new ConflictException(`Cet email est déjà utilisé par un adhérent existant (${emailNormalise}).`);
    }
    if (lignes.some((l, i) => i !== index && l.type === 'ADHERENT' && l.email === emailNormalise)) {
      throw new ConflictException(`Cet email est déjà proposé dans votre liste en cours (${emailNormalise}).`);
    }

    const lignesMaj = [...lignes];
    lignesMaj[index] = {
      type: 'ADHERENT',
      nom: dto.nom.trim(),
      prenom: dto.prenom.trim(),
      telephone: telephoneNormalise,
      email: emailNormalise,
      dateNaissance: dateNaissanceISO!,
    };
    const imp2 = await this.prisma.importAdherents.update({
      where: { id: importId },
      data: { lignesValides: lignesMaj as unknown as object },
    });
    await this.audit(this.prisma, ctx.userId, 'MODIFICATION_PROPOSITION_ADHERENT', imp2.id, { index });
    return imp2;
  }

  /** Modifie une proposition de bénéficiaire par son index dans le brouillon. */
  async modifierPropositionBeneficiaire(
    user: AuthenticatedUser,
    importId: string,
    index: number,
    dto: ProposerBeneficiaireDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    const imp = await this.chargerBrouillonPourEdition(ctx, importId);
    const lignes = (imp.lignesValides as unknown as LigneValide[]) ?? [];
    const ligne = lignes[index];
    if (!ligne || ligne.type !== 'BENEFICIAIRE') {
      throw new NotFoundException('Ligne introuvable.');
    }

    const adherent = await this.prisma.adherent.findFirst({
      where: { id: dto.adherentId, souscripteurId: imp.souscripteurId, organisationId: ctx.organisationId, deletedAt: null },
    });
    if (!adherent) {
      throw new NotFoundException('Adhérent introuvable pour votre société.');
    }
    if (!dto.nom.trim() || !dto.prenom.trim()) {
      throw new BadRequestException('Nom et prénom sont requis.');
    }
    const dateNaissance = this.parserDate(dto.dateNaissance);
    if (!dateNaissance) {
      throw new BadRequestException('Date de naissance invalide.');
    }

    const lignesMaj = [...lignes];
    lignesMaj[index] = {
      type: 'BENEFICIAIRE',
      adherentId: dto.adherentId,
      adherentNom: `${adherent.nom} ${adherent.prenom}`,
      lienParente: dto.lienParente,
      nom: dto.nom.trim(),
      prenom: dto.prenom.trim(),
      dateNaissance: dateNaissance.toISOString().slice(0, 10),
      sexe: dto.sexe,
    };
    const imp2 = await this.prisma.importAdherents.update({
      where: { id: importId },
      data: { lignesValides: lignesMaj as unknown as object },
    });
    await this.audit(this.prisma, ctx.userId, 'MODIFICATION_PROPOSITION_BENEFICIAIRE', imp2.id, { index });
    return imp2;
  }

  /** Retire une proposition (adhérent ou bénéficiaire) par son index. */
  async supprimerProposition(user: AuthenticatedUser, importId: string, index: number) {
    const ctx = await this.contexteAppelant(user);
    const imp = await this.chargerBrouillonPourEdition(ctx, importId);
    const lignes = (imp.lignesValides as unknown as LigneValide[]) ?? [];
    if (index < 0 || index >= lignes.length) {
      throw new NotFoundException('Ligne introuvable.');
    }
    const lignesMaj = lignes.filter((_, i) => i !== index);
    const imp2 = await this.prisma.importAdherents.update({
      where: { id: importId },
      data: { lignesValides: lignesMaj as unknown as object, nbLignesTotal: lignesMaj.length, nbLignesValides: lignesMaj.length },
    });
    await this.audit(this.prisma, ctx.userId, 'SUPPRESSION_PROPOSITION', imp2.id, { index });
    return imp2;
  }

  /**
   * Consolide la liste : BROUILLON → EN_ATTENTE_VALIDATION, même statut
   * qu'un import Excel — `validerImportAdherents` (déjà construit) s'applique
   * ensuite SANS AUCUNE distinction d'origine.
   */
  async soumettrePourValidation(user: AuthenticatedUser, importId: string) {
    const ctx = await this.contexteAppelant(user);
    const imp = await this.chargerBrouillonPourEdition(ctx, importId);
    const lignes = (imp.lignesValides as unknown as LigneValide[]) ?? [];
    if (lignes.length === 0) {
      throw new ConflictException('Ajoutez au moins une ligne avant de soumettre pour validation.');
    }

    const imp2 = await this.prisma.importAdherents.update({
      where: { id: importId },
      data: { statut: 'EN_ATTENTE_VALIDATION' },
    });
    await this.audit(this.prisma, ctx.userId, 'SOUMISSION_PROPOSITIONS_ADHERENTS', imp2.id, { nbLignes: lignes.length });
    return imp2;
  }

  /**
   * Crée les `Adherent` réels (numéro chronologique via la séquence
   * existante) et leur carte (`MemberCarteService.genererCarteAdherent`,
   * réutilisée telle quelle) — SEUL moment où l'import a un effet en base.
   * Un échec ponctuel de génération de carte (ex. Storage indisponible) ne
   * bloque pas les autres lignes ni la validation elle-même — l'adhérent
   * existe déjà, sa carte peut être régénérée séparément plus tard.
   */
  async validerImportAdherents(user: AuthenticatedUser, importId: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertValidation(ctx);

    const imp = await this.prisma.importAdherents.findFirst({
      where: { id: importId, organisationId: ctx.organisationId },
    });
    if (!imp) {
      throw new NotFoundException('Import introuvable.');
    }
    if (imp.statut !== 'EN_ATTENTE_VALIDATION') {
      throw new ConflictException(`Cet import est déjà ${imp.statut}.`);
    }
    const lignes = imp.lignesValides as unknown as LigneValide[];
    if (!lignes || lignes.length === 0) {
      throw new ConflictException('Aucune ligne valide à importer.');
    }

    // La police n'est requise que pour créer un ADHERENT (jamais un
    // BENEFICIAIRE, qui se rattache à un adhérent déjà existant) — un lot de
    // propositions société peut ne contenir que des bénéficiaires.
    const aDesAdherents = lignes.some((l) => l.type === 'ADHERENT');
    const police = aDesAdherents
      ? await this.prisma.police.findFirst({
          where: { souscripteurId: imp.souscripteurId, organisationId: ctx.organisationId, statut: 'ACTIVE', deletedAt: null },
        })
      : null;
    if (aDesAdherents && !police) {
      throw new ConflictException('Aucune police ACTIVE pour ce souscripteur — validation impossible.');
    }

    // Mouvements de personnel à effet différé (prisma/sql/056) : quand ce lot
    // porte un `moisEffet` explicite, chaque ADHERENT créé ici devient
    // directement éligible à la facturation à partir de ce mois précis — en
    // stampant `dateValidation` à la veille du 1er de `moisEffet` (jamais
    // `now()`), le mois promis à la proposition est garanti quelle que soit
    // la date effective de CETTE validation. Sans `moisEffet` (tout import/
    // proposition antérieur à ce prompt) : comportement historique inchangé,
    // `dateValidation` reste `null` — la coupure de facturation est gouvernée
    // séparément par `AdherentService.validerAdherent`.
    const dateValidationDifferee = imp.moisEffet
      ? new Date(Date.UTC(imp.moisEffet.getUTCFullYear(), imp.moisEffet.getUTCMonth(), 0))
      : null;

    const adherentIds: string[] = [];
    const beneficiaires: { adherentId: string; beneficiaireId: string }[] = [];
    for (const ligne of lignes) {
      if (ligne.type === 'BENEFICIAIRE') {
        const beneficiaire = await this.prisma.$transaction(async (tx) => {
          const b = await tx.beneficiaire.create({
            data: {
              adherentId: ligne.adherentId,
              lienParente: ligne.lienParente,
              nom: ligne.nom,
              prenom: ligne.prenom,
              dateNaissance: new Date(ligne.dateNaissance),
              sexe: ligne.sexe,
            },
          });
          await this.audit(tx, ctx.userId, 'CREATION_BENEFICIAIRE_IMPORT', b.id, {
            importId: imp.id,
            adherentId: ligne.adherentId,
          }, 'beneficiaires');
          return b;
        });
        beneficiaires.push({ adherentId: ligne.adherentId, beneficiaireId: beneficiaire.id });
        continue;
      }

      const adherent = await this.prisma.$transaction(async (tx) => {
        const a = await tx.adherent.create({
          data: {
            organisationId: ctx.organisationId,
            souscripteurId: imp.souscripteurId,
            policeId: police!.id,
            nom: ligne.nom,
            prenom: ligne.prenom,
            dateNaissance: new Date(ligne.dateNaissance),
            email: ligne.email,
            telephone: ligne.telephone,
            ...(dateValidationDifferee
              ? { dateValidation: dateValidationDifferee, valideParId: ctx.userId }
              : {}),
          },
        });
        await this.audit(tx, ctx.userId, 'CREATION_ADHERENT_IMPORT', a.id, {
          importId: imp.id,
          numeroAdherent: a.numeroAdherent,
        }, 'adherents');
        return a;
      });
      adherentIds.push(adherent.id);
    }

    const echecsCarte: string[] = [];
    for (const adherentId of adherentIds) {
      try {
        await this.cartes.genererCarteAdherent(user, adherentId);
      } catch (error) {
        echecsCarte.push(adherentId);
        this.logger.error(
          `Génération de carte échouée pour l'adhérent ${adherentId} (import ${importId}) : ${
            error instanceof Error ? error.message : 'erreur inconnue'
          }`,
        );
      }
    }
    for (const { adherentId, beneficiaireId } of beneficiaires) {
      try {
        await this.cartes.genererCarteBeneficiaire(user, adherentId, beneficiaireId);
      } catch (error) {
        echecsCarte.push(beneficiaireId);
        this.logger.error(
          `Génération de carte échouée pour le bénéficiaire ${beneficiaireId} (import ${importId}) : ${
            error instanceof Error ? error.message : 'erreur inconnue'
          }`,
        );
      }
    }

    const importMaj = await this.prisma.$transaction(async (tx) => {
      const imp2 = await tx.importAdherents.update({
        where: { id: importId },
        data: { statut: 'VALIDE', valideParId: ctx.userId, dateValidation: new Date() },
      });
      await this.audit(tx, ctx.userId, 'VALIDATION_IMPORT_ADHERENTS', imp2.id, {
        nbAdherentsCrees: adherentIds.length,
        nbBeneficiairesCrees: beneficiaires.length,
        nbCartesEnEchec: echecsCarte.length,
      });
      return imp2;
    });

    return {
      ...importMaj,
      nbAdherentsCrees: adherentIds.length,
      nbBeneficiairesCrees: beneficiaires.length,
      adherentIds,
      beneficiaires,
      echecsCarte,
    };
  }

  // --- Parsing Excel ---------------------------------------------------

  private async parserEtValider(
    ctx: ContexteAppelant,
    fichier: FichierTeleverse,
  ): Promise<{ lignesValides: LigneAdherentProposee[]; erreursDetail: LigneErreur[] }> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(fichier.buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('Fichier .xlsx illisible ou corrompu.');
    }
    const feuille = workbook.worksheets[0];
    if (!feuille || feuille.rowCount < 2) {
      return { lignesValides: [], erreursDetail: [] };
    }

    const ligneEntete = feuille.getRow(1);
    const colonnes = new Map<ColonneExcel, number>();
    ligneEntete.eachCell((cell, colNumber) => {
      const cle = ALIAS_ENTETES[normaliserEntete(String(cell.value ?? ''))];
      if (cle) colonnes.set(cle, colNumber);
    });
    const manquantes = (['nom', 'prenom', 'telephone', 'email', 'dateNaissance'] as const).filter(
      (c) => !colonnes.has(c),
    );
    if (manquantes.length > 0) {
      throw new BadRequestException(`Colonnes manquantes dans le fichier : ${manquantes.join(', ')}.`);
    }

    const brut = (n: number, col: ColonneExcel) => {
      const idx = colonnes.get(col)!;
      const valeur = feuille.getRow(n).getCell(idx).value;
      if (valeur instanceof Date) return valeur;
      if (valeur === null || valeur === undefined) return '';
      if (typeof valeur === 'object' && 'text' in (valeur as any)) return String((valeur as any).text ?? '');
      return String(valeur).trim();
    };

    const candidats: { ligne: number; donnees: Record<string, string>; parsed: LigneAdherentProposee | null; erreurs: string[] }[] = [];

    for (let n = 2; n <= feuille.rowCount; n++) {
      const row = feuille.getRow(n);
      if (row.cellCount === 0) continue;
      const nom = String(brut(n, 'nom'));
      const prenom = String(brut(n, 'prenom'));
      const telephone = String(brut(n, 'telephone')).replace(/[\s.-]/g, '');
      const email = String(brut(n, 'email')).trim().toLowerCase();
      const dateBrute = brut(n, 'dateNaissance');

      if (!nom && !prenom && !telephone && !email && !dateBrute) continue; // ligne vide, ignorée silencieusement

      const donnees = { nom, prenom, telephone, email, dateNaissance: String(dateBrute) };
      const erreurs: string[] = [];

      if (!nom) erreurs.push('nom manquant');
      if (!prenom) erreurs.push('prénom manquant');
      if (!telephone) erreurs.push('téléphone manquant');
      else if (!REGEX_TELEPHONE.test(telephone)) erreurs.push(`téléphone invalide (${telephone})`);
      if (!email) erreurs.push('email manquant');
      else if (!isEmail(email)) erreurs.push(`email invalide (${email})`);

      const dateNaissance = this.parserDate(dateBrute);
      if (!dateNaissance) erreurs.push('date de naissance invalide ou manquante');

      candidats.push({
        ligne: n,
        donnees,
        erreurs,
        parsed:
          erreurs.length === 0
            ? { type: 'ADHERENT', nom, prenom, telephone, email, dateNaissance: dateNaissance!.toISOString().slice(0, 10) }
            : null,
      });
    }

    // Doublon d'email DANS le fichier — toutes les lignes concernées en erreur.
    const occurrences = new Map<string, number[]>();
    for (const c of candidats) {
      if (!c.parsed) continue;
      const cle = c.parsed.email;
      occurrences.set(cle, [...(occurrences.get(cle) ?? []), c.ligne]);
    }
    const emailsEnDoublonFichier = new Set(
      [...occurrences.entries()].filter(([, lignes]) => lignes.length > 1).map(([email]) => email),
    );

    // Doublon d'email déjà présent en base (organisation entière).
    const emailsCandidats = candidats.filter((c) => c.parsed).map((c) => c.parsed!.email);
    const existants = emailsCandidats.length
      ? await this.prisma.adherent.findMany({
          where: { organisationId: ctx.organisationId, email: { in: emailsCandidats }, deletedAt: null },
          select: { email: true },
        })
      : [];
    const emailsExistants = new Set(existants.map((a) => a.email!));

    const lignesValides: LigneAdherentProposee[] = [];
    const erreursDetail: LigneErreur[] = [];
    for (const c of candidats) {
      const erreursFinales = [...c.erreurs];
      if (c.parsed && emailsEnDoublonFichier.has(c.parsed.email)) {
        erreursFinales.push(`email en doublon dans le fichier (${c.parsed.email})`);
      }
      if (c.parsed && emailsExistants.has(c.parsed.email)) {
        erreursFinales.push(`email déjà utilisé par un adhérent existant (${c.parsed.email})`);
      }
      if (erreursFinales.length === 0 && c.parsed) {
        lignesValides.push(c.parsed);
      } else {
        erreursDetail.push({ ligne: c.ligne, donnees: c.donnees, erreurs: erreursFinales });
      }
    }

    return { lignesValides, erreursDetail };
  }

  /** Colonnes du fichier sortants (identifiant + motif + statut cible
   * optionnel, défaut RADIE) — résout l'identifiant (numéro d'adhérent ou
   * email) en un `adherentId` réel de CETTE société, ACTIF. Tolérant aux
   * erreurs par ligne, comme `parserEtValider`. */
  private async parserEtValiderSortants(
    ctx: ContexteAppelant,
    souscripteurId: string,
    fichier: FichierTeleverse,
  ): Promise<{ sortants: { adherentId: string; statutCible: string; motif: string }[]; erreursDetail: LigneErreur[] }> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(fichier.buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('Fichier .xlsx illisible ou corrompu.');
    }
    const feuille = workbook.worksheets[0];
    if (!feuille || feuille.rowCount < 2) {
      return { sortants: [], erreursDetail: [] };
    }

    type ColonneSortant = 'identifiant' | 'motif' | 'statutCible';
    const ALIAS_SORTANT: Record<string, ColonneSortant> = {
      identifiant: 'identifiant',
      numeroadherent: 'identifiant',
      matricule: 'identifiant',
      email: 'identifiant',
      motif: 'motif',
      motifsortie: 'motif',
      statutcible: 'statutCible',
      statut: 'statutCible',
      typesortie: 'statutCible',
    };

    const ligneEntete = feuille.getRow(1);
    const colonnes = new Map<ColonneSortant, number>();
    ligneEntete.eachCell((cell, colNumber) => {
      const cle = ALIAS_SORTANT[normaliserEntete(String(cell.value ?? ''))];
      if (cle) colonnes.set(cle, colNumber);
    });
    const manquantes = (['identifiant', 'motif'] as const).filter((c) => !colonnes.has(c));
    if (manquantes.length > 0) {
      throw new BadRequestException(`Colonnes manquantes dans le fichier : ${manquantes.join(', ')}.`);
    }

    const brut = (n: number, col: ColonneSortant) => {
      const idx = colonnes.get(col);
      if (!idx) return '';
      const valeur = feuille.getRow(n).getCell(idx).value;
      if (valeur === null || valeur === undefined) return '';
      if (typeof valeur === 'object' && 'text' in (valeur as any)) return String((valeur as any).text ?? '');
      return String(valeur).trim();
    };

    const sortants: { adherentId: string; statutCible: string; motif: string }[] = [];
    const erreursDetail: LigneErreur[] = [];
    const adherentIdsVus = new Set<string>();

    for (let n = 2; n <= feuille.rowCount; n++) {
      const row = feuille.getRow(n);
      if (row.cellCount === 0) continue;
      const identifiant = brut(n, 'identifiant');
      const motif = brut(n, 'motif');
      const statutCibleBrut = colonnes.has('statutCible') ? brut(n, 'statutCible').toUpperCase() : '';
      if (!identifiant && !motif) continue; // ligne vide, ignorée silencieusement

      const donnees = { identifiant, motif, statutCible: statutCibleBrut };
      const erreurs: string[] = [];
      if (!identifiant) erreurs.push('identifiant manquant');
      if (!motif) erreurs.push('motif manquant');

      let statutCible: string | null = 'RADIE';
      if (statutCibleBrut) {
        statutCible = (STATUTS_SORTANT_CIBLE as readonly string[]).includes(statutCibleBrut) ? statutCibleBrut : null;
        if (!statutCible) erreurs.push(`statut cible invalide (${statutCibleBrut}) — attendu SUSPENDU ou RADIE`);
      }

      let adherentId: string | null = null;
      if (identifiant && erreurs.length === 0) {
        const adherent = await this.prisma.adherent.findFirst({
          where: {
            souscripteurId,
            organisationId: ctx.organisationId,
            deletedAt: null,
            OR: [{ numeroAdherent: identifiant }, { email: identifiant.toLowerCase() }],
          },
        });
        if (!adherent) erreurs.push(`adhérent introuvable pour cette société (${identifiant})`);
        else if (adherent.statut !== 'ACTIF') erreurs.push(`adhérent déjà « ${adherent.statut} »`);
        else if (adherentIdsVus.has(adherent.id)) erreurs.push('adhérent déjà présent plus haut dans le fichier');
        else adherentId = adherent.id;
      }

      if (erreurs.length === 0 && adherentId && statutCible) {
        adherentIdsVus.add(adherentId);
        sortants.push({ adherentId, statutCible, motif });
      } else {
        erreursDetail.push({ ligne: n, donnees, erreurs });
      }
    }

    return { sortants, erreursDetail };
  }

  /** 1er du mois indiqué (ou du mois calendaire suivant si omis) — toujours
   * normalisé au 1er, pour un calcul de coupure de facturation sans ambiguïté. */
  private resoudreMoisEffet(moisEffetStr?: string): Date {
    if (moisEffetStr) {
      const d = new Date(moisEffetStr);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException('moisEffet invalide (date attendue).');
      }
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    }
    const maintenant = new Date();
    return new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + 1, 1));
  }

  private parserDate(valeur: unknown): Date | null {
    if (valeur instanceof Date && !Number.isNaN(valeur.getTime())) return valeur;
    if (typeof valeur !== 'string' || !valeur.trim()) return null;
    const s = valeur.trim();
    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(`${s}T00:00:00.000Z`);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    // DD/MM/YYYY ou DD-MM-YYYY
    const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m) {
      const [, jj, mm, aaaa] = m;
      const d = new Date(Date.UTC(Number(aaaa), Number(mm) - 1, Number(jj)));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  /** Validation d'une ligne ADHERENT — mêmes règles que le parsing Excel
   * (`parserEtValider`), réutilisées par les propositions société
   * interactives (`proposerAdherent`/`modifierPropositionAdherent`). */
  private validerChampsAdherent(
    nom: string,
    prenom: string,
    telephoneBrut: string,
    emailBrut: string,
    dateNaissanceBrute: unknown,
  ): { erreurs: string[]; dateNaissanceISO: string | null; telephoneNormalise: string; emailNormalise: string } {
    const telephoneNormalise = String(telephoneBrut ?? '').replace(/[\s.-]/g, '');
    const emailNormalise = String(emailBrut ?? '').trim().toLowerCase();
    const erreurs: string[] = [];
    if (!nom?.trim()) erreurs.push('nom manquant');
    if (!prenom?.trim()) erreurs.push('prénom manquant');
    if (!telephoneNormalise) erreurs.push('téléphone manquant');
    else if (!REGEX_TELEPHONE.test(telephoneNormalise)) erreurs.push(`téléphone invalide (${telephoneNormalise})`);
    if (!emailNormalise) erreurs.push('email manquant');
    else if (!isEmail(emailNormalise)) erreurs.push(`email invalide (${emailNormalise})`);
    const date = this.parserDate(dateNaissanceBrute);
    if (!date) erreurs.push('date de naissance invalide ou manquante');
    return {
      erreurs,
      dateNaissanceISO: date ? date.toISOString().slice(0, 10) : null,
      telephoneNormalise,
      emailNormalise,
    };
  }

  private async audit(
    db: Db,
    userId: string,
    action: string,
    enregistrementId: string,
    details: Record<string, unknown> | null,
    tableCible: string = 'imports_adherents',
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
