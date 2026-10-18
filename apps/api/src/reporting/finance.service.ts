import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { genererDocx } from './docx';
import type { RapportCotisationsQueryDto, RapportFinancesQueryDto } from './finance.dto';
import { genererPdf } from './pdf';
import { dateFr, entier, francs, pourcent, type RapportDocument } from './rapport-document';

/** Cotisations : suivi par la comptabilité, la direction, l'exploitation et l'informatique (adjoints par héritage de rôle). */
export const ROLES_RAPPORT_COTISATIONS = ['ASSUREUR_COMPTABLE', 'ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE'] as const;
/** Finances (comptes et mouvements) : comptabilité, direction, informatique. */
export const ROLES_RAPPORT_FINANCES = ['ASSUREUR_COMPTABLE', 'ASSUREUR_DIRECTION', 'ASSUREUR_INFORMATIQUE'] as const;

const LIBELLE_STATUT_COTISATION: Record<string, string> = { A_PAYER: 'À payer', PAYEE: 'Payée', EN_RETARD: 'En retard', ANNULEE: 'Annulée' };
const LIBELLE_TYPE_MOUVEMENT: Record<string, string> = {
  APPROVISIONNEMENT: 'Approvisionnement',
  DEPENSE: 'Dépense',
  TRANSFERT: 'Transfert',
  PAIEMENT_FACTURE: 'Paiement de facture',
};
const LIBELLE_TYPE_COMPTE: Record<string, string> = { BANCAIRE: 'Bancaire', CAISSE_INTERNE: 'Caisse interne' };
const LIMITE_DETAIL = 1000;

export interface RapportCotisations {
  filtres: RapportCotisationsQueryDto;
  indicateurs: { cotisations: number; du: number; paye: number; restant: number; penalites: number; enRetard: number; montantEnRetard: number };
  parStatut: { statut: string; n: number; du: number; paye: number }[];
  parMois: { mois: string; n: number; du: number; paye: number }[];
  parSociete: { nom: string; n: number; du: number; paye: number; enRetard: number }[];
  detail: { periode: string; societe: string; police: string; du: number; paye: number; penalite: number; echeance: string; statut: string }[];
}

export interface RapportFinances {
  filtres: RapportFinancesQueryDto;
  indicateurs: { soldeTotal: number; comptes: number; mouvements: number; entrees: number; sorties: number; transferts: number };
  comptes: { nom: string; type: string; banque: string | null; solde: number }[];
  parType: { type: string; n: number; total: number }[];
  parMois: { mois: string; entrees: number; sorties: number }[];
  detail: { date: string; type: string; montant: number; description: string; source: string | null; destination: string | null }[];
}

/**
 * Rapports de la comptabilité de l'assureur : cotisations (dues, payées, en retard, par société et par mois) et finances
 * (soldes des comptes, entrées et sorties). Mêmes chiffres à l'écran, en PDF et en Word.
 */
@Injectable()
export class FinanceReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  private async contexte(user: AuthenticatedUser, roles: readonly string[], objet: string) {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    if (!(permissions?.roleChain ?? []).some((r) => roles.includes(r))) throw new ForbiddenException(`Le rapport ${objet} est réservé aux profils habilités de l’assureur.`);
    return { organisationId: profil.organisationId, organisationNom: profil.organisationNom ?? 'Assureur', auteur: profil.pseudo ?? profil.email ?? 'utilisateur' };
  }

  private horodatage = () => `${dateFr(new Date())} à ${new Date().toISOString().slice(11, 16)} UTC`;
  private taux = (a: number, b: number) => (b > 0 ? pourcent((a / b) * 100) : '—');

  // ------------------------------------------------------------------ cotisations
  async optionsCotisations(user: AuthenticatedUser) {
    const ctx = await this.contexte(user, ROLES_RAPPORT_COTISATIONS, 'de cotisations');
    const societes = await this.prisma.$queryRaw<{ id: string; nom: string }[]>`SELECT id::text, nom FROM souscripteurs WHERE organisation_id = ${ctx.organisationId}::uuid AND deleted_at IS NULL ORDER BY nom`;
    return { societes, statuts: Object.entries(LIBELLE_STATUT_COTISATION).map(([valeur, libelle]) => ({ valeur, libelle })) };
  }

  async cotisations(user: AuthenticatedUser, f: RapportCotisationsQueryDto): Promise<RapportCotisations> {
    const ctx = await this.contexte(user, ROLES_RAPPORT_COTISATIONS, 'de cotisations');
    return this.calculerCotisations(ctx.organisationId, f);
  }

  private async calculerCotisations(organisationId: string, f: RapportCotisationsQueryDto): Promise<RapportCotisations> {
    const w: Prisma.Sql[] = [Prisma.sql`c.organisation_id = ${organisationId}::uuid`, Prisma.sql`c.deleted_at IS NULL`];
    if (f.statut) w.push(Prisma.sql`c.statut = ${f.statut}`);
    if (f.du) w.push(Prisma.sql`c.periode >= date_trunc('month', ${f.du}::date)::date`);
    if (f.au) w.push(Prisma.sql`c.periode <= ${f.au}::date`);
    if (f.souscripteurId) w.push(Prisma.sql`COALESCE(c.societe_id, ad.souscripteur_id) = ${f.souscripteurId}::uuid`);
    const where = Prisma.join(w, ' AND ');
    const lignes = await this.prisma.$queryRaw<{ r: unknown }[]>`
      WITH c AS (
        SELECT c.id, c.periode, c.statut, COALESCE(c.montant_du, 0)::float8 AS du, COALESCE(c.montant_paye, 0)::float8 AS paye,
               COALESCE(c.penalite_appliquee, 0)::float8 AS penalite, c.date_echeance, c.police_id,
               COALESCE(c.societe_id, ad.souscripteur_id) AS souscripteur_id
        FROM cotisations c LEFT JOIN adherents ad ON ad.id = c.adherent_id
        WHERE ${where}
      ), actives AS (SELECT * FROM c WHERE statut <> 'ANNULEE')
      SELECT json_build_object(
        'indicateurs', (SELECT json_build_object('cotisations', COUNT(*)::int, 'du', COALESCE(SUM(du), 0), 'paye', COALESCE(SUM(paye), 0),
            'restant', COALESCE(SUM(du - paye), 0), 'penalites', COALESCE(SUM(penalite), 0),
            'enRetard', COUNT(*) FILTER (WHERE statut = 'EN_RETARD')::int, 'montantEnRetard', COALESCE(SUM(du - paye) FILTER (WHERE statut = 'EN_RETARD'), 0)) FROM actives),
        'parStatut', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (SELECT statut, COUNT(*)::int AS n, SUM(du) AS du, SUM(paye) AS paye FROM c GROUP BY 1 ORDER BY 3 DESC) x),
        'parMois', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (SELECT to_char(periode, 'YYYY-MM') AS mois, COUNT(*)::int AS n, SUM(du) AS du, SUM(paye) AS paye FROM actives GROUP BY 1 ORDER BY 1) x),
        'parSociete', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
            SELECT COALESCE(s.nom, '—') AS nom, COUNT(*)::int AS n, SUM(a.du) AS du, SUM(a.paye) AS paye, COUNT(*) FILTER (WHERE a.statut = 'EN_RETARD')::int AS "enRetard"
            FROM actives a LEFT JOIN souscripteurs s ON s.id = a.souscripteur_id GROUP BY 1 ORDER BY 3 DESC LIMIT 40) x),
        'detail', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
            SELECT to_char(c.periode, 'YYYY-MM') AS periode, COALESCE(s.nom, '—') AS societe, COALESCE(po.numero_police, '—') AS police,
                   c.du, c.paye, c.penalite, c.date_echeance AS echeance, c.statut
            FROM c LEFT JOIN souscripteurs s ON s.id = c.souscripteur_id LEFT JOIN polices po ON po.id = c.police_id
            ORDER BY c.periode DESC, s.nom LIMIT ${LIMITE_DETAIL}) x)
      ) AS r`;
    return { filtres: f, ...(lignes[0].r as Omit<RapportCotisations, 'filtres'>) };
  }

  async documentCotisations(user: AuthenticatedUser, f: RapportCotisationsQueryDto): Promise<RapportDocument> {
    const ctx = await this.contexte(user, ROLES_RAPPORT_COTISATIONS, 'de cotisations');
    const r = await this.calculerCotisations(ctx.organisationId, f);
    const filtres: { libelle: string; valeur: string }[] = [{ libelle: 'Période de cotisation', valeur: f.du || f.au ? `${f.du ? dateFr(f.du) : 'début'} au ${f.au ? dateFr(f.au) : 'ce jour'}` : 'Toutes les périodes' }];
    if (f.souscripteurId) {
      const [s] = await this.prisma.$queryRaw<{ nom: string }[]>`SELECT nom FROM souscripteurs WHERE id = ${f.souscripteurId}::uuid AND organisation_id = ${ctx.organisationId}::uuid`;
      filtres.push({ libelle: 'Société cliente', valeur: s?.nom ?? '—' });
    }
    if (f.statut) filtres.push({ libelle: 'Statut', valeur: LIBELLE_STATUT_COTISATION[f.statut] });
    const i = r.indicateurs;
    const cols = (premiere: string) => [{ titre: premiere, poids: 3 }, { titre: 'Cotisations', align: 'droite' as const }, { titre: 'Dû', align: 'droite' as const, poids: 1.4 }, { titre: 'Payé', align: 'droite' as const, poids: 1.4 }, { titre: 'Restant', align: 'droite' as const, poids: 1.4 }, { titre: '% encaissé', align: 'droite' as const }];
    const ligne = (nom: string, l: { n: number; du: number; paye: number }) => [nom, entier(l.n), francs(l.du), francs(l.paye), francs(l.du - l.paye), this.taux(l.paye, l.du)];
    return {
      titre: 'Rapport de cotisations',
      sousTitre: 'Appels de cotisation : dû, encaissé, restant et retards (cotisations annulées exclues des totaux)',
      organisation: ctx.organisationNom,
      filtres,
      genereLe: this.horodatage(),
      genererPar: ctx.auteur,
      sections: [
        {
          titre: 'Synthèse',
          indicateurs: [
            { libelle: 'Cotisations', valeur: entier(i.cotisations) },
            { libelle: 'Montant dû', valeur: francs(i.du) },
            { libelle: 'Montant encaissé', valeur: `${francs(i.paye)} (${this.taux(i.paye, i.du)})` },
            { libelle: 'Reste à encaisser', valeur: francs(i.restant) },
            { libelle: 'Cotisations en retard', valeur: entier(i.enRetard) },
            { libelle: 'Montant en retard', valeur: francs(i.montantEnRetard) },
            { libelle: 'Pénalités appliquées', valeur: francs(i.penalites) },
          ],
        },
        { titre: 'Évolution par mois', tableau: { colonnes: cols('Mois'), lignes: r.parMois.map((m) => ligne(m.mois, m)), total: ligne('Total', { n: i.cotisations, du: i.du, paye: i.paye }) } },
        { titre: 'Par statut', tableau: { colonnes: cols('Statut'), lignes: r.parStatut.map((s) => ligne(LIBELLE_STATUT_COTISATION[s.statut] ?? s.statut, s)) } },
        { titre: 'Par société cliente', tableau: { colonnes: [...cols('Société'), { titre: 'En retard', align: 'droite' as const }], lignes: r.parSociete.map((s) => [...ligne(s.nom, s), entier(s.enRetard)]) } },
        {
          titre: 'Détail des cotisations',
          tableau: {
            colonnes: [{ titre: 'Période' }, { titre: 'Société', poids: 3 }, { titre: 'Police', poids: 1.6 }, { titre: 'Dû', align: 'droite', poids: 1.3 }, { titre: 'Payé', align: 'droite', poids: 1.3 }, { titre: 'Pénalité', align: 'droite', poids: 1.1 }, { titre: 'Échéance' }, { titre: 'Statut' }],
            lignes: r.detail.map((d) => [d.periode, d.societe, d.police, francs(d.du), francs(d.paye), francs(d.penalite), dateFr(d.echeance), LIBELLE_STATUT_COTISATION[d.statut] ?? d.statut]),
            note: r.detail.length >= LIMITE_DETAIL ? `Seules les ${LIMITE_DETAIL} cotisations les plus récentes sont détaillées ; affinez les critères pour les autres.` : undefined,
          },
        },
      ],
    };
  }

  async exporterCotisations(user: AuthenticatedUser, f: RapportCotisationsQueryDto, format: 'pdf' | 'docx') {
    const doc = await this.documentCotisations(user, f);
    return this.fichier(doc, format, 'rapport-cotisations');
  }

  // ------------------------------------------------------------------ finances
  async optionsFinances(user: AuthenticatedUser) {
    const ctx = await this.contexte(user, ROLES_RAPPORT_FINANCES, 'financier');
    const comptes = await this.prisma.$queryRaw<{ id: string; nom: string }[]>`SELECT id::text, nom FROM comptes_financiers WHERE organisation_id = ${ctx.organisationId}::uuid AND deleted_at IS NULL ORDER BY nom`;
    return { comptes, types: Object.entries(LIBELLE_TYPE_MOUVEMENT).map(([valeur, libelle]) => ({ valeur, libelle })) };
  }

  async finances(user: AuthenticatedUser, f: RapportFinancesQueryDto): Promise<RapportFinances> {
    const ctx = await this.contexte(user, ROLES_RAPPORT_FINANCES, 'financier');
    return this.calculerFinances(ctx.organisationId, f);
  }

  private async calculerFinances(organisationId: string, f: RapportFinancesQueryDto): Promise<RapportFinances> {
    const w: Prisma.Sql[] = [Prisma.sql`m.organisation_id = ${organisationId}::uuid`];
    if (f.type) w.push(Prisma.sql`m.type = ${f.type}`);
    if (f.du) w.push(Prisma.sql`m.created_at >= ${f.du}::date`);
    if (f.au) w.push(Prisma.sql`m.created_at < (${f.au}::date + 1)`);
    if (f.compteId) w.push(Prisma.sql`(m.compte_source_id = ${f.compteId}::uuid OR m.compte_destination_id = ${f.compteId}::uuid)`);
    const where = Prisma.join(w, ' AND ');
    const lignes = await this.prisma.$queryRaw<{ r: unknown }[]>`
      WITH m AS (SELECT m.* FROM mouvements_financiers m WHERE ${where}),
           cf AS (SELECT * FROM comptes_financiers WHERE organisation_id = ${organisationId}::uuid AND deleted_at IS NULL AND statut = 'ACTIF'
                    ${f.compteId ? Prisma.sql`AND id = ${f.compteId}::uuid` : Prisma.empty})
      SELECT json_build_object(
        'indicateurs', json_build_object(
          'soldeTotal', (SELECT COALESCE(SUM(solde_actuel), 0)::float8 FROM cf),
          'comptes', (SELECT COUNT(*)::int FROM cf),
          'mouvements', (SELECT COUNT(*)::int FROM m),
          'entrees', (SELECT COALESCE(SUM(montant) FILTER (WHERE type = 'APPROVISIONNEMENT'), 0)::float8 FROM m),
          'sorties', (SELECT COALESCE(SUM(montant) FILTER (WHERE type IN ('DEPENSE', 'PAIEMENT_FACTURE')), 0)::float8 FROM m),
          'transferts', (SELECT COALESCE(SUM(montant) FILTER (WHERE type = 'TRANSFERT'), 0)::float8 FROM m)),
        'comptes', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (SELECT nom, type, banque_nom AS banque, solde_actuel::float8 AS solde FROM cf ORDER BY solde_actuel DESC) x),
        'parType', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (SELECT type, COUNT(*)::int AS n, SUM(montant)::float8 AS total FROM m GROUP BY 1 ORDER BY 3 DESC) x),
        'parMois', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
            SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS mois,
                   COALESCE(SUM(montant) FILTER (WHERE type = 'APPROVISIONNEMENT'), 0)::float8 AS entrees,
                   COALESCE(SUM(montant) FILTER (WHERE type IN ('DEPENSE', 'PAIEMENT_FACTURE')), 0)::float8 AS sorties
            FROM m GROUP BY 1 ORDER BY 1) x),
        'detail', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
            SELECT m.created_at AS date, m.type, m.montant::float8 AS montant, m.description, src.nom AS source, dst.nom AS destination
            FROM m LEFT JOIN comptes_financiers src ON src.id = m.compte_source_id LEFT JOIN comptes_financiers dst ON dst.id = m.compte_destination_id
            ORDER BY m.created_at DESC LIMIT ${LIMITE_DETAIL}) x)
      ) AS r`;
    return { filtres: f, ...(lignes[0].r as Omit<RapportFinances, 'filtres'>) };
  }

  async documentFinances(user: AuthenticatedUser, f: RapportFinancesQueryDto): Promise<RapportDocument> {
    const ctx = await this.contexte(user, ROLES_RAPPORT_FINANCES, 'financier');
    const r = await this.calculerFinances(ctx.organisationId, f);
    const filtres: { libelle: string; valeur: string }[] = [{ libelle: 'Période des mouvements', valeur: f.du || f.au ? `${f.du ? dateFr(f.du) : 'début'} au ${f.au ? dateFr(f.au) : 'ce jour'}` : 'Toutes les périodes' }];
    if (f.type) filtres.push({ libelle: 'Type de mouvement', valeur: LIBELLE_TYPE_MOUVEMENT[f.type] });
    if (f.compteId) {
      const [c] = await this.prisma.$queryRaw<{ nom: string }[]>`SELECT nom FROM comptes_financiers WHERE id = ${f.compteId}::uuid AND organisation_id = ${ctx.organisationId}::uuid`;
      filtres.push({ libelle: 'Compte', valeur: c?.nom ?? '—' });
    }
    const i = r.indicateurs;
    return {
      titre: 'Rapport financier',
      sousTitre: 'Soldes des comptes, entrées (approvisionnements) et sorties (dépenses et paiements de factures)',
      organisation: ctx.organisationNom,
      filtres,
      genereLe: this.horodatage(),
      genererPar: ctx.auteur,
      sections: [
        {
          titre: 'Synthèse',
          indicateurs: [
            { libelle: 'Solde total des comptes', valeur: francs(i.soldeTotal) },
            { libelle: 'Comptes actifs', valeur: entier(i.comptes) },
            { libelle: 'Mouvements', valeur: entier(i.mouvements) },
            { libelle: 'Entrées', valeur: francs(i.entrees) },
            { libelle: 'Sorties', valeur: francs(i.sorties) },
            { libelle: 'Solde net de la période (entrées − sorties)', valeur: francs(i.entrees - i.sorties) },
            { libelle: 'Transferts internes', valeur: francs(i.transferts) },
          ],
        },
        { titre: 'Soldes des comptes', tableau: { colonnes: [{ titre: 'Compte', poids: 3 }, { titre: 'Type' }, { titre: 'Banque', poids: 2 }, { titre: 'Solde actuel', align: 'droite', poids: 1.5 }], lignes: r.comptes.map((c) => [c.nom, LIBELLE_TYPE_COMPTE[c.type] ?? c.type, c.banque ?? '—', francs(c.solde)]), total: ['Total', '', '', francs(i.soldeTotal)] } },
        { titre: 'Par mois', tableau: { colonnes: [{ titre: 'Mois', poids: 2 }, { titre: 'Entrées', align: 'droite' }, { titre: 'Sorties', align: 'droite' }, { titre: 'Solde net', align: 'droite' }], lignes: r.parMois.map((m) => [m.mois, francs(m.entrees), francs(m.sorties), francs(m.entrees - m.sorties)]), total: ['Total', francs(i.entrees), francs(i.sorties), francs(i.entrees - i.sorties)] } },
        { titre: 'Par type de mouvement', tableau: { colonnes: [{ titre: 'Type', poids: 3 }, { titre: 'Mouvements', align: 'droite' }, { titre: 'Montant', align: 'droite', poids: 1.5 }], lignes: r.parType.map((t) => [LIBELLE_TYPE_MOUVEMENT[t.type] ?? t.type, entier(t.n), francs(t.total)]) } },
        {
          titre: 'Détail des mouvements',
          tableau: {
            colonnes: [{ titre: 'Date' }, { titre: 'Type', poids: 1.6 }, { titre: 'Montant', align: 'droite', poids: 1.3 }, { titre: 'Libellé', poids: 4 }, { titre: 'Compte source', poids: 2 }, { titre: 'Compte destination', poids: 2 }],
            lignes: r.detail.map((d) => [dateFr(d.date), LIBELLE_TYPE_MOUVEMENT[d.type] ?? d.type, francs(d.montant), d.description, d.source ?? '—', d.destination ?? '—']),
            note: r.detail.length >= LIMITE_DETAIL ? `Seuls les ${LIMITE_DETAIL} mouvements les plus récents sont détaillés ; affinez les critères pour les autres.` : undefined,
          },
        },
      ],
    };
  }

  async exporterFinances(user: AuthenticatedUser, f: RapportFinancesQueryDto, format: 'pdf' | 'docx') {
    const doc = await this.documentFinances(user, f);
    return this.fichier(doc, format, 'rapport-financier');
  }

  private async fichier(doc: RapportDocument, format: 'pdf' | 'docx', base: string) {
    const buffer = format === 'pdf' ? await genererPdf(doc) : await genererDocx(doc);
    return {
      buffer,
      nomFichier: `${base}-${new Date().toISOString().slice(0, 10)}.${format}`,
      type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
}
