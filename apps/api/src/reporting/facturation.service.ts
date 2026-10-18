import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { genererDocx } from './docx';
import { type RapportFacturationQueryDto } from './facturation.dto';
import { genererPdf } from './pdf';
import { dateFr, entier, francs, pourcent, type RapportDocument } from './rapport-document';

/** Profils de l'assureur qui suivent la facturation des prestataires (les adjoints héritent via la chaîne de rôles). */
export const ROLES_RAPPORT_FACTURATION = [
  'ASSUREUR_COMPTABLE',
  'ASSUREUR_DIRECTION',
  'ASSUREUR_EXPLOITATION',
  'ASSUREUR_INFORMATIQUE',
  'ASSUREUR_MEDECIN_CONSEIL',
  'ASSUREUR_PHARMACIEN_CONSEIL',
] as const;

export const LIBELLE_STATUT_FACTURE: Record<string, string> = {
  EN_PREPARATION: 'En préparation',
  SOUMISE: 'Soumise',
  VERIFIEE_MEDECIN_CONSEIL: 'Vérifiée (médecin conseil)',
  VALIDEE_PHARMACIEN_CONSEIL: 'Vérifiée (pharmacien conseil)',
  PROGRAMMEE_PAIEMENT: 'Validée — à payer',
  PAIEMENT_PROGRAMME: 'Paiement programmé',
  PARTIELLEMENT_REGLEE: 'Réglée partiellement',
  PAYEE: 'Payée',
};
const LIBELLE_TYPE: Record<string, string> = { ETABLISSEMENT: 'Établissement', PHARMACIE: 'Pharmacie' };
const LIMITE_DETAIL = 1000;

export interface RapportFacturation {
  filtres: RapportFacturationQueryDto;
  indicateurs: { factures: number; total: number; paye: number; restant: number; payees: number; delaiMoyenJours: number | null };
  parStatut: { statut: string; n: number; total: number; paye: number }[];
  parType: { type: string; n: number; total: number; paye: number }[];
  parMois: { mois: string; n: number; total: number; paye: number }[];
  parPrestataire: { nom: string; type: string; n: number; total: number; paye: number }[];
  detail: { periode: string; type: string; prestataire: string; statut: string; total: number; paye: number; soumise: string | null; payee: string | null }[];
}

/**
 * Rapport de facturation mensuelle des prestataires (établissements de santé et pharmacies) : montants facturés, payés et
 * restant dû, par mois, statut, type et prestataire. Mêmes chiffres à l'écran, en PDF et en Word.
 */
@Injectable()
export class FacturationReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  private async contexte(user: AuthenticatedUser) {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    const ok = (permissions?.roleChain ?? []).some((r) => (ROLES_RAPPORT_FACTURATION as readonly string[]).includes(r));
    if (!ok) throw new ForbiddenException('Le rapport de facturation est réservé aux profils habilités de l’assureur.');
    return { organisationId: profil.organisationId, organisationNom: profil.organisationNom ?? 'Assureur', auteur: profil.pseudo ?? profil.email ?? 'utilisateur' };
  }

  async options(user: AuthenticatedUser) {
    const ctx = await this.contexte(user);
    const [etablissements, pharmacies] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; nom: string }[]>`SELECT id::text, nom FROM etablissements_sante WHERE organisation_id = ${ctx.organisationId}::uuid AND deleted_at IS NULL ORDER BY nom`,
      this.prisma.$queryRaw<{ id: string; nom: string }[]>`SELECT id::text, nom FROM pharmacies WHERE organisation_id = ${ctx.organisationId}::uuid AND deleted_at IS NULL ORDER BY nom`,
    ]);
    return {
      etablissements,
      pharmacies,
      statuts: Object.entries(LIBELLE_STATUT_FACTURE).map(([valeur, libelle]) => ({ valeur, libelle })),
    };
  }

  async rapport(user: AuthenticatedUser, f: RapportFacturationQueryDto): Promise<RapportFacturation> {
    const ctx = await this.contexte(user);
    return this.calculer(ctx.organisationId, f);
  }

  private async calculer(organisationId: string, f: RapportFacturationQueryDto): Promise<RapportFacturation> {
    const conditions: Prisma.Sql[] = [Prisma.sql`true`];
    if (f.type) conditions.push(Prisma.sql`u.type = ${f.type}`);
    if (f.prestataireId) conditions.push(Prisma.sql`u.prestataire_id = ${f.prestataireId}::uuid`);
    if (f.statut) conditions.push(Prisma.sql`u.statut = ${f.statut}`);
    if (f.du) conditions.push(Prisma.sql`u.periode >= date_trunc('month', ${f.du}::date)::date`);
    if (f.au) conditions.push(Prisma.sql`u.periode <= ${f.au}::date`);
    const where = Prisma.join(conditions, ' AND ');

    const lignes = await this.prisma.$queryRaw<{ r: unknown }[]>`
      WITH u AS (
        SELECT 'ETABLISSEMENT'::text AS type, fm.id, fm.periode, fm.etablissement_id AS prestataire_id, e.nom AS prestataire, fm.statut,
               COALESCE(fm.montant_total, 0)::float8 AS total, COALESCE(fm.montant_paye, 0)::float8 AS paye, fm.date_soumission, fm.date_paiement
        FROM factures_mensuelles_etablissement fm JOIN etablissements_sante e ON e.id = fm.etablissement_id
        WHERE fm.organisation_id = ${organisationId}::uuid
        UNION ALL
        SELECT 'PHARMACIE'::text, fm.id, fm.periode, fm.pharmacie_id, p.nom, fm.statut,
               COALESCE(fm.montant_total, 0)::float8, COALESCE(fm.montant_paye, 0)::float8, fm.date_soumission, fm.date_paiement
        FROM factures_mensuelles_pharmacie fm JOIN pharmacies p ON p.id = fm.pharmacie_id
        WHERE fm.organisation_id = ${organisationId}::uuid
      ), f AS (SELECT * FROM u WHERE ${where})
      SELECT json_build_object(
        'indicateurs', (SELECT json_build_object(
            'factures', COUNT(*)::int, 'total', COALESCE(SUM(total), 0), 'paye', COALESCE(SUM(paye), 0),
            'restant', COALESCE(SUM(total - paye), 0), 'payees', COUNT(*) FILTER (WHERE statut = 'PAYEE')::int,
            'delaiMoyenJours', AVG(EXTRACT(EPOCH FROM (date_paiement - date_soumission)) / 86400) FILTER (WHERE date_paiement IS NOT NULL AND date_soumission IS NOT NULL)) FROM f),
        'parStatut', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (SELECT statut, COUNT(*)::int AS n, SUM(total) AS total, SUM(paye) AS paye FROM f GROUP BY 1 ORDER BY 3 DESC) x),
        'parType', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (SELECT type, COUNT(*)::int AS n, SUM(total) AS total, SUM(paye) AS paye FROM f GROUP BY 1 ORDER BY 1) x),
        'parMois', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (SELECT to_char(periode, 'YYYY-MM') AS mois, COUNT(*)::int AS n, SUM(total) AS total, SUM(paye) AS paye FROM f GROUP BY 1 ORDER BY 1) x),
        'parPrestataire', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (SELECT prestataire AS nom, type, COUNT(*)::int AS n, SUM(total) AS total, SUM(paye) AS paye FROM f GROUP BY 1, 2 ORDER BY 4 DESC LIMIT 40) x),
        'detail', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
            SELECT to_char(periode, 'YYYY-MM') AS periode, type, prestataire, statut, total, paye, date_soumission AS soumise, date_paiement AS payee
            FROM f ORDER BY f.periode DESC, prestataire LIMIT ${LIMITE_DETAIL}) x)
      ) AS r`;
    const r = lignes[0].r as Omit<RapportFacturation, 'filtres'>;
    return { filtres: f, ...r };
  }

  private async libellesFiltres(organisationId: string, f: RapportFacturationQueryDto) {
    const out: { libelle: string; valeur: string }[] = [
      { libelle: 'Période de facturation', valeur: f.du || f.au ? `${f.du ? dateFr(f.du) : 'début'} au ${f.au ? dateFr(f.au) : 'ce jour'}` : 'Toutes les périodes' },
    ];
    if (f.type) out.push({ libelle: 'Type de prestataire', valeur: LIBELLE_TYPE[f.type] });
    if (f.prestataireId) {
      const [p] = await this.prisma.$queryRaw<{ nom: string }[]>`
        SELECT nom FROM etablissements_sante WHERE id = ${f.prestataireId}::uuid AND organisation_id = ${organisationId}::uuid
        UNION ALL SELECT nom FROM pharmacies WHERE id = ${f.prestataireId}::uuid AND organisation_id = ${organisationId}::uuid LIMIT 1`;
      out.push({ libelle: 'Prestataire', valeur: p?.nom ?? '—' });
    }
    if (f.statut) out.push({ libelle: 'Statut', valeur: LIBELLE_STATUT_FACTURE[f.statut] ?? f.statut });
    return out;
  }

  async document(user: AuthenticatedUser, f: RapportFacturationQueryDto): Promise<RapportDocument> {
    const ctx = await this.contexte(user);
    const [r, filtres] = await Promise.all([this.calculer(ctx.organisationId, f), this.libellesFiltres(ctx.organisationId, f)]);
    const i = r.indicateurs;
    const taux = (a: number, b: number) => (b > 0 ? pourcent((a / b) * 100) : '—');
    const cols = (premiere: string) => [
      { titre: premiere, poids: 3 },
      { titre: 'Factures', align: 'droite' as const },
      { titre: 'Montant facturé', align: 'droite' as const, poids: 1.4 },
      { titre: 'Montant payé', align: 'droite' as const, poids: 1.4 },
      { titre: 'Restant dû', align: 'droite' as const, poids: 1.4 },
      { titre: '% payé', align: 'droite' as const },
    ];
    const ligne = (nom: string, l: { n: number; total: number; paye: number }) => [nom, entier(l.n), francs(l.total), francs(l.paye), francs(l.total - l.paye), taux(l.paye, l.total)];
    return {
      titre: 'Rapport de facturation mensuelle',
      sousTitre: 'Factures mensuelles des établissements de santé et des pharmacies : facturé, payé et restant dû',
      organisation: ctx.organisationNom,
      filtres,
      genereLe: `${dateFr(new Date())} à ${new Date().toISOString().slice(11, 16)} UTC`,
      genererPar: ctx.auteur,
      sections: [
        {
          titre: 'Synthèse',
          indicateurs: [
            { libelle: 'Factures mensuelles', valeur: entier(i.factures) },
            { libelle: 'Montant facturé', valeur: francs(i.total) },
            { libelle: 'Montant payé', valeur: `${francs(i.paye)} (${taux(i.paye, i.total)})` },
            { libelle: 'Restant dû', valeur: francs(i.restant) },
            { libelle: 'Factures payées', valeur: `${entier(i.payees)} / ${entier(i.factures)}` },
            { libelle: 'Délai moyen soumission → paiement', valeur: i.delaiMoyenJours === null ? '—' : `${Math.round(i.delaiMoyenJours)} jours` },
          ],
        },
        { titre: 'Évolution par mois', tableau: { colonnes: cols('Mois'), lignes: r.parMois.map((m) => ligne(m.mois, m)), total: ligne('Total', { n: i.factures, total: i.total, paye: i.paye }) } },
        { titre: 'Par type de prestataire', tableau: { colonnes: cols('Type'), lignes: r.parType.map((t) => ligne(LIBELLE_TYPE[t.type] ?? t.type, t)) } },
        { titre: 'Par statut', tableau: { colonnes: cols('Statut'), lignes: r.parStatut.map((s) => ligne(LIBELLE_STATUT_FACTURE[s.statut] ?? s.statut, s)) } },
        { titre: 'Par prestataire', tableau: { colonnes: cols('Prestataire'), lignes: r.parPrestataire.map((p) => ligne(`${p.nom} (${(LIBELLE_TYPE[p.type] ?? p.type).toLowerCase()})`, p)) } },
        {
          titre: 'Détail des factures mensuelles',
          tableau: {
            colonnes: [
              { titre: 'Mois' }, { titre: 'Type' }, { titre: 'Prestataire', poids: 3 }, { titre: 'Statut', poids: 2 },
              { titre: 'Facturé', align: 'droite', poids: 1.3 }, { titre: 'Payé', align: 'droite', poids: 1.3 }, { titre: 'Restant', align: 'droite', poids: 1.3 },
              { titre: 'Soumise le' }, { titre: 'Payée le' },
            ],
            lignes: r.detail.map((d) => [d.periode, LIBELLE_TYPE[d.type] ?? d.type, d.prestataire, LIBELLE_STATUT_FACTURE[d.statut] ?? d.statut, francs(d.total), francs(d.paye), francs(d.total - d.paye), dateFr(d.soumise), dateFr(d.payee)]),
            note: i.factures > r.detail.length ? `Seules les ${r.detail.length} factures les plus récentes sur ${entier(i.factures)} sont détaillées ; affinez les critères pour les autres.` : undefined,
          },
        },
      ],
    };
  }

  async exporter(user: AuthenticatedUser, f: RapportFacturationQueryDto, format: 'pdf' | 'docx') {
    const doc = await this.document(user, f);
    const buffer = format === 'pdf' ? await genererPdf(doc) : await genererDocx(doc);
    return {
      buffer,
      nomFichier: `rapport-facturation-mensuelle-${new Date().toISOString().slice(0, 10)}.${format}`,
      type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
}
