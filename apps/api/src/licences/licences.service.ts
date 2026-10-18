import { randomInt } from 'node:crypto';
import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { EmailService } from '../email/email.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  calculerEtat,
  calculerPeriode,
  DUREE_MOIS,
  ESSAI_JOURS,
  LIBELLE_TYPE_LICENCE,
  ROLES_ACTIVATION_LICENCE,
  VALIDITE_CODE_ACTIVATION_MS,
  type EtatLicence,
  type TypeLicence,
} from './licence-etat';

const ROLE_SUPERADMIN = 'SUPERADMIN_PRINCIPAL';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LONGUEUR_CODE = 12;
const CACHE_MS = 15_000;
type Db = PrismaService | Prisma.TransactionClient;

const fr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');
const groupes = (c: string) => c.match(/.{1,4}/g)!.join('-');
/** « jean.dupont@exemple.ci » → « je***@exemple.ci » : confirme le destinataire sans exposer l'adresse. */
const masquerEmail = (e: string) => e.replace(/^(.{1,2})[^@]*(@.*)$/, '$1***$2');
const dateHeureFr = (d: Date) => `${fr(d.toISOString().slice(0, 10))} à ${d.toISOString().slice(11, 16)} UTC`;

/**
 * Activation et suivi des licences des sociétés d'assurance. Le superadmin génère un code d'activation TEMPORAIRE (24 h), stocké
 * haché + chiffré et reçu par e-mail ; l'administrateur de l'assureur (informatique ou direction) le saisit pour activer ou
 * renouveler la licence. Le superadmin peut aussi activer directement une société et lui envoyer une alerte d'expiration.
 */
@Injectable()
export class LicencesService {
  private readonly logger = new Logger(LicencesService.name);
  private readonly cache = new Map<string, { etat: EtatLicence; expire: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly email: EmailService,
  ) {}

  // ------------------------------------------------------------------ état et cache
  async etatOrganisation(organisationId: string, frais = false): Promise<EtatLicence> {
    const c = this.cache.get(organisationId);
    if (!frais && c && c.expire > Date.now()) return c.etat;
    const l = await this.prisma.licenceOrganisation.findUnique({ where: { organisationId } });
    const etat = calculerEtat(l);
    this.cache.set(organisationId, { etat, expire: Date.now() + CACHE_MS });
    return etat;
  }

  invalider(organisationId: string) {
    this.cache.delete(organisationId);
  }

  // ------------------------------------------------------------------ côté assureur
  private async contexte(user: AuthenticatedUser) {
    const { profil, permissions } = await this.identity.getMe(user);
    return { userId: profil.id, organisationId: profil.organisationId, roleChain: permissions?.roleChain ?? [], email: profil.email ?? user.email };
  }

  private async assertSuperadmin(user: AuthenticatedUser) {
    const ctx = await this.contexte(user);
    if (!ctx.roleChain.includes(ROLE_SUPERADMIN)) throw new ForbiddenException('Action réservée au superadministrateur.');
    return ctx;
  }

  private estActivateur(roleChain: string[]) {
    return roleChain.some((r) => (ROLES_ACTIVATION_LICENCE as readonly string[]).includes(r));
  }

  /** Licence de ma société : réservée aux administrateurs (informatique et direction de l'assureur). */
  async statut(user: AuthenticatedUser) {
    const ctx = await this.contexte(user);
    if (!ctx.organisationId) throw new NotFoundException('Ce compte n’est rattaché à aucune société.');
    const etat = await this.etatOrganisation(ctx.organisationId, true);
    const peutActiver = this.estActivateur(ctx.roleChain);
    const codeEnAttente = peutActiver
      ? await this.prisma.codeActivationLicence.findFirst({
          where: { organisationId: ctx.organisationId, statut: 'EMIS', dateExpiration: { gt: new Date() } },
          select: { dateExpiration: true, typeLicence: true },
        })
      : null;
    return {
      ...etat,
      libelleType: etat.typeLicence ? LIBELLE_TYPE_LICENCE[etat.typeLicence] : null,
      peutActiver,
      codeEnAttente: codeEnAttente ? { typeLicence: codeEnAttente.typeLicence, expireLe: codeEnAttente.dateExpiration } : null,
    };
  }

  /** Saisie du code d'activation par l'administrateur : active ou renouvelle la licence de SA société. */
  async activer(user: AuthenticatedUser, codeSaisi: string) {
    const ctx = await this.contexte(user);
    if (!ctx.organisationId || !this.estActivateur(ctx.roleChain)) {
      throw new ForbiddenException('Seuls l’informatique et la direction de l’assureur peuvent activer la licence.');
    }
    const code = codeSaisi.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    // même réponse pour un code inconnu, d'une autre société, déjà utilisé ou expiré : aucun indice pour un attaquant
    const introuvable = () => new NotFoundException('Code d’activation invalide ou expiré. Demandez-en un nouveau au support.');
    const ligne = await this.prisma.codeActivationLicence.findFirst({ where: { code, organisationId: ctx.organisationId } });
    if (!ligne) throw introuvable();
    const maintenant = new Date();
    if (ligne.statut === 'EMIS' && ligne.dateExpiration <= maintenant) {
      await this.prisma.codeActivationLicence.updateMany({ where: { id: ligne.id, statut: 'EMIS' }, data: { statut: 'EXPIRE' } });
      throw introuvable();
    }
    if (ligne.statut !== 'EMIS') throw introuvable();

    const licence = await this.prisma.$transaction(async (tx) => {
      const maj = await tx.codeActivationLicence.updateMany({
        where: { id: ligne.id, statut: 'EMIS', dateExpiration: { gt: maintenant } },
        data: { statut: 'ACTIVE', activePar: ctx.userId, dateActivation: maintenant },
      });
      if (maj.count !== 1) throw introuvable();
      return this.appliquer(tx, ctx.organisationId!, ligne.typeLicence as TypeLicence);
    });
    this.invalider(ctx.organisationId);
    this.logger.log(`Licence ${ligne.typeLicence} activée pour ${ctx.organisationId} par ${ctx.userId}.`);
    return { ...calculerEtat(licence), libelleType: LIBELLE_TYPE_LICENCE[ligne.typeLicence as TypeLicence] };
  }

  /** Applique un type de licence : prolonge la période en cours si elle est encore valide, sinon repart d'aujourd'hui. */
  private async appliquer(db: Db, organisationId: string, type: TypeLicence) {
    const courante = await db.licenceOrganisation.findUnique({ where: { organisationId } });
    if (courante?.statut === 'SUSPENDUE') {
      throw new ConflictException('La licence de cette société est suspendue : contactez le support de la plateforme.');
    }
    const { dateDebut, dateFin } = calculerPeriode(type, courante);
    const prolonge = !!courante && courante.statut === 'ACTIVE' && type !== 'ESSAI' && courante.dateFin !== null && courante.dateFin >= dateDebut;
    return db.licenceOrganisation.upsert({
      where: { organisationId },
      create: { organisationId, typeLicence: type, dateDebut, dateFin, statut: 'ACTIVE' },
      update: { typeLicence: type, dateDebut: prolonge ? courante!.dateDebut : dateDebut, dateFin, statut: 'ACTIVE' },
    });
  }

  // ------------------------------------------------------------------ côté superadmin
  async lister(user: AuthenticatedUser) {
    await this.assertSuperadmin(user);
    await this.prisma.codeActivationLicence.updateMany({ where: { statut: 'EMIS', dateExpiration: { lte: new Date() } }, data: { statut: 'EXPIRE' } });
    const organisations = await this.prisma.organisation.findMany({
      where: { deletedAt: null },
      orderBy: { nom: 'asc' },
      select: { id: true, nom: true, statut: true, licence: true, emailContact: true },
    });
    const directeurs = await this.prisma.profil.groupBy({
      by: ['organisationId'],
      where: { role: 'ASSUREUR_DIRECTION', deletedAt: null, organisationId: { in: organisations.map((o) => o.id) } },
      _count: { _all: true },
    });
    const codes = await this.prisma.codeActivationLicence.findMany({
      where: { organisationId: { in: organisations.map((o) => o.id) } },
      orderBy: { dateGeneration: 'desc' },
      select: { organisationId: true, typeLicence: true, statut: true, dateExpiration: true, dateActivation: true, dateGeneration: true },
    });
    return organisations.map((o) => {
      const etat = calculerEtat(o.licence);
      const deLaSociete = codes.filter((c) => c.organisationId === o.id);
      const enAttente = deLaSociete.find((c) => c.statut === 'EMIS');
      const derniere = deLaSociete.find((c) => c.statut === 'ACTIVE');
      return {
        organisationId: o.id,
        nom: o.nom,
        statutOrganisation: o.statut,
        ...etat,
        libelleType: etat.typeLicence ? LIBELLE_TYPE_LICENCE[etat.typeLicence] : null,
        codeEnAttente: enAttente ? { typeLicence: enAttente.typeLicence, expireLe: enAttente.dateExpiration } : null,
        // destinataires possibles du code (adresses jamais exposées ici)
        emailSociete: o.emailContact?.trim() || null,
        nbDirecteurs: directeurs.find((d) => d.organisationId === o.id)?._count._all ?? 0,
        derniereActivation: derniere ? { typeLicence: derniere.typeLicence, le: derniere.dateActivation } : null,
      };
    });
  }

  private async chargerOrganisation(id: string) {
    const org = await this.prisma.organisation.findFirst({ where: { id, deletedAt: null }, select: { id: true, nom: true } });
    if (!org) throw new NotFoundException('Société introuvable.');
    return org;
  }

  /** Un essai n'est accordé qu'une fois par société. */
  private async assertEssaiPossible(organisationId: string, type: TypeLicence) {
    if (type !== 'ESSAI') return;
    const [deja, courante] = await Promise.all([
      this.prisma.codeActivationLicence.count({ where: { organisationId, typeLicence: 'ESSAI', statut: 'ACTIVE' } }),
      this.prisma.licenceOrganisation.findUnique({ where: { organisationId }, select: { typeLicence: true } }),
    ]);
    if (deja > 0 || courante?.typeLicence === 'ESSAI') throw new ConflictException('Cette société a déjà bénéficié de sa licence d’essai.');
  }

  private codeAleatoire(): string {
    let c = '';
    for (let i = 0; i < LONGUEUR_CODE; i += 1) c += ALPHABET[randomInt(ALPHABET.length)];
    return c;
  }

  /**
   * Génère un code d'activation temporaire (24 h) pour une société. Le code n'est jamais renvoyé par l'API : il est envoyé par
   * e-mail au superadmin (qui le transmet à l'administrateur de la société). Repli si l'e-mail ne part pas : le code est alors
   * affiché une seule fois au superadmin.
   */
  async genererCode(user: AuthenticatedUser, organisationId: string, type: TypeLicence) {
    const ctx = await this.assertSuperadmin(user);
    const org = await this.chargerOrganisation(organisationId);
    await this.assertEssaiPossible(organisationId, type);

    // un seul code en attente par société : le précédent est annulé
    await this.prisma.codeActivationLicence.updateMany({ where: { organisationId, statut: 'EMIS' }, data: { statut: 'ANNULE' } });
    let code = this.codeAleatoire();
    for (let i = 0; i < 5 && (await this.prisma.codeActivationLicence.findFirst({ where: { code }, select: { id: true } })); i += 1) code = this.codeAleatoire();
    const expire = new Date(Date.now() + VALIDITE_CODE_ACTIVATION_MS);
    const cree = await this.prisma.codeActivationLicence.create({
      // prix figé au tarif du jour : un changement de grille n'altère jamais l'historique
      data: { organisationId, typeLicence: type, code, genererPar: ctx.userId, dateExpiration: expire, prix: await this.prixDe(type), mode: 'CODE' },
    });

    const destinataire = ctx.email ?? process.env.SUPERADMIN_EMAIL ?? null;
    const sujet = `Code d’activation de licence — ${org.nom}`;
    const contenu =
      `Code d’activation pour « ${org.nom} » — ${LIBELLE_TYPE_LICENCE[type]}\n\n` +
      `    ${groupes(code)}\n\n` +
      `Valable jusqu’au ${dateHeureFr(expire)} (24 h). Sans activation avant cette échéance, le code expire et il faudra en générer un nouveau.\n` +
      `À transmettre uniquement à l’administrateur de la société (informatique ou direction), qui le saisit à sa connexion.\n` +
      `Ce code est à usage unique et ne doit jamais être partagé en dehors de ce canal.`;
    const envoi = destinataire ? await this.email.envoyerEmail(destinataire, sujet, contenu) : { envoye: false };
    return {
      codeId: cree.id,
      organisation: org.nom,
      typeLicence: type,
      libelleType: LIBELLE_TYPE_LICENCE[type],
      expireLe: expire,
      envoyeParEmail: envoi.envoye,
      destinataire,
      // repli : affiché une seule fois si l'e-mail n'a pas pu partir (messagerie non configurée, adresse absente…)
      ...(envoi.envoye ? {} : { code: groupes(code) }),
    };
  }

  /**
   * Envoie par e-mail le code d'activation EN ATTENTE (non expiré) de la société, à l'adresse de la société d'assurance ou à son
   * (ses) directeur(s). Les adresses ne sont jamais saisies librement : uniquement celles enregistrées pour la société et ses
   * directeurs. Le code est relu en base (déchiffré) ; il n'apparaît dans aucune réponse de l'API.
   */
  async envoyerCode(user: AuthenticatedUser, organisationId: string, cible: 'SOCIETE' | 'DIRECTEUR') {
    await this.assertSuperadmin(user);
    const org = await this.prisma.organisation.findFirst({ where: { id: organisationId, deletedAt: null }, select: { id: true, nom: true, emailContact: true } });
    if (!org) throw new NotFoundException('Société introuvable.');
    const code = await this.prisma.codeActivationLicence.findFirst({
      where: { organisationId, statut: 'EMIS', dateExpiration: { gt: new Date() } },
      orderBy: { dateGeneration: 'desc' },
    });
    if (!code) throw new NotFoundException('Aucun code d’activation valide pour cette société : générez-en un d’abord (un code expire 24 h après sa génération).');

    const destinataires = cible === 'SOCIETE' ? (org.emailContact?.trim() ? [org.emailContact.trim()] : []) : await this.emailsAdministrateurs(organisationId, ['ASSUREUR_DIRECTION']);
    if (destinataires.length === 0) {
      throw new NotFoundException(cible === 'SOCIETE' ? 'Aucune adresse e-mail n’est enregistrée pour cette société.' : 'Aucun directeur avec une adresse e-mail dans cette société.');
    }
    const contenu =
      `Bonjour,

Voici le code d’activation de la licence de « ${org.nom} » — ${LIBELLE_TYPE_LICENCE[code.typeLicence as TypeLicence]} :

` +
      `    ${groupes(code.code)}

` +
      `Ce code est valable jusqu’au ${dateHeureFr(code.dateExpiration)} (24 h après son émission) et ne sert qu’une fois.
` +
      `Connectez-vous à l’application avec votre compte de direction ou d’informatique : la fenêtre d’activation vous demandera ce code.

` +
      `Ne le transmettez à personne d’autre.`;
    const envoi = await this.email.envoyerEmail(destinataires, `Code d’activation de votre licence — ${org.nom}`, contenu);
    this.logger.log(`Code d'activation de ${org.nom} envoyé (${cible}) : ${envoi.envoye ? destinataires.length + ' destinataire(s)' : 'échec'}.`);
    return {
      envoye: envoi.envoye,
      cible,
      destinataires: destinataires.map(masquerEmail),
      expireLe: code.dateExpiration,
    };
  }

  /** Enregistre l'adresse e-mail de la société d'assurance (destinataire possible du code d'activation). */
  async definirEmailSociete(user: AuthenticatedUser, organisationId: string, email: string) {
    await this.assertSuperadmin(user);
    await this.chargerOrganisation(organisationId);
    const propre = email.trim().toLowerCase();
    await this.prisma.organisation.update({ where: { id: organisationId }, data: { emailContact: propre } });
    return { organisationId, emailSociete: propre };
  }

  /** Activation directe par le superadmin, sans code : la trace est conservée dans l'historique des activations. */
  async activerDirectement(user: AuthenticatedUser, organisationId: string, type: TypeLicence) {
    const ctx = await this.assertSuperadmin(user);
    const org = await this.chargerOrganisation(organisationId);
    await this.assertEssaiPossible(organisationId, type);
    const maintenant = new Date();
    const licence = await this.prisma.$transaction(async (tx) => {
      await tx.codeActivationLicence.updateMany({ where: { organisationId, statut: 'EMIS' }, data: { statut: 'ANNULE' } });
      await tx.codeActivationLicence.create({
        data: { organisationId, typeLicence: type, code: this.codeAleatoire(), genererPar: ctx.userId, dateExpiration: maintenant, statut: 'ACTIVE', activePar: ctx.userId, dateActivation: maintenant, prix: await this.prixDe(type), mode: 'DIRECTE' },
      });
      return this.appliquer(tx, organisationId, type);
    });
    this.invalider(organisationId);
    this.logger.log(`Licence ${type} activée directement pour ${org.nom} par ${ctx.userId}.`);
    return { organisation: org.nom, ...calculerEtat(licence), libelleType: LIBELLE_TYPE_LICENCE[type] };
  }

  /** Alerte d'expiration envoyée par e-mail aux administrateurs (informatique et direction) de la société. */
  async envoyerAlerte(user: AuthenticatedUser, organisationId: string) {
    await this.assertSuperadmin(user);
    const org = await this.chargerOrganisation(organisationId);
    const etat = await this.etatOrganisation(organisationId, true);
    const destinataires = await this.emailsAdministrateurs(organisationId);
    if (destinataires.length === 0) throw new NotFoundException('Aucun administrateur (informatique ou direction) avec une adresse e-mail dans cette société.');
    const statutTexte =
      etat.etat === 'ACTIVE'
        ? etat.joursRestants === null
          ? 'Votre licence est active, sans échéance.'
          : `Votre licence expire le ${fr(etat.dateFin)} (dans ${etat.joursRestants} jour${etat.joursRestants > 1 ? 's' : ''}).`
        : etat.etat === 'EXPIREE'
          ? `Votre licence a expiré le ${fr(etat.dateFin)} : l’accès à l’application est suspendu.`
          : 'Votre licence n’est pas activée : l’accès à l’application est suspendu.';
    const contenu =
      `Bonjour,\n\n${statutTexte}\n\n` +
      `Pour renouveler ou activer votre licence, contactez le support de la plateforme afin de recevoir un code d’activation, ` +
      `puis connectez-vous : la fenêtre d’activation vous demandera ce code (valable 24 h après son envoi).\n\n` +
      `Société concernée : ${org.nom}.`;
    const envoi = await this.email.envoyerEmail(destinataires, `Licence — ${org.nom} : échéance à renouveler`, contenu);
    return { organisation: org.nom, destinataires: destinataires.length, envoye: envoi.envoye, joursRestants: etat.joursRestants, etat: etat.etat };
  }

  private async emailsAdministrateurs(organisationId: string, roles: string[] = ['ASSUREUR_INFORMATIQUE', 'ASSUREUR_INFORMATIQUE_ADJOINT', 'ASSUREUR_DIRECTION']): Promise<string[]> {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const profils = await this.prisma.profil.findMany({
      where: { organisationId, deletedAt: null, role: { in: roles } },
      select: { id: true },
    });
    const emails = new Set<string>();
    for (const p of profils) {
      const { data } = await admin.auth.admin.getUserById(p.id).catch(() => ({ data: null }));
      if (data?.user?.email) emails.add(data.user.email);
    }
    return [...emails];
  }

  // ------------------------------------------------------------------ prix et historique
  private async prixDe(type: TypeLicence): Promise<number> {
    const t = await this.prisma.tarifLicence.findUnique({ where: { typeLicence: type } });
    return Number(t?.prix ?? 0);
  }

  /** Types proposés au superadmin, avec leur durée et leur prix actuel. */
  async types(user: AuthenticatedUser) {
    await this.assertSuperadmin(user);
    const tarifs = await this.prisma.tarifLicence.findMany();
    return (['ESSAI', 'MENSUELLE', 'TRIMESTRIELLE', 'SEMESTRIELLE', 'ANNUELLE', 'BIENNALE'] as TypeLicence[]).map((t) => ({
      valeur: t,
      libelle: LIBELLE_TYPE_LICENCE[t],
      duree: t === 'ESSAI' ? `${ESSAI_JOURS} jours` : `${DUREE_MOIS[t]} mois`,
      prix: Number(tarifs.find((x) => x.typeLicence === t)?.prix ?? 0),
    }));
  }

  /** Grille de prix des licences (FCFA). */
  async tarifs(user: AuthenticatedUser) {
    return this.types(user);
  }

  /** Modifie le prix d'un type de licence : ne vaut que pour les licences générées ensuite. */
  async definirTarif(user: AuthenticatedUser, type: TypeLicence, prix: number) {
    const ctx = await this.assertSuperadmin(user);
    await this.prisma.tarifLicence.upsert({
      where: { typeLicence: type },
      create: { typeLicence: type, prix, updatedBy: ctx.userId },
      update: { prix, updatedBy: ctx.userId },
    });
    return this.types(user);
  }

  /**
   * Historique des licences générées (codes d'activation et activations directes) avec leur prix, filtrable, et cumuls : nombre et
   * montants par statut. « Activées » = licences réalisées ; « en attente » = codes émis encore valables ; « non réalisées » = codes
   * expirés ou annulés.
   */
  async historique(user: AuthenticatedUser, f: HistoriqueFiltres) {
    await this.assertSuperadmin(user);
    await this.prisma.codeActivationLicence.updateMany({ where: { statut: 'EMIS', dateExpiration: { lte: new Date() } }, data: { statut: 'EXPIRE' } });
    const w: Prisma.Sql[] = [Prisma.sql`true`];
    if (f.organisationId) w.push(Prisma.sql`c.organisation_id = ${f.organisationId}::uuid`);
    if (f.typeLicence) w.push(Prisma.sql`c.type_licence = ${f.typeLicence}`);
    if (f.statut) w.push(Prisma.sql`c.statut = ${f.statut}`);
    if (f.mode) w.push(Prisma.sql`c.mode = ${f.mode}`);
    if (f.du) w.push(Prisma.sql`c.date_generation >= ${f.du}::date`);
    if (f.au) w.push(Prisma.sql`c.date_generation < (${f.au}::date + 1)`);
    const where = Prisma.join(w, ' AND ');
    const [lignes, cumul, parType] = await Promise.all([
      this.prisma.$queryRaw<unknown[]>`
        SELECT c.id::text, c.organisation_id::text AS "organisationId", o.nom AS societe, c.type_licence AS "typeLicence", c.mode, c.statut,
               c.prix::float8 AS prix, c.date_generation AS "dateGeneration", c.date_expiration AS "dateExpiration", c.date_activation AS "dateActivation",
               a.role AS "activeParRole"
        FROM codes_activation_licence c
        JOIN organisations o ON o.id = c.organisation_id
        LEFT JOIN profils a ON a.id = c.active_par
        WHERE ${where}
        ORDER BY c.date_generation DESC LIMIT 1000`,
      this.prisma.$queryRaw<unknown[]>`
        SELECT COUNT(*)::int AS "nombre", COALESCE(SUM(c.prix), 0)::float8 AS "total",
               COUNT(*) FILTER (WHERE c.statut = 'ACTIVE')::int AS "nbActivees", COALESCE(SUM(c.prix) FILTER (WHERE c.statut = 'ACTIVE'), 0)::float8 AS "totalActivees",
               COUNT(*) FILTER (WHERE c.statut = 'EMIS')::int AS "nbEnAttente", COALESCE(SUM(c.prix) FILTER (WHERE c.statut = 'EMIS'), 0)::float8 AS "totalEnAttente",
               COUNT(*) FILTER (WHERE c.statut IN ('EXPIRE', 'ANNULE'))::int AS "nbNonRealisees", COALESCE(SUM(c.prix) FILTER (WHERE c.statut IN ('EXPIRE', 'ANNULE')), 0)::float8 AS "totalNonRealisees"
        FROM codes_activation_licence c WHERE ${where}`,
      this.prisma.$queryRaw<unknown[]>`
        SELECT c.type_licence AS "typeLicence", COUNT(*)::int AS "nombre", COALESCE(SUM(c.prix), 0)::float8 AS "total",
               COALESCE(SUM(c.prix) FILTER (WHERE c.statut = 'ACTIVE'), 0)::float8 AS "totalActivees"
        FROM codes_activation_licence c WHERE ${where} GROUP BY 1 ORDER BY 3 DESC`,
    ]);
    return { lignes, cumul: cumul[0], parType, tronque: lignes.length >= 1000 };
  }
}

export interface HistoriqueFiltres {
  du?: string;
  au?: string;
  organisationId?: string;
  typeLicence?: string;
  statut?: string;
  mode?: string;
}
