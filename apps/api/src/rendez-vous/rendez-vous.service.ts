import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { ajouterJours, creneauxLibres, jourDe, lienGoogleAgenda, type Creneau, type RegleAgenda } from './agenda';
import type { ModifierRendezVousDto, ProposerRendezVousDto, RegleAgendaDto } from './rendez-vous.dto';

/** Propose un rendez-vous pour un patient : la secrétaire de l'assurance et l'exploitation (titulaire et conjointe). */
export const ROLES_PROPOSER_RDV = ['ASSUREUR_SECRETAIRE', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_EXPLOITATION_CONJOINTE'] as const;
/** Règle l'agenda de présence et traite les propositions : l'accueil de l'établissement et ses médecins. */
export const ROLES_ETABLISSEMENT_RDV = ['CENTRE_MEDICAL_ACCUEIL', 'CENTRE_MEDICAL_MEDECIN'] as const;
const ROLES_ADHERENT = ['ADHERENT_TITULAIRE', 'SOUSCRIPTEUR_INDIVIDUEL'] as const;
const ROLE_MEDECIN = 'CENTRE_MEDICAL_MEDECIN';
const ROLE_ACCUEIL = 'CENTRE_MEDICAL_ACCUEIL';
const MAX_JOURS = 31;

interface Contexte {
  userId: string;
  organisationId: string;
  role: string;
  etablissementId: string | null;
  adherentId: string | null;
}

const ACTIFS = Prisma.sql`p.deleted_at IS NULL AND p.statut = 'ACTIF' AND p.desactive_le IS NULL`;
const NOM = Prisma.sql`coalesce(nullif(trim(p.pseudo), ''), split_part(u.email, '@', 1))`;

type LigneRegle = {
  id: string;
  medecin_id: string;
  type: 'DATE' | 'JOUR' | 'ABSENCE';
  date_jour: string | null;
  jour_semaine: number | null;
  valide_du: string | null;
  valide_au: string | null;
  heure_debut: string;
  heure_fin: string;
  duree_creneau_min: number | null;
};

const versRegle = (l: LigneRegle): RegleAgenda => ({
  type: l.type,
  dateJour: l.date_jour,
  jourSemaine: l.jour_semaine,
  valideDu: l.valide_du,
  valideAu: l.valide_au,
  heureDebut: l.heure_debut,
  heureFin: l.heure_fin,
  dureeCreneauMin: l.duree_creneau_min,
});

@Injectable()
export class RendezVousService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  // ---------------------------------------------------------------- contexte

  private async contexte(user: AuthenticatedUser, roles: readonly string[], message: string): Promise<Contexte> {
    const { profil } = await this.identity.getMe(user);
    if (!profil.organisationId || !profil.role || !roles.includes(profil.role)) throw new ForbiddenException(message);
    return { userId: profil.id, organisationId: profil.organisationId, role: profil.role, etablissementId: profil.etablissementId, adherentId: profil.adherentId };
  }

  private etab(ctx: Contexte): string {
    if (!ctx.etablissementId) throw new ForbiddenException('Votre compte n’est rattaché à aucun établissement.');
    return ctx.etablissementId;
  }

  private ctxEtablissement = (user: AuthenticatedUser) =>
    this.contexte(user, ROLES_ETABLISSEMENT_RDV, 'Réservé à l’accueil et aux médecins de l’établissement.');
  private ctxProposeur = (user: AuthenticatedUser) =>
    this.contexte(user, ROLES_PROPOSER_RDV, 'Réservé à la secrétaire de l’assurance et à l’exploitation.');

  // ---------------------------------------------------------------- agenda de présence

  /** Médecins actifs d'un établissement de la société. */
  private async medecinsDe(organisationId: string, etablissementId: string): Promise<{ id: string; nom: string }[]> {
    return this.prisma.$queryRaw<{ id: string; nom: string }[]>`
      SELECT p.id::text AS id, ${NOM} AS nom FROM profils p LEFT JOIN auth.users u ON u.id = p.id
      WHERE p.organisation_id = ${organisationId}::uuid AND p.etablissement_id = ${etablissementId}::uuid AND p.role = ${ROLE_MEDECIN} AND ${ACTIFS}
      ORDER BY ${NOM}`;
  }

  /** Médecins de l'établissement de l'appelant (accueil, médecin) ou d'un établissement choisi (assurance). */
  async medecins(user: AuthenticatedUser, etablissementId?: string) {
    const { profil } = await this.identity.getMe(user);
    const role = profil.role ?? '';
    if (!profil.organisationId) throw new ForbiddenException('Ce compte n’est rattaché à aucune organisation.');
    if ((ROLES_ETABLISSEMENT_RDV as readonly string[]).includes(role)) {
      if (!profil.etablissementId) throw new ForbiddenException('Votre compte n’est rattaché à aucun établissement.');
      const tous = await this.medecinsDe(profil.organisationId, profil.etablissementId);
      return role === ROLE_MEDECIN ? tous.filter((m) => m.id === profil.id) : tous;
    }
    if ((ROLES_PROPOSER_RDV as readonly string[]).includes(role)) {
      if (!etablissementId) throw new BadRequestException('Choisissez d’abord un établissement.');
      return this.medecinsDe(profil.organisationId, etablissementId);
    }
    throw new ForbiddenException('Accès refusé.');
  }

  async agenda(user: AuthenticatedUser, medecinId?: string) {
    const ctx = await this.ctxEtablissement(user);
    const cible = ctx.role === ROLE_MEDECIN ? ctx.userId : medecinId;
    const lignes = await this.prisma.$queryRaw<(LigneRegle & { nom: string })[]>`
      SELECT d.id::text AS id, d.medecin_id::text AS medecin_id, d.type, to_char(d.date_jour, 'YYYY-MM-DD') AS date_jour, d.jour_semaine::int AS jour_semaine,
             to_char(d.valide_du, 'YYYY-MM-DD') AS valide_du, to_char(d.valide_au, 'YYYY-MM-DD') AS valide_au,
             to_char(d.heure_debut, 'HH24:MI') AS heure_debut, to_char(d.heure_fin, 'HH24:MI') AS heure_fin, d.duree_creneau_min::int AS duree_creneau_min, ${NOM} AS nom
      FROM disponibilites_medecin d JOIN profils p ON p.id = d.medecin_id LEFT JOIN auth.users u ON u.id = p.id
      WHERE d.organisation_id = ${ctx.organisationId}::uuid AND d.etablissement_id = ${this.etab(ctx)}::uuid
        ${cible ? Prisma.sql`AND d.medecin_id = ${cible}::uuid` : Prisma.empty}
      ORDER BY ${NOM}, d.type, d.jour_semaine NULLS LAST, d.date_jour NULLS LAST, d.heure_debut`;
    return lignes.map((l) => ({
      id: l.id,
      medecinId: l.medecin_id,
      medecin: l.nom,
      type: l.type,
      date: l.date_jour,
      jourSemaine: l.jour_semaine,
      valideDu: l.valide_du,
      valideAu: l.valide_au,
      heureDebut: l.heure_debut,
      heureFin: l.heure_fin,
      dureeCreneauMin: l.duree_creneau_min,
    }));
  }

  async ajouterRegle(user: AuthenticatedUser, dto: RegleAgendaDto) {
    const ctx = await this.ctxEtablissement(user);
    const etablissementId = this.etab(ctx);
    const medecinId = ctx.role === ROLE_MEDECIN ? ctx.userId : dto.medecinId;
    if (!medecinId) throw new BadRequestException('Choisissez le médecin concerné.');
    if (ctx.role === ROLE_MEDECIN && dto.medecinId && dto.medecinId !== ctx.userId) throw new ForbiddenException('Un médecin ne règle que son propre agenda.');
    if (!(await this.medecinsDe(ctx.organisationId, etablissementId)).some((m) => m.id === medecinId)) {
      throw new NotFoundException('Médecin introuvable dans votre établissement.');
    }
    if (dto.heureFin <= dto.heureDebut) throw new BadRequestException('L’heure de fin doit être postérieure à l’heure de début.');
    if (dto.type === 'JOUR' && !dto.jourSemaine) throw new BadRequestException('Choisissez le jour de la semaine.');
    if (dto.type !== 'JOUR' && !dto.date) throw new BadRequestException('Choisissez la date.');
    if (dto.type !== 'ABSENCE') {
      if (!dto.dureeCreneauMin) throw new BadRequestException('Indiquez l’intervalle entre deux rendez-vous (en minutes).');
      const minutes = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
      if (minutes(dto.heureFin) - minutes(dto.heureDebut) < dto.dureeCreneauMin) throw new BadRequestException('La plage horaire est plus courte qu’un créneau.');
    }
    if (dto.valideDu && dto.valideAu && dto.valideAu < dto.valideDu) throw new BadRequestException('La fin de validité précède son début.');
    const [{ id }] = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO disponibilites_medecin (organisation_id, etablissement_id, medecin_id, type, date_jour, jour_semaine, valide_du, valide_au, heure_debut, heure_fin, duree_creneau_min, cree_par)
      VALUES (${ctx.organisationId}::uuid, ${etablissementId}::uuid, ${medecinId}::uuid, ${dto.type},
              ${dto.type === 'JOUR' ? null : dto.date ?? null}::date, ${dto.type === 'JOUR' ? dto.jourSemaine ?? null : null}::smallint,
              ${dto.type === 'JOUR' ? dto.valideDu ?? null : null}::date, ${dto.type === 'JOUR' ? dto.valideAu ?? null : null}::date,
              ${dto.heureDebut}::time, ${dto.heureFin}::time, ${dto.type === 'ABSENCE' ? null : dto.dureeCreneauMin ?? null}::smallint, ${ctx.userId}::uuid)
      RETURNING id::text AS id`;
    await this.audit(ctx.userId, 'AGENDA_REGLE_AJOUTEE', id, { medecinId, type: dto.type });
    return { id };
  }

  async supprimerRegle(user: AuthenticatedUser, id: string) {
    const ctx = await this.ctxEtablissement(user);
    const [r] = await this.prisma.$queryRaw<{ id: string; medecin_id: string }[]>`
      SELECT id::text AS id, medecin_id::text AS medecin_id FROM disponibilites_medecin
      WHERE id = ${id}::uuid AND organisation_id = ${ctx.organisationId}::uuid AND etablissement_id = ${this.etab(ctx)}::uuid`;
    if (!r || (ctx.role === ROLE_MEDECIN && r.medecin_id !== ctx.userId)) throw new NotFoundException('Règle introuvable.');
    await this.prisma.$executeRaw`DELETE FROM disponibilites_medecin WHERE id = ${id}::uuid`;
    await this.audit(ctx.userId, 'AGENDA_REGLE_SUPPRIMEE', id, { medecinId: r.medecin_id });
    return { ok: true };
  }

  // ---------------------------------------------------------------- créneaux

  /** Créneaux libres d'un médecin entre deux dates : assurance (tout établissement de la société) ou établissement du médecin. */
  async creneaux(user: AuthenticatedUser, medecinId: string, du: string, au: string, sauf?: string) {
    const { profil } = await this.identity.getMe(user);
    const role = profil.role ?? '';
    if (!profil.organisationId) throw new ForbiddenException('Ce compte n’est rattaché à aucune organisation.');
    const proposeur = (ROLES_PROPOSER_RDV as readonly string[]).includes(role);
    const etab = (ROLES_ETABLISSEMENT_RDV as readonly string[]).includes(role);
    if (!proposeur && !etab) throw new ForbiddenException('Accès refusé.');
    if (au < du) throw new BadRequestException('La date de fin précède la date de début.');
    if ((Date.parse(au) - Date.parse(du)) / 86_400_000 > MAX_JOURS) throw new BadRequestException(`Plage limitée à ${MAX_JOURS} jours.`);
    const [m] = await this.prisma.$queryRaw<{ etablissement_id: string }[]>`
      SELECT p.etablissement_id::text AS etablissement_id FROM profils p
      WHERE p.id = ${medecinId}::uuid AND p.organisation_id = ${profil.organisationId}::uuid AND p.role = ${ROLE_MEDECIN} AND ${ACTIFS}`;
    if (!m || (etab && m.etablissement_id !== profil.etablissementId) || (etab && role === ROLE_MEDECIN && medecinId !== profil.id)) {
      throw new NotFoundException('Médecin introuvable.');
    }
    return this.creneauxLibresDe(medecinId, du, au, sauf);
  }

  private async creneauxLibresDe(medecinId: string, du: string, au: string, sauf?: string) {
    const [lignes, pris] = await Promise.all([
      this.prisma.$queryRaw<LigneRegle[]>`
        SELECT id::text AS id, medecin_id::text AS medecin_id, type, to_char(date_jour, 'YYYY-MM-DD') AS date_jour, jour_semaine::int AS jour_semaine,
               to_char(valide_du, 'YYYY-MM-DD') AS valide_du, to_char(valide_au, 'YYYY-MM-DD') AS valide_au,
               to_char(heure_debut, 'HH24:MI') AS heure_debut, to_char(heure_fin, 'HH24:MI') AS heure_fin, duree_creneau_min::int AS duree_creneau_min
        FROM disponibilites_medecin WHERE medecin_id = ${medecinId}::uuid`,
      this.prisma.rendezVous.findMany({
        where: {
          medecinId,
          statut: { in: ['PROPOSE', 'CONFIRME'] },
          dateDebut: { lt: new Date(`${ajouterJours(au, 1)}T00:00:00.000Z`) },
          dateFin: { gt: new Date(`${du}T00:00:00.000Z`) },
          ...(sauf ? { id: { not: sauf } } : {}),
        },
        select: { dateDebut: true, dateFin: true },
      }),
    ]);
    const libres = creneauxLibres(du, au, lignes.map(versRegle), pris.map((p) => ({ debut: p.dateDebut, fin: p.dateFin })), new Date());
    return libres.map((j) => ({ date: j.date, creneaux: j.creneaux.map((c) => ({ debut: c.debut.toISOString(), fin: c.fin.toISOString() })) }));
  }

  /** Le créneau demandé est-il bien un créneau libre de l'agenda du médecin ? Renvoie sa fin. */
  private async verifierCreneau(medecinId: string, debut: Date, sauf?: string): Promise<Creneau> {
    const jour = jourDe(debut);
    const jours = await this.creneauxLibresDe(medecinId, jour, jour, sauf);
    const c = jours[0]?.creneaux.find((x) => new Date(x.debut).getTime() === debut.getTime());
    if (!c) throw new ConflictException('Ce créneau n’est pas (ou plus) disponible dans l’agenda du médecin.');
    return { debut, fin: new Date(c.fin) };
  }

  // ---------------------------------------------------------------- recherches de l'assurance

  async etablissements(user: AuthenticatedUser, q?: string) {
    const ctx = await this.ctxProposeur(user);
    const motif = q && q.length >= 2 ? `%${q.replace(/[%_\\]/g, '\\$&')}%` : null;
    return this.prisma.$queryRaw<{ id: string; nom: string; ville: string | null; commune: string | null }[]>`
      SELECT id::text AS id, nom, ville, commune FROM etablissements_sante
      WHERE organisation_id = ${ctx.organisationId}::uuid AND deleted_at IS NULL AND statut = 'ACTIF'
        ${motif ? Prisma.sql`AND (nom ILIKE ${motif} OR coalesce(ville, '') ILIKE ${motif} OR coalesce(commune, '') ILIKE ${motif})` : Prisma.empty}
      ORDER BY nom LIMIT 40`;
  }

  /** Recherche d'un patient (adhérent ou bénéficiaire) par nom, prénom ou numéro de carte. */
  async patients(user: AuthenticatedUser, q?: string) {
    const ctx = await this.ctxProposeur(user);
    if (!q || q.length < 2) return [];
    const motif = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    const lignes = await this.prisma.$queryRaw<{ adherent_id: string; beneficiaire_id: string | null; nom: string; numero_carte: string | null; lien: string }[]>`
      SELECT a.id::text AS adherent_id, NULL::text AS beneficiaire_id, trim(a.prenom || ' ' || a.nom) AS nom, a.numero_carte, 'TITULAIRE' AS lien
      FROM adherents a WHERE a.organisation_id = ${ctx.organisationId}::uuid AND a.statut IN ('ACTIF', 'PROPOSE_SORTANT')
        AND (a.nom ILIKE ${motif} OR a.prenom ILIKE ${motif} OR coalesce(a.numero_carte, '') ILIKE ${motif} OR (a.prenom || ' ' || a.nom) ILIKE ${motif})
      UNION ALL
      SELECT b.adherent_id::text, b.id::text, trim(b.prenom || ' ' || b.nom), b.numero_carte, b.lien_parente
      FROM beneficiaires b JOIN adherents a ON a.id = b.adherent_id
      WHERE b.organisation_id = ${ctx.organisationId}::uuid AND b.deleted_at IS NULL AND b.statut = 'ACTIF' AND a.statut IN ('ACTIF', 'PROPOSE_SORTANT')
        AND (b.nom ILIKE ${motif} OR b.prenom ILIKE ${motif} OR coalesce(b.numero_carte, '') ILIKE ${motif} OR (b.prenom || ' ' || b.nom) ILIKE ${motif})
      ORDER BY 3 LIMIT 20`;
    return lignes.map((l) => ({ adherentId: l.adherent_id, beneficiaireId: l.beneficiaire_id, nom: l.nom, numeroCarte: l.numero_carte, lien: l.lien }));
  }

  // ---------------------------------------------------------------- rendez-vous

  async proposer(user: AuthenticatedUser, dto: ProposerRendezVousDto) {
    const ctx = await this.ctxProposeur(user);
    const debut = new Date(dto.debut);
    if (Number.isNaN(debut.getTime())) throw new BadRequestException('Date invalide.');
    const [m] = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id::text AS id FROM profils p WHERE p.id = ${dto.medecinId}::uuid AND p.organisation_id = ${ctx.organisationId}::uuid
        AND p.etablissement_id = ${dto.etablissementId}::uuid AND p.role = ${ROLE_MEDECIN} AND ${ACTIFS}`;
    if (!m) throw new NotFoundException('Médecin introuvable dans cet établissement.');
    const [e] = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM etablissements_sante WHERE id = ${dto.etablissementId}::uuid AND organisation_id = ${ctx.organisationId}::uuid AND deleted_at IS NULL AND statut = 'ACTIF'`;
    if (!e) throw new NotFoundException('Établissement introuvable ou inactif.');
    const adherent = await this.prisma.adherent.findFirst({ where: { id: dto.adherentId, organisationId: ctx.organisationId, statut: { in: ['ACTIF', 'PROPOSE_SORTANT'] } }, select: { id: true } });
    if (!adherent) throw new NotFoundException('Adhérent introuvable.');
    if (dto.beneficiaireId) {
      const b = await this.prisma.beneficiaire.findFirst({ where: { id: dto.beneficiaireId, adherentId: dto.adherentId, deletedAt: null, statut: 'ACTIF' }, select: { id: true } });
      if (!b) throw new NotFoundException('Bénéficiaire introuvable pour cet adhérent.');
    }
    const creneau = await this.verifierCreneau(dto.medecinId, debut);
    const cree = await this.creer({
      organisationId: ctx.organisationId,
      etablissementId: dto.etablissementId,
      medecinId: dto.medecinId,
      adherentId: dto.adherentId,
      beneficiaireId: dto.beneficiaireId ?? null,
      dateDebut: creneau.debut,
      dateFin: creneau.fin,
      motif: dto.motif || null,
      proposePar: ctx.userId,
    });
    await this.audit(ctx.userId, 'RDV_PROPOSE', cree.id, { etablissementId: dto.etablissementId, medecinId: dto.medecinId, debut: dto.debut });
    return (await this.detaille(ctx, [cree.id]))[0];
  }

  private async creer(data: Prisma.RendezVousUncheckedCreateInput) {
    try {
      return await this.prisma.rendezVous.create({ data });
    } catch (err) {
      if (this.estChevauchement(err)) throw new ConflictException('Ce créneau vient d’être pris : choisissez-en un autre.');
      throw err;
    }
  }

  private estChevauchement(err: unknown): boolean {
    const texte = err instanceof Error ? err.message : String(err);
    return texte.includes('rendez_vous_pas_de_chevauchement') || /23P01/.test(texte);
  }

  /** Liste adaptée au profil : assurance (tous les rendez-vous de la société), accueil (établissement), médecin (les siens), adhérent (les siens). */
  async lister(user: AuthenticatedUser, statut?: string) {
    const { profil } = await this.identity.getMe(user);
    const role = profil.role ?? '';
    if (!profil.organisationId) throw new ForbiddenException('Ce compte n’est rattaché à aucune organisation.');
    const ctx: Contexte = { userId: profil.id, organisationId: profil.organisationId, role, etablissementId: profil.etablissementId, adherentId: profil.adherentId };
    const filtre: Prisma.RendezVousWhereInput = { organisationId: ctx.organisationId, ...(statut ? { statut } : {}) };
    if ((ROLES_PROPOSER_RDV as readonly string[]).includes(role)) {
      // toute la société
    } else if ((ROLES_ETABLISSEMENT_RDV as readonly string[]).includes(role)) {
      filtre.etablissementId = this.etab(ctx);
      if (role === ROLE_MEDECIN) filtre.medecinId = ctx.userId;
    } else if ((ROLES_ADHERENT as readonly string[]).includes(role) && ctx.adherentId) {
      filtre.adherentId = ctx.adherentId;
      filtre.statut = statut ?? { in: ['PROPOSE', 'CONFIRME', 'ANNULE'] };
    } else {
      throw new ForbiddenException('Accès refusé.');
    }
    const depuis = new Date(Date.now() - 30 * 86_400_000);
    const rdv = await this.prisma.rendezVous.findMany({ where: { ...filtre, dateDebut: { gte: depuis } }, orderBy: { dateDebut: 'asc' }, take: 300, select: { id: true } });
    return this.detaille(ctx, rdv.map((r) => r.id));
  }

  async confirmer(user: AuthenticatedUser, id: string) {
    const ctx = await this.ctxEtablissement(user);
    const r = await this.traitable(ctx, id);
    if (r.statut !== 'PROPOSE') throw new ConflictException('Seule une proposition en attente peut être confirmée.');
    await this.prisma.rendezVous.update({ where: { id }, data: { statut: 'CONFIRME', traitePar: ctx.userId, traiteLe: new Date() } });
    await this.audit(ctx.userId, 'RDV_CONFIRME', id, null);
    return (await this.detaille(ctx, [id]))[0];
  }

  async refuser(user: AuthenticatedUser, id: string, motif: string) {
    const ctx = await this.ctxEtablissement(user);
    const r = await this.traitable(ctx, id);
    if (r.statut !== 'PROPOSE') throw new ConflictException('Seule une proposition en attente peut être refusée.');
    await this.prisma.rendezVous.update({ where: { id }, data: { statut: 'REFUSE', traitePar: ctx.userId, traiteLe: new Date(), motifRefus: motif } });
    await this.audit(ctx.userId, 'RDV_REFUSE', id, { motif });
    return (await this.detaille(ctx, [id]))[0];
  }

  /** Modifie la date / l'heure (et, pour l'accueil, le médecin) : le rendez-vous est alors confirmé au nouveau créneau. */
  async modifier(user: AuthenticatedUser, id: string, dto: ModifierRendezVousDto) {
    const ctx = await this.ctxEtablissement(user);
    const r = await this.traitable(ctx, id);
    if (!['PROPOSE', 'CONFIRME'].includes(r.statut)) throw new ConflictException('Ce rendez-vous ne peut plus être modifié.');
    const debut = new Date(dto.debut);
    if (Number.isNaN(debut.getTime())) throw new BadRequestException('Date invalide.');
    const medecinId = dto.medecinId ?? r.medecinId;
    if (medecinId !== r.medecinId) {
      if (ctx.role !== ROLE_ACCUEIL) throw new ForbiddenException('Seul l’accueil peut changer de médecin.');
      if (!(await this.medecinsDe(ctx.organisationId, r.etablissementId)).some((m) => m.id === medecinId)) throw new NotFoundException('Médecin introuvable dans cet établissement.');
    }
    const creneau = await this.verifierCreneau(medecinId, debut, id);
    try {
      await this.prisma.rendezVous.update({
        where: { id },
        data: { medecinId, dateDebut: creneau.debut, dateFin: creneau.fin, statut: 'CONFIRME', modifie: true, ancienneDateDebut: r.ancienneDateDebut ?? r.dateDebut, traitePar: ctx.userId, traiteLe: new Date() },
      });
    } catch (err) {
      if (this.estChevauchement(err)) throw new ConflictException('Ce créneau vient d’être pris : choisissez-en un autre.');
      throw err;
    }
    await this.audit(ctx.userId, 'RDV_MODIFIE', id, { de: r.dateDebut.toISOString(), vers: creneau.debut.toISOString(), medecinId });
    return (await this.detaille(ctx, [id]))[0];
  }

  /** Annulation : par l'assurance (secrétaire, exploitation) ou par l'établissement qui traite le rendez-vous. */
  async annuler(user: AuthenticatedUser, id: string, motif: string) {
    const { profil } = await this.identity.getMe(user);
    const role = profil.role ?? '';
    if (!profil.organisationId) throw new ForbiddenException('Ce compte n’est rattaché à aucune organisation.');
    const ctx: Contexte = { userId: profil.id, organisationId: profil.organisationId, role, etablissementId: profil.etablissementId, adherentId: profil.adherentId };
    let r;
    if ((ROLES_PROPOSER_RDV as readonly string[]).includes(role)) {
      r = await this.prisma.rendezVous.findFirst({ where: { id, organisationId: ctx.organisationId } });
      if (!r) throw new NotFoundException('Rendez-vous introuvable.');
    } else if ((ROLES_ETABLISSEMENT_RDV as readonly string[]).includes(role)) {
      r = await this.traitable(ctx, id);
    } else {
      throw new ForbiddenException('Accès refusé.');
    }
    if (!['PROPOSE', 'CONFIRME'].includes(r.statut)) throw new ConflictException('Ce rendez-vous ne peut plus être annulé.');
    await this.prisma.rendezVous.update({ where: { id }, data: { statut: 'ANNULE', traitePar: ctx.userId, traiteLe: new Date(), motifRefus: motif } });
    await this.audit(ctx.userId, 'RDV_ANNULE', id, { motif });
    return (await this.detaille(ctx, [id]))[0];
  }

  /** Rendez-vous que l'appelant (accueil de l'établissement, médecin concerné) a le droit de traiter. */
  private async traitable(ctx: Contexte, id: string) {
    const r = await this.prisma.rendezVous.findFirst({ where: { id, organisationId: ctx.organisationId, etablissementId: this.etab(ctx) } });
    if (!r || (ctx.role === ROLE_MEDECIN && r.medecinId !== ctx.userId)) throw new NotFoundException('Rendez-vous introuvable.');
    return r;
  }

  // ---------------------------------------------------------------- présentation

  private async detaille(ctx: Contexte, ids: string[]) {
    if (ids.length === 0) return [];
    const [rdv, etabs, pros] = await Promise.all([
      this.prisma.rendezVous.findMany({ where: { id: { in: ids }, organisationId: ctx.organisationId }, orderBy: { dateDebut: 'asc' } }),
      this.prisma.etablissementSante.findMany({
        where: { organisationId: ctx.organisationId },
        select: { id: true, nom: true, adresseComplete: true, quartier: true, commune: true, ville: true, telephone: true },
      }),
      this.prisma.$queryRaw<{ id: string; nom: string }[]>`
        SELECT p.id::text AS id, ${NOM} AS nom FROM profils p LEFT JOIN auth.users u ON u.id = p.id WHERE p.organisation_id = ${ctx.organisationId}::uuid AND p.role IN ('CENTRE_MEDICAL_MEDECIN', 'ASSUREUR_SECRETAIRE', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_EXPLOITATION_CONJOINTE')`,
    ]);
    const adherents = await this.prisma.adherent.findMany({ where: { id: { in: [...new Set(rdv.map((r) => r.adherentId))] } }, select: { id: true, nom: true, prenom: true, numeroCarte: true } });
    const benefs = await this.prisma.beneficiaire.findMany({
      where: { id: { in: rdv.flatMap((r) => (r.beneficiaireId ? [r.beneficiaireId] : [])) } },
      select: { id: true, nom: true, prenom: true, numeroCarte: true, lienParente: true },
    });
    const nomPro = new Map(pros.map((p) => [p.id, p.nom]));
    const etabDe = new Map(etabs.map((e) => [e.id, e]));
    const adhDe = new Map(adherents.map((a) => [a.id, a]));
    const benDe = new Map(benefs.map((b) => [b.id, b]));
    return rdv.map((r) => {
      const e = etabDe.get(r.etablissementId);
      const adresse = e ? [e.adresseComplete ?? [e.quartier, e.commune].filter(Boolean).join(', '), e.ville].filter(Boolean).join(', ') : '';
      const b = r.beneficiaireId ? benDe.get(r.beneficiaireId) : null;
      const a = adhDe.get(r.adherentId);
      const patient = b
        ? { nom: `${b.prenom} ${b.nom}`, numeroCarte: b.numeroCarte, lien: b.lienParente }
        : { nom: `${a?.prenom ?? ''} ${a?.nom ?? ''}`.trim() || '—', numeroCarte: a?.numeroCarte ?? null, lien: 'TITULAIRE' };
      const medecin = nomPro.get(r.medecinId) ?? 'Médecin';
      return {
        id: r.id,
        statut: r.statut,
        dateDebut: r.dateDebut.toISOString(),
        dateFin: r.dateFin.toISOString(),
        motif: r.motif,
        modifie: r.modifie,
        ancienneDateDebut: r.ancienneDateDebut?.toISOString() ?? null,
        motifRefus: r.motifRefus,
        patient,
        etablissement: { id: r.etablissementId, nom: e?.nom ?? '—', adresse: adresse || null, telephone: e?.telephone ?? null },
        medecin: { id: r.medecinId, nom: medecin },
        proposePar: r.proposePar ? (nomPro.get(r.proposePar) ?? null) : null,
        lienGoogleAgenda:
          r.statut === 'CONFIRME'
            ? lienGoogleAgenda({
                titre: `Rendez-vous médical — ${e?.nom ?? 'établissement de santé'}`,
                debut: r.dateDebut,
                fin: r.dateFin,
                details: `Médecin : ${medecin}.${r.motif ? ` Motif : ${r.motif}.` : ''} Patient : ${patient.nom}.`,
                lieu: [e?.nom, adresse].filter(Boolean).join(', ') || undefined,
              })
            : null,
      };
    });
  }

  private async audit(userId: string, action: string, enregistrementId: string, details: Prisma.InputJsonValue | null): Promise<void> {
    await this.prisma.$executeRaw`
      SELECT log_audit(${action}::text, ${'rendez_vous'}::text, ${enregistrementId}::uuid, ${userId}::uuid, ${details === null ? null : JSON.stringify(details)}::jsonb)`;
  }
}
