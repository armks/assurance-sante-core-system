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

import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { MemberCarteService } from './carte.service';
import type {
  ListerPropositionsMembresQueryDto,
  ProposerAdherentMembreDto,
  ProposerBeneficiaireMembreDto,
} from './dto/propositions-membres.dto';
import {
  ROLES_LECTURE_PROPOSITIONS_ASSUREUR,
  ROLES_LECTURE_PROPOSITIONS_SOCIETE,
  ROLES_PROPOSITION_ADHERENTS_SOCIETE,
  ROLES_VALIDATION_PROPOSITION_MEMBRE,
} from './member.types';

const REGEX_TELEPHONE = /^\+?[0-9]{8,15}$/;
export const LIMITE_LISTE_PROPOSITIONS = 200;

interface Ctx {
  userId: string;
  organisationId: string;
  societeId: string | null;
  roleChain: string[];
}

type Db = Prisma.TransactionClient | PrismaService;

const aUnRole = (ctx: Ctx, roles: readonly string[]) => ctx.roleChain.some((r) => roles.includes(r));

/**
 * Propositions d'adhérents et de bénéficiaires par la société cliente. La société ne crée plus rien : elle PROPOSE ; l'assureur
 * (ASSUREUR_INFORMATIQUE / ASSUREUR_EXPLOITATION) valide — l'adhérent ou le bénéficiaire est alors créé, adhérent déjà « validé » —
 * ou rejette avec un motif. Tout est contrôlé ici : le périmètre (société / organisation) et les rôles ne reposent jamais sur l'écran.
 */
@Injectable()
export class PropositionsMembresService {
  private readonly logger = new Logger(PropositionsMembresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly cartes: MemberCarteService,
  ) {}

  private async contexte(user: AuthenticatedUser): Promise<Ctx> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    return {
      userId: profil.id,
      organisationId: profil.organisationId,
      societeId: profil.societeId ?? null,
      roleChain: permissions?.roleChain ?? [],
    };
  }

  private assertProposer(ctx: Ctx): string {
    if (!aUnRole(ctx, ROLES_PROPOSITION_ADHERENTS_SOCIETE) || !ctx.societeId) {
      throw new ForbiddenException('Seule la société cliente (SOCIETE_ASSUREE, SOCIETE_ADMINISTRATION) peut proposer un adhérent ou un bénéficiaire, pour sa propre société.');
    }
    return ctx.societeId;
  }

  private async audit(db: Db, action: string, id: string, ctx: Ctx, details: Record<string, unknown>): Promise<void> {
    await db.$executeRaw`
      SELECT log_audit(${action}::text, ${'propositions_membres'}::text, ${id}::uuid, ${ctx.userId}::uuid, ${JSON.stringify(details)}::jsonb)`;
  }

  private validerContacts(telephone?: string, email?: string) {
    const tel = String(telephone ?? '').replace(/[\s.-]/g, '');
    const mail = String(email ?? '').trim().toLowerCase();
    const erreurs: string[] = [];
    if (!tel && !mail) erreurs.push('Renseignez au moins un contact : numéro de téléphone ou e-mail (les deux sont recommandés).');
    if (tel && !REGEX_TELEPHONE.test(tel)) erreurs.push(`Numéro de téléphone invalide (${tel}).`);
    if (mail && !isEmail(mail)) erreurs.push(`E-mail invalide (${mail}).`);
    if (erreurs.length) throw new BadRequestException({ message: 'Proposition invalide.', erreurs });
    return { telephone: tel || null, email: mail || null };
  }

  // --- Société : proposer ------------------------------------------------------------

  async proposerAdherent(user: AuthenticatedUser, dto: ProposerAdherentMembreDto) {
    const ctx = await this.contexte(user);
    const societeId = this.assertProposer(ctx);
    const { telephone, email } = this.validerContacts(dto.telephone, dto.email);

    const souscripteur = await this.prisma.souscripteur.findFirst({ where: { id: societeId, organisationId: ctx.organisationId, deletedAt: null } });
    if (!souscripteur) throw new NotFoundException('Société introuvable.');
    if (souscripteur.statut === 'ARCHIVE') throw new ConflictException(`La société « ${souscripteur.nom} » est archivée : aucune proposition.`);

    // formule rattachée = police ACTIVE de LA société (jamais celle d'une autre)
    const police = await this.prisma.police.findFirst({ where: { id: dto.policeId, souscripteurId: societeId, organisationId: ctx.organisationId, statut: 'ACTIVE', deletedAt: null } });
    if (!police) throw new BadRequestException('Formule inconnue : choisissez une police active de votre société.');

    if (email) {
      const pris = await this.prisma.adherent.findFirst({ where: { email, deletedAt: null }, select: { id: true } });
      if (pris) throw new ConflictException(`Cet e-mail est déjà utilisé par un adhérent existant (${email}).`);
      const attente = await this.prisma.propositionMembre.findFirst({
        where: { organisationId: ctx.organisationId, type: 'ADHERENT', statut: 'EN_ATTENTE', email, deletedAt: null },
        select: { id: true },
      });
      if (attente) throw new ConflictException(`Cet e-mail fait déjà l'objet d'une proposition en attente (${email}).`);
    }

    const cree = await this.prisma.$transaction(async (tx) => {
      const p = await tx.propositionMembre.create({
        data: {
          organisationId: ctx.organisationId,
          souscripteurId: societeId,
          type: 'ADHERENT',
          nom: dto.nom.trim(),
          prenom: dto.prenom.trim(),
          dateNaissance: new Date(dto.dateNaissance),
          sexe: dto.sexe,
          policeId: police.id,
          telephone,
          email,
          proposePar: ctx.userId,
        },
      });
      await this.audit(tx, 'PROPOSITION_ADHERENT', p.id, ctx, { souscripteurId: societeId, policeId: police.id });
      return p;
    });
    return this.presenter(cree, ctx);
  }

  async proposerBeneficiaire(user: AuthenticatedUser, dto: ProposerBeneficiaireMembreDto) {
    const ctx = await this.contexte(user);
    const societeId = this.assertProposer(ctx);
    // le titulaire doit exister ET appartenir à la société de l'appelant (jamais un adhérent d'une autre société)
    const parent = await this.prisma.adherent.findFirst({
      where: { id: dto.adherentId, souscripteurId: societeId, organisationId: ctx.organisationId, deletedAt: null },
      select: { id: true, statut: true },
    });
    if (!parent) throw new NotFoundException('Adhérent titulaire introuvable pour votre société.');
    if (parent.statut === 'RADIE') throw new ConflictException("L'adhérent titulaire est radié : aucune proposition de bénéficiaire.");

    const cree = await this.prisma.$transaction(async (tx) => {
      const p = await tx.propositionMembre.create({
        data: {
          organisationId: ctx.organisationId,
          souscripteurId: societeId,
          type: 'BENEFICIAIRE',
          nom: dto.nom.trim(),
          prenom: dto.prenom.trim(),
          dateNaissance: new Date(dto.dateNaissance),
          sexe: dto.sexe,
          adherentParentId: parent.id,
          lienParente: dto.lienParente,
          proposePar: ctx.userId,
        },
      });
      await this.audit(tx, 'PROPOSITION_BENEFICIAIRE', p.id, ctx, { souscripteurId: societeId, adherentId: parent.id });
      return p;
    });
    return this.presenter(cree, ctx);
  }

  async retirer(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexte(user);
    const societeId = this.assertProposer(ctx);
    const p = await this.charger(ctx, id, societeId);
    if (p.statut !== 'EN_ATTENTE') throw new ConflictException(`Cette proposition est déjà ${p.statut} : elle ne peut plus être retirée.`);
    const maj = await this.prisma.$transaction(async (tx) => {
      const r = await tx.propositionMembre.updateMany({ where: { id, statut: 'EN_ATTENTE' }, data: { statut: 'RETIREE' } });
      if (r.count !== 1) throw new ConflictException('Cette proposition vient d’être traitée par l’assureur.');
      await this.audit(tx, 'RETRAIT_PROPOSITION_MEMBRE', id, ctx, { type: p.type });
      return tx.propositionMembre.findUniqueOrThrow({ where: { id } });
    });
    return this.presenter(maj, ctx);
  }

  // --- Lecture -------------------------------------------------------------------------

  /** Société : SES propositions. Assureur : toutes celles de l'organisation. Jamais d'une autre société ni d'une autre organisation. */
  async lister(user: AuthenticatedUser, q: ListerPropositionsMembresQueryDto = {}) {
    const ctx = await this.contexte(user);
    const assureur = aUnRole(ctx, ROLES_LECTURE_PROPOSITIONS_ASSUREUR);
    const societe = aUnRole(ctx, ROLES_LECTURE_PROPOSITIONS_SOCIETE) && !!ctx.societeId;
    if (!assureur && !societe) throw new ForbiddenException('La consultation des propositions est réservée à la société cliente et à l’assureur habilité.');
    const where: Prisma.PropositionMembreWhereInput = {
      organisationId: ctx.organisationId,
      deletedAt: null,
      ...(assureur ? (q.souscripteurId ? { souscripteurId: q.souscripteurId } : {}) : { souscripteurId: ctx.societeId! }),
      ...(q.statut ? { statut: q.statut } : {}),
      ...(q.type ? { type: q.type } : {}),
    };
    const lignes = await this.prisma.propositionMembre.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: LIMITE_LISTE_PROPOSITIONS });
    const societes = await this.prisma.souscripteur.findMany({ where: { id: { in: [...new Set(lignes.map((l) => l.souscripteurId))] } }, select: { id: true, nom: true } });
    const nomSociete = new Map(societes.map((s) => [s.id, s.nom]));
    const polices = await this.prisma.police.findMany({
      where: { id: { in: lignes.flatMap((l) => (l.policeId ? [l.policeId] : [])) } },
      select: { id: true, numeroPolice: true, produit: { select: { nom: true } } },
    });
    const formule = new Map(polices.map((p) => [p.id, `${p.numeroPolice} · ${p.produit.nom}`]));
    return lignes.map((l) => ({ ...this.presenter(l, ctx), societe: nomSociete.get(l.souscripteurId) ?? null, formule: l.policeId ? (formule.get(l.policeId) ?? null) : null }));
  }

  // --- Assureur : valider / rejeter ----------------------------------------------------

  private assertValidateur(ctx: Ctx): void {
    if (!aUnRole(ctx, ROLES_VALIDATION_PROPOSITION_MEMBRE)) {
      throw new ForbiddenException('La validation des propositions est réservée à ASSUREUR_INFORMATIQUE et ASSUREUR_EXPLOITATION.');
    }
  }

  async rejeter(user: AuthenticatedUser, id: string, motif: string) {
    const ctx = await this.contexte(user);
    this.assertValidateur(ctx);
    const texte = (motif ?? '').trim();
    if (texte.length < 5) throw new BadRequestException('Le motif du rejet est obligatoire (5 caractères au moins).');
    const p = await this.charger(ctx, id);
    if (p.statut !== 'EN_ATTENTE') throw new ConflictException(`Cette proposition est déjà ${p.statut}.`);
    const maj = await this.prisma.$transaction(async (tx) => {
      const r = await tx.propositionMembre.updateMany({
        where: { id, statut: 'EN_ATTENTE' },
        data: { statut: 'REJETEE', motifRejet: texte, decidePar: ctx.userId, dateDecision: new Date() },
      });
      if (r.count !== 1) throw new ConflictException('Cette proposition vient d’être traitée.');
      await this.audit(tx, 'REJET_PROPOSITION_MEMBRE', id, ctx, { type: p.type, motif: texte });
      return tx.propositionMembre.findUniqueOrThrow({ where: { id } });
    });
    return this.presenter(maj, ctx);
  }

  /**
   * Valide : crée l'adhérent (déjà « validé » : date de validation et validateur renseignés, éligible à la facturation selon la coupure du mois)
   * ou le bénéficiaire (ACTIF), avec sa carte. Les contrôles sont rejoués AU MOMENT de la validation (société archivée, police plus active,
   * e-mail devenu pris…) : en cas d'échec, la proposition reste EN_ATTENTE et rien n'est créé.
   */
  async valider(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexte(user);
    this.assertValidateur(ctx);
    const p = await this.charger(ctx, id);
    if (p.statut !== 'EN_ATTENTE') throw new ConflictException(`Cette proposition est déjà ${p.statut}.`);

    const souscripteur = await this.prisma.souscripteur.findFirst({ where: { id: p.souscripteurId, organisationId: ctx.organisationId, deletedAt: null } });
    if (!souscripteur) throw new NotFoundException('Société introuvable.');
    if (souscripteur.statut === 'ARCHIVE') throw new ConflictException(`La société « ${souscripteur.nom} » est archivée : validation impossible.`);

    let adherentCreeId: string | null = null;
    let beneficiaireCreeId: string | null = null;
    const maj = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.propositionMembre.updateMany({
        where: { id, statut: 'EN_ATTENTE', dateDecision: null },
        data: { decidePar: ctx.userId, dateDecision: new Date() },
      });
      if (claim.count !== 1) throw new ConflictException('Cette proposition vient d’être traitée.');

      if (p.type === 'ADHERENT') {
        const police = await tx.police.findFirst({ where: { id: p.policeId ?? '', souscripteurId: p.souscripteurId, organisationId: ctx.organisationId, statut: 'ACTIVE', deletedAt: null } });
        if (!police) throw new ConflictException('La formule rattachée n’est plus une police active de la société : demandez une nouvelle proposition.');
        if (p.email) {
          const pris = await tx.adherent.findFirst({ where: { email: p.email }, select: { id: true } });
          if (pris) throw new ConflictException(`Cet e-mail est déjà utilisé par un adhérent (${p.email}).`);
        }
        const a = await tx.adherent.create({
          data: {
            organisationId: ctx.organisationId,
            souscripteurId: p.souscripteurId,
            policeId: police.id,
            nom: p.nom,
            prenom: p.prenom,
            dateNaissance: p.dateNaissance,
            sexe: p.sexe,
            email: p.email,
            telephone: p.telephone,
            dateValidation: new Date(),
            valideParId: ctx.userId,
          },
        });
        adherentCreeId = a.id;
        await tx.$executeRaw`
          SELECT log_audit(${'CREATION_ADHERENT_PROPOSITION'}::text, ${'adherents'}::text, ${a.id}::uuid, ${ctx.userId}::uuid,
            ${JSON.stringify({ propositionId: id, numeroAdherent: a.numeroAdherent, souscripteurId: p.souscripteurId })}::jsonb)`;
      } else {
        const parent = await tx.adherent.findFirst({
          where: { id: p.adherentParentId ?? '', souscripteurId: p.souscripteurId, organisationId: ctx.organisationId, deletedAt: null },
          select: { id: true, statut: true },
        });
        if (!parent) throw new ConflictException('L’adhérent titulaire n’existe plus dans cette société.');
        if (parent.statut === 'RADIE') throw new ConflictException('L’adhérent titulaire est radié : validation impossible.');
        const b = await tx.beneficiaire.create({
          data: { adherentId: parent.id, lienParente: p.lienParente!, nom: p.nom, prenom: p.prenom, dateNaissance: p.dateNaissance, sexe: p.sexe },
        });
        beneficiaireCreeId = b.id;
        await tx.$executeRaw`
          SELECT log_audit(${'CREATION_BENEFICIAIRE_PROPOSITION'}::text, ${'beneficiaires'}::text, ${b.id}::uuid, ${ctx.userId}::uuid,
            ${JSON.stringify({ propositionId: id, adherentId: parent.id })}::jsonb)`;
      }
      // statut VALIDEE posé avec l'élément créé : la contrainte `propositions_membres_validee_creee` l'exige dans la même écriture
      await tx.propositionMembre.update({ where: { id }, data: { statut: 'VALIDEE', adherentCreeId, beneficiaireCreeId } });
      await this.audit(tx, 'VALIDATION_PROPOSITION_MEMBRE', id, ctx, { type: p.type, adherentCreeId, beneficiaireCreeId });
      return tx.propositionMembre.findUniqueOrThrow({ where: { id } });
    });

    // La carte est générée après coup : un échec de stockage ne défait pas la validation (carte régénérable).
    let carteGeneree = true;
    try {
      if (adherentCreeId) await this.cartes.genererCarteAdherent(user, adherentCreeId);
      else if (beneficiaireCreeId) await this.cartes.genererCarteBeneficiaire(user, p.adherentParentId!, beneficiaireCreeId);
    } catch (e) {
      carteGeneree = false;
      this.logger.error(`Carte non générée (proposition ${id}) : ${e instanceof Error ? e.message : 'erreur inconnue'}`);
    }
    return { ...this.presenter(maj, ctx), carteGeneree };
  }

  // --- Aides ---------------------------------------------------------------------------

  private async charger(ctx: Ctx, id: string, societeId?: string) {
    const p = await this.prisma.propositionMembre.findFirst({
      where: { id, organisationId: ctx.organisationId, deletedAt: null, ...(societeId ? { souscripteurId: societeId } : {}) },
    });
    // hors périmètre : jamais révélé
    if (!p) throw new NotFoundException('Proposition introuvable.');
    return p;
  }

  /** Statut + « action possible ? » côté serveur (même principe que les verdicts de dépendances) : l'écran ne fait que les afficher. */
  private presenter(p: Prisma.PropositionMembreGetPayload<object>, ctx: Ctx) {
    const enAttente = p.statut === 'EN_ATTENTE';
    const peutDecider = aUnRole(ctx, ROLES_VALIDATION_PROPOSITION_MEMBRE);
    const peutRetirer = aUnRole(ctx, ROLES_PROPOSITION_ADHERENTS_SOCIETE) && ctx.societeId === p.souscripteurId;
    const verdict = (autorise: boolean, refus: string) =>
      !autorise ? { possible: false, raison: refus } : !enAttente ? { possible: false, raison: `La proposition est déjà ${p.statut}.` } : { possible: true, raison: null };
    return {
      id: p.id,
      type: p.type,
      statut: p.statut,
      souscripteurId: p.souscripteurId,
      nom: p.nom,
      prenom: p.prenom,
      dateNaissance: p.dateNaissance.toISOString().slice(0, 10),
      sexe: p.sexe,
      policeId: p.policeId,
      telephone: p.telephone,
      email: p.email,
      adherentParentId: p.adherentParentId,
      lienParente: p.lienParente,
      motifRejet: p.motifRejet,
      dateProposition: p.createdAt,
      dateDecision: p.dateDecision,
      adherentCreeId: p.adherentCreeId,
      beneficiaireCreeId: p.beneficiaireCreeId,
      actions: {
        valider: verdict(peutDecider, 'Seuls ASSUREUR_INFORMATIQUE et ASSUREUR_EXPLOITATION valident.'),
        rejeter: verdict(peutDecider, 'Seuls ASSUREUR_INFORMATIQUE et ASSUREUR_EXPLOITATION rejettent.'),
        retirer: verdict(peutRetirer, 'Seule la société qui a proposé peut retirer sa proposition.'),
      },
    };
  }
}
