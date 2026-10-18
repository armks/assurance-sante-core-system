import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { MessagerieHub } from './messagerie.hub';
import { MessagerieStockage } from './messagerie-stockage';
import { aAccesMessagerie, nomFichierSur, peutEcrire, refusFichier, rolesInterlocuteurs, ROLES_ADHERENT_MESSAGERIE, TYPES_FICHIER } from './messagerie-regles';

interface Contexte {
  userId: string;
  organisationId: string;
  role: string;
}

export interface ContactMessagerie {
  id: string;
  nom: string;
  role: string;
  libelleRole: string | null;
  lieu: string | null;
  enLigne: boolean;
}

export interface FichierRecu {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const ACTIFS = Prisma.sql`p.deleted_at IS NULL AND p.statut = 'ACTIF' AND p.desactive_le IS NULL`;
const NOM = Prisma.sql`coalesce(nullif(trim(p.pseudo), ''), nullif(trim(coalesce(a.prenom, '') || ' ' || coalesce(a.nom, '')), ''), split_part(u.email, '@', 1))`;
const JOINTURES = Prisma.sql`
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN sous_roles sr ON sr.code = p.role
  LEFT JOIN adherents a ON a.id = p.adherent_id
  LEFT JOIN etablissements_sante e ON e.id = p.etablissement_id
  LEFT JOIN pharmacies ph ON ph.id = p.pharmacie_id`;

@Injectable()
export class MessagerieService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly hub: MessagerieHub,
    private readonly stockage: MessagerieStockage,
  ) {}

  // ---------------------------------------------------------------- contexte et contacts

  /** Identité de l'appelant ; refuse les profils sans accès à la messagerie. */
  async contexte(user: AuthenticatedUser): Promise<Contexte> {
    const { profil } = await this.identity.getMe(user);
    if (!profil.organisationId || !aAccesMessagerie(profil.role)) {
      throw new ForbiddenException('La messagerie interne n’est pas disponible pour votre profil.');
    }
    return { userId: profil.id, organisationId: profil.organisationId, role: profil.role! };
  }

  /** Profils (nom, rôle, structure) des identifiants donnés. */
  private async contacts(ids: string[]): Promise<Map<string, ContactMessagerie>> {
    if (ids.length === 0) return new Map();
    const lignes = await this.prisma.$queryRaw<{ id: string; role: string; libelle_role: string | null; nom: string | null; lieu: string | null }[]>`
      SELECT p.id::text AS id, p.role AS role, sr.libelle AS libelle_role, ${NOM} AS nom, coalesce(e.nom, ph.nom) AS lieu
      FROM profils p ${JOINTURES}
      WHERE p.id = ANY(${ids}::uuid[])`;
    return new Map(
      lignes.map((l) => [l.id, { id: l.id, nom: l.nom || 'Utilisateur', role: l.role, libelleRole: l.libelle_role, lieu: l.lieu, enLigne: this.hub.enLigne(l.id) }]),
    );
  }

  /** Annuaire : uniquement les comptes actifs de ma société avec lesquels les règles m'autorisent à écrire. */
  async annuaire(user: AuthenticatedUser, q?: string) {
    const ctx = await this.contexte(user);
    const roles = rolesInterlocuteurs(ctx.role);
    const recherche = q && q.length >= 2 ? `%${q.replace(/[%_\\]/g, '\\$&')}%` : null;
    // sans recherche : le personnel seulement (les adhérents, très nombreux, se trouvent par leur nom)
    const rolesListes = recherche ? roles : roles.filter((r) => !ROLES_ADHERENT_MESSAGERIE.includes(r));
    if (rolesListes.length === 0) return [];
    const filtre = recherche
      ? Prisma.sql`AND (${NOM} ILIKE ${recherche} OR coalesce(e.nom, ph.nom, '') ILIKE ${recherche} OR coalesce(sr.libelle, '') ILIKE ${recherche})`
      : Prisma.empty;
    const lignes = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id::text AS id
      FROM profils p ${JOINTURES}
      WHERE p.organisation_id = ${ctx.organisationId}::uuid AND ${ACTIFS}
        AND p.role = ANY(${rolesListes}::text[]) AND p.id <> ${ctx.userId}::uuid ${filtre}
      ORDER BY ${NOM}
      LIMIT 30`;
    const infos = await this.contacts(lignes.map((l) => l.id));
    const paires = await this.prisma.chatConversation.findMany({
      where: { organisationId: ctx.organisationId, OR: [{ userA: ctx.userId }, { userB: ctx.userId }] },
      select: { id: true, statut: true, userA: true, userB: true },
    });
    const parContact = new Map(paires.map((c) => [c.userA === ctx.userId ? c.userB : c.userA, c]));
    return lignes
      .map((l) => infos.get(l.id))
      .filter((c): c is ContactMessagerie => !!c)
      .map((c) => ({ ...c, conversationId: parContact.get(c.id)?.id ?? null, statutConversation: parContact.get(c.id)?.statut ?? null }));
  }

  // ---------------------------------------------------------------- conversations

  async conversations(user: AuthenticatedUser) {
    const ctx = await this.contexte(user);
    const convs = await this.prisma.chatConversation.findMany({
      where: { organisationId: ctx.organisationId, OR: [{ userA: ctx.userId }, { userB: ctx.userId }] },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    });
    if (convs.length === 0) return [];
    const ids = convs.map((c) => c.id);
    const [dernier, nonLus, infos] = await Promise.all([
      this.prisma.$queryRaw<{ conversation_id: string; id: string; contenu: string | null; fichier_nom: string | null; created_at: Date; expediteur_id: string }[]>`
        SELECT DISTINCT ON (conversation_id) conversation_id::text, id::text, contenu, fichier_nom, created_at, expediteur_id::text
        FROM chat_messages WHERE conversation_id = ANY(${ids}::uuid[]) ORDER BY conversation_id, created_at DESC`,
      this.prisma.$queryRaw<{ conversation_id: string; n: number }[]>`
        SELECT conversation_id::text, count(*)::int AS n FROM chat_messages
        WHERE conversation_id = ANY(${ids}::uuid[]) AND expediteur_id <> ${ctx.userId}::uuid AND lu_le IS NULL GROUP BY conversation_id`,
      this.contacts(convs.map((c) => (c.userA === ctx.userId ? c.userB : c.userA))),
    ]);
    const dernierDe = new Map(dernier.map((d) => [d.conversation_id, d]));
    const nonLusDe = new Map(nonLus.map((n) => [n.conversation_id, n.n]));
    return convs.map((c) => {
      const pairId = c.userA === ctx.userId ? c.userB : c.userA;
      const d = dernierDe.get(c.id);
      return {
        id: c.id,
        statut: c.statut,
        initieParMoi: c.initiateur === ctx.userId,
        interlocuteur: infos.get(pairId) ?? { id: pairId, nom: 'Utilisateur', role: '', libelleRole: null, lieu: null, enLigne: false },
        dernierMessage: d ? { apercu: d.contenu ? d.contenu.slice(0, 80) : `📎 ${d.fichier_nom}`, date: d.created_at, deMoi: d.expediteur_id === ctx.userId } : null,
        nonLus: nonLusDe.get(c.id) ?? 0,
        derniereActivite: c.lastMessageAt,
      };
    });
  }

  async messages(user: AuthenticatedUser, conversationId: string, avant?: string) {
    const ctx = await this.contexte(user);
    await this.conversationDe(ctx, conversationId);
    const limite = avant ? new Date(avant) : null;
    if (limite && Number.isNaN(limite.getTime())) throw new BadRequestException('Date invalide.');
    const lignes = await this.prisma.chatMessage.findMany({
      where: { conversationId, ...(limite ? { createdAt: { lt: limite } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return lignes.reverse().map((m) => this.versClient(m));
  }

  /** Premier message : crée l'invitation (ou poursuit une conversation déjà active). */
  async demarrer(user: AuthenticatedUser, destinataireId: string, contenu: string) {
    const ctx = await this.contexte(user);
    if (destinataireId === ctx.userId) throw new BadRequestException('Vous ne pouvez pas vous écrire à vous-même.');
    await this.verifierContact(ctx, destinataireId);
    const [a, b] = [ctx.userId, destinataireId].sort();
    const existante = await this.prisma.chatConversation.findUnique({ where: { userA_userB: { userA: a, userB: b } } });
    if (existante) {
      if (existante.statut === 'ACTIVE') return { conversationId: existante.id, message: await this.ajouterMessage(ctx, existante, { contenu }), invitation: false };
      if (existante.statut === 'REFUSEE') throw new ForbiddenException('Cette invitation a été refusée : vous ne pouvez pas la renvoyer avant le mois prochain.');
      throw new ConflictException(
        existante.initiateur === ctx.userId
          ? 'Votre invitation est déjà envoyée : attendez que votre interlocuteur l’accepte.'
          : 'Cet utilisateur vous a déjà invité : acceptez son invitation pour discuter.',
      );
    }
    const creee = await this.prisma.chatConversation.create({
      data: { organisationId: ctx.organisationId, userA: a, userB: b, initiateur: ctx.userId, statut: 'INVITATION', messages: { create: { expediteurId: ctx.userId, contenu } } },
      include: { messages: true },
    });
    const message = this.versClient(creee.messages[0]);
    this.hub.publier(destinataireId, { type: 'invitation', conversationId: creee.id, message });
    this.hub.publier(ctx.userId, { type: 'message', conversationId: creee.id, message });
    return { conversationId: creee.id, message, invitation: true };
  }

  async accepter(user: AuthenticatedUser, conversationId: string) {
    const ctx = await this.contexte(user);
    const c = await this.conversationDe(ctx, conversationId);
    if (c.initiateur === ctx.userId) throw new ForbiddenException('Seul le destinataire peut accepter l’invitation.');
    if (c.statut !== 'INVITATION') throw new ConflictException('Cette invitation n’est plus en attente.');
    await this.verifierContact(ctx, this.autre(c, ctx.userId));
    await this.prisma.chatConversation.update({ where: { id: c.id }, data: { statut: 'ACTIVE', acceptedAt: new Date() } });
    this.hub.publier(c.initiateur, { type: 'accepte', conversationId: c.id, par: ctx.userId });
    return { ok: true };
  }

  async refuser(user: AuthenticatedUser, conversationId: string) {
    const ctx = await this.contexte(user);
    const c = await this.conversationDe(ctx, conversationId);
    if (c.initiateur === ctx.userId) throw new ForbiddenException('Seul le destinataire peut refuser l’invitation.');
    if (c.statut !== 'INVITATION') throw new ConflictException('Cette invitation n’est plus en attente.');
    await this.prisma.chatConversation.update({ where: { id: c.id }, data: { statut: 'REFUSEE' } });
    this.hub.publier(c.initiateur, { type: 'refuse', conversationId: c.id, par: ctx.userId });
    return { ok: true };
  }

  async envoyer(user: AuthenticatedUser, conversationId: string, contenu: string) {
    const ctx = await this.contexte(user);
    const c = await this.conversationDe(ctx, conversationId);
    await this.verifierContact(ctx, this.autre(c, ctx.userId));
    return this.ajouterMessage(ctx, c, { contenu });
  }

  async envoyerFichier(user: AuthenticatedUser, conversationId: string, fichier: FichierRecu | undefined, legende?: string) {
    const ctx = await this.contexte(user);
    if (!fichier) throw new BadRequestException('Aucun fichier reçu (champ « fichier »).');
    const c = await this.conversationDe(ctx, conversationId);
    await this.verifierContact(ctx, this.autre(c, ctx.userId));
    const nom = nomFichierSur(fichier.originalname);
    const motif = refusFichier({ nom, type: fichier.mimetype, taille: fichier.size, debut: fichier.buffer.subarray(0, 8) });
    if (motif) throw new BadRequestException(motif);
    const ext = TYPES_FICHIER[fichier.mimetype].extensions[0];
    const chemin = `${c.id}/${randomUUID()}.${ext}`;
    // l'état de la conversation est vérifié AVANT de stocker (pas de fichier orphelin pour une conversation non active)
    if (c.statut !== 'ACTIVE') throw new ConflictException(this.motifInactive(c.statut));
    await this.stockage.televerser(chemin, fichier.buffer, fichier.mimetype);
    try {
      return await this.ajouterMessage(ctx, c, { contenu: legende || null, fichier: { chemin, nom, type: fichier.mimetype, taille: fichier.size } });
    } catch (err) {
      await this.stockage.supprimer([chemin]).catch(() => undefined);
      throw err;
    }
  }

  async telechargerFichier(user: AuthenticatedUser, conversationId: string, messageId: string) {
    const ctx = await this.contexte(user);
    await this.conversationDe(ctx, conversationId);
    const m = await this.prisma.chatMessage.findFirst({ where: { id: messageId, conversationId, fichierChemin: { not: null } } });
    if (!m?.fichierChemin) throw new NotFoundException('Fichier introuvable.');
    return { buffer: await this.stockage.telecharger(m.fichierChemin), nom: m.fichierNom ?? 'fichier', type: m.fichierType ?? 'application/octet-stream' };
  }

  async marquerLu(user: AuthenticatedUser, conversationId: string) {
    const ctx = await this.contexte(user);
    const c = await this.conversationDe(ctx, conversationId);
    const r = await this.prisma.chatMessage.updateMany({ where: { conversationId, expediteurId: { not: ctx.userId }, luLe: null }, data: { luLe: new Date() } });
    if (r.count > 0) this.hub.publier(this.autre(c, ctx.userId), { type: 'lu', conversationId, par: ctx.userId });
    return { lus: r.count };
  }

  /** Indicateur « est en train d'écrire » : transmis sans être stocké. */
  async saisie(user: AuthenticatedUser, conversationId: string) {
    const ctx = await this.contexte(user);
    const c = await this.conversationDe(ctx, conversationId);
    if (c.statut === 'ACTIVE') this.hub.publier(this.autre(c, ctx.userId), { type: 'saisie', conversationId, par: ctx.userId });
    return { ok: true };
  }

  /** Abonnement au flux temps réel de l'appelant. */
  async flux(user: AuthenticatedUser) {
    const ctx = await this.contexte(user);
    return this.hub.abonner(ctx.userId);
  }

  // ---------------------------------------------------------------- interne

  private autre(c: { userA: string; userB: string }, moi: string): string {
    return c.userA === moi ? c.userB : c.userA;
  }

  private motifInactive(statut: string): string {
    return statut === 'REFUSEE' ? 'L’invitation a été refusée : la conversation est fermée.' : 'En attente de l’acceptation de votre invitation : vous ne pouvez pas encore écrire.';
  }

  /** Conversation dont l'appelant est l'un des deux participants (404 sinon : on ne révèle pas l'existence des autres). */
  private async conversationDe(ctx: Contexte, id: string) {
    const c = await this.prisma.chatConversation.findFirst({ where: { id, organisationId: ctx.organisationId, OR: [{ userA: ctx.userId }, { userB: ctx.userId }] } });
    if (!c) throw new NotFoundException('Conversation introuvable.');
    return c;
  }

  /** L'interlocuteur est-il toujours actif, dans ma société, et les règles m'autorisent-elles encore à lui écrire ? */
  private async verifierContact(ctx: Contexte, autreId: string): Promise<void> {
    const [p] = await this.prisma.$queryRaw<{ role: string | null }[]>`
      SELECT p.role FROM profils p WHERE p.id = ${autreId}::uuid AND p.organisation_id = ${ctx.organisationId}::uuid AND ${ACTIFS}`;
    if (!p) throw new ForbiddenException('Cet utilisateur n’est pas joignable.');
    if (!peutEcrire(ctx.role, p.role)) throw new ForbiddenException('Vous n’êtes pas autorisé à échanger avec ce profil.');
  }

  private async ajouterMessage(
    ctx: Contexte,
    c: { id: string; statut: string; userA: string; userB: string },
    m: { contenu: string | null; fichier?: { chemin: string; nom: string; type: string; taille: number } },
  ) {
    if (c.statut !== 'ACTIVE') throw new ConflictException(this.motifInactive(c.statut));
    const cree = await this.prisma.$transaction(async (tx) => {
      const msg = await tx.chatMessage.create({
        data: {
          conversationId: c.id,
          expediteurId: ctx.userId,
          contenu: m.contenu,
          ...(m.fichier ? { fichierChemin: m.fichier.chemin, fichierNom: m.fichier.nom, fichierType: m.fichier.type, fichierTaille: m.fichier.taille } : {}),
        },
      });
      await tx.chatConversation.update({ where: { id: c.id }, data: { lastMessageAt: msg.createdAt } });
      return msg;
    });
    const message = this.versClient(cree);
    for (const id of [ctx.userId, this.autre(c, ctx.userId)]) this.hub.publier(id, { type: 'message', conversationId: c.id, message });
    return message;
  }

  private versClient(m: {
    id: string;
    conversationId: string;
    expediteurId: string;
    contenu: string | null;
    fichierNom: string | null;
    fichierType: string | null;
    fichierTaille: number | null;
    createdAt: Date;
    luLe: Date | null;
  }) {
    return {
      id: m.id,
      conversationId: m.conversationId,
      expediteurId: m.expediteurId,
      contenu: m.contenu,
      fichier: m.fichierNom ? { nom: m.fichierNom, type: m.fichierType, taille: m.fichierTaille } : null,
      createdAt: m.createdAt,
      luLe: m.luLe,
    };
  }
}
