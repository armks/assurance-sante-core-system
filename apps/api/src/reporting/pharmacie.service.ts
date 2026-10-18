import { ForbiddenException, Injectable } from '@nestjs/common';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { genererDocx } from './docx';
import { genererPdf } from './pdf';
import { dateFr, entier, francs, pourcent, type RapportDocument } from './rapport-document';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Critères du rapport des dispensations de pharmacie (tous facultatifs, cumulables). */
export class RapportDispensationsQueryDto {
  /** Date de préparation de la dispensation, bornes incluses. */
  @IsOptional()
  @Matches(DATE, { message: 'du doit être une date AAAA-MM-JJ' })
  du?: string;

  @IsOptional()
  @Matches(DATE, { message: 'au doit être une date AAAA-MM-JJ' })
  au?: string;

  @IsOptional()
  @IsUUID()
  pharmacieId?: string;

  @IsOptional()
  @IsIn(['EN_PREPARATION', 'EN_ATTENTE_VALIDATION_PATIENT', 'VALIDEE', 'PAYEE', 'ANNULEE'])
  statut?: 'EN_PREPARATION' | 'EN_ATTENTE_VALIDATION_PATIENT' | 'VALIDEE' | 'PAYEE' | 'ANNULEE';
}

export class ExportDispensationsQueryDto extends RapportDispensationsQueryDto {
  @IsIn(['pdf', 'docx'])
  format!: 'pdf' | 'docx';
}

/** Assureur : suivi du réseau de pharmacies. Pharmacie : sa propre pharmacie uniquement (périmètre imposé côté serveur). */
const ROLES_ASSUREUR = ['ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE', 'ASSUREUR_PHARMACIEN_CONSEIL', 'ASSUREUR_COMPTABLE'] as const;
const ROLES_PHARMACIE = ['PHARMACIE_PHARMACIEN', 'PHARMACIE_COMPTABLE'] as const;
const LIBELLE_STATUT: Record<string, string> = {
  EN_PREPARATION: 'En préparation',
  EN_ATTENTE_VALIDATION_PATIENT: 'En attente du patient',
  VALIDEE: 'Validée — à payer',
  PAYEE: 'Payée',
  ANNULEE: 'Annulée',
};
const LIMITE_DETAIL = 1000;

export interface RapportDispensations {
  filtres: RapportDispensationsQueryDto;
  indicateurs: { dispensations: number; payees: number; annulees: number; lignes: number; total: number; assurance: number; patient: number; majorationsAnormales: number };
  parStatut: { statut: string; n: number; total: number }[];
  parMois: { mois: string; n: number; total: number; assurance: number }[];
  parPharmacie: { nom: string; n: number; total: number; assurance: number }[];
  medicaments: { nom: string; quantite: number; montant: number }[];
  detail: { date: string; pharmacie: string; statut: string; lignes: number; total: number; assurance: number; patient: number; payee: string | null }[];
}

/**
 * Rapport des dispensations de pharmacie : volumes, montants (assurance / patient), médicaments les plus délivrés, anomalies de
 * majoration. L'assureur voit tout le réseau ; le personnel d'une pharmacie ne voit que la sienne, quel que soit le critère transmis.
 */
@Injectable()
export class PharmacieReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  private async contexte(user: AuthenticatedUser) {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    const roles = permissions?.roleChain ?? [];
    const assureur = roles.some((r) => (ROLES_ASSUREUR as readonly string[]).includes(r));
    const pharmacie = roles.some((r) => (ROLES_PHARMACIE as readonly string[]).includes(r)) && !!profil.pharmacieId;
    if (!assureur && !pharmacie) throw new ForbiddenException('Le rapport des dispensations est réservé aux profils habilités de l’assureur et de la pharmacie.');
    return {
      organisationId: profil.organisationId,
      organisationNom: profil.organisationNom ?? 'Assureur',
      auteur: profil.pseudo ?? profil.email ?? 'utilisateur',
      pharmacieId: assureur ? null : profil.pharmacieId,
    };
  }

  async options(user: AuthenticatedUser) {
    const ctx = await this.contexte(user);
    const pharmacies = await this.prisma.$queryRaw<{ id: string; nom: string }[]>`
      SELECT id::text, nom FROM pharmacies WHERE organisation_id = ${ctx.organisationId}::uuid AND deleted_at IS NULL
      ${ctx.pharmacieId ? Prisma.sql`AND id = ${ctx.pharmacieId}::uuid` : Prisma.empty} ORDER BY nom`;
    return { pharmacies, statuts: Object.entries(LIBELLE_STATUT).map(([valeur, libelle]) => ({ valeur, libelle })), limiteAPharmacie: !!ctx.pharmacieId };
  }

  async rapport(user: AuthenticatedUser, f: RapportDispensationsQueryDto): Promise<RapportDispensations> {
    const ctx = await this.contexte(user);
    return this.calculer(ctx.organisationId, ctx.pharmacieId, f);
  }

  private async calculer(organisationId: string, pharmacieImposee: string | null, f: RapportDispensationsQueryDto): Promise<RapportDispensations> {
    const w: Prisma.Sql[] = [Prisma.sql`d.organisation_id = ${organisationId}::uuid`];
    const pharmacie = pharmacieImposee ?? f.pharmacieId;
    if (pharmacie) w.push(Prisma.sql`d.pharmacie_id = ${pharmacie}::uuid`);
    if (f.statut) w.push(Prisma.sql`d.statut = ${f.statut}`);
    if (f.du) w.push(Prisma.sql`d.date_preparation >= ${f.du}::date`);
    if (f.au) w.push(Prisma.sql`d.date_preparation < (${f.au}::date + 1)`);
    const where = Prisma.join(w, ' AND ');
    const lignes = await this.prisma.$queryRaw<{ r: unknown }[]>`
      WITH l AS (
        SELECT ld.dispensation_id, COUNT(*)::int AS nb, SUM(ld.montant_assurance)::float8 AS assurance, SUM(ld.montant_patient)::float8 AS patient,
               COUNT(*) FILTER (WHERE ld.majoration_anormale)::int AS majorations
        FROM lignes_dispensation ld GROUP BY ld.dispensation_id
      ), d AS (
        SELECT d.id, d.statut, d.montant_total::float8 AS total, d.date_preparation, d.date_paiement, ph.nom AS pharmacie,
               COALESCE(l.nb, 0) AS nb, COALESCE(l.assurance, 0) AS assurance, COALESCE(l.patient, 0) AS patient, COALESCE(l.majorations, 0) AS majorations
        FROM dispensations_pharmacie d JOIN pharmacies ph ON ph.id = d.pharmacie_id LEFT JOIN l ON l.dispensation_id = d.id
        WHERE ${where}
      ), dn AS (SELECT * FROM d WHERE statut <> 'ANNULEE')
      SELECT json_build_object(
        'indicateurs', json_build_object(
          'dispensations', (SELECT COUNT(*)::int FROM d),
          'payees', (SELECT COUNT(*)::int FROM d WHERE statut = 'PAYEE'),
          'annulees', (SELECT COUNT(*)::int FROM d WHERE statut = 'ANNULEE'),
          'lignes', (SELECT COALESCE(SUM(nb), 0)::int FROM dn),
          'total', (SELECT COALESCE(SUM(total), 0) FROM dn),
          'assurance', (SELECT COALESCE(SUM(assurance), 0) FROM dn),
          'patient', (SELECT COALESCE(SUM(patient), 0) FROM dn),
          'majorationsAnormales', (SELECT COALESCE(SUM(majorations), 0)::int FROM dn)),
        'parStatut', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (SELECT statut, COUNT(*)::int AS n, SUM(total) AS total FROM d GROUP BY 1 ORDER BY 2 DESC) x),
        'parMois', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (SELECT to_char(date_trunc('month', date_preparation), 'YYYY-MM') AS mois, COUNT(*)::int AS n, SUM(total) AS total, SUM(assurance) AS assurance FROM dn GROUP BY 1 ORDER BY 1) x),
        'parPharmacie', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (SELECT pharmacie AS nom, COUNT(*)::int AS n, SUM(total) AS total, SUM(assurance) AS assurance FROM dn GROUP BY 1 ORDER BY 3 DESC LIMIT 30) x),
        'medicaments', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
            SELECT lo.denomination_medicament AS nom, SUM(ld.quantite)::int AS quantite, SUM(ld.montant_ligne)::float8 AS montant
            FROM lignes_dispensation ld JOIN dn ON dn.id = ld.dispensation_id JOIN lignes_ordonnance lo ON lo.id = ld.ligne_ordonnance_id
            GROUP BY 1 ORDER BY 3 DESC LIMIT 15) x),
        'detail', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
            SELECT date_preparation AS date, pharmacie, statut, nb AS lignes, total, assurance, patient, date_paiement AS payee FROM d ORDER BY date_preparation DESC LIMIT ${LIMITE_DETAIL}) x)
      ) AS r`;
    return { filtres: f, ...(lignes[0].r as Omit<RapportDispensations, 'filtres'>) };
  }

  async document(user: AuthenticatedUser, f: RapportDispensationsQueryDto): Promise<RapportDocument> {
    const ctx = await this.contexte(user);
    const r = await this.calculer(ctx.organisationId, ctx.pharmacieId, f);
    const filtres: { libelle: string; valeur: string }[] = [{ libelle: 'Période de préparation', valeur: f.du || f.au ? `${f.du ? dateFr(f.du) : 'début'} au ${f.au ? dateFr(f.au) : 'ce jour'}` : 'Toutes les périodes' }];
    const pharmacieId = ctx.pharmacieId ?? f.pharmacieId;
    if (pharmacieId) {
      const [p] = await this.prisma.$queryRaw<{ nom: string }[]>`SELECT nom FROM pharmacies WHERE id = ${pharmacieId}::uuid AND organisation_id = ${ctx.organisationId}::uuid`;
      filtres.push({ libelle: 'Pharmacie', valeur: p?.nom ?? '—' });
    }
    if (f.statut) filtres.push({ libelle: 'Statut', valeur: LIBELLE_STATUT[f.statut] });
    const i = r.indicateurs;
    const taux = (a: number, b: number) => (b > 0 ? pourcent((a / b) * 100) : '—');
    const cols = (p: string) => [{ titre: p, poids: 3 }, { titre: 'Dispensations', align: 'droite' as const }, { titre: 'Montant total', align: 'droite' as const, poids: 1.4 }, { titre: 'Part assurance', align: 'droite' as const, poids: 1.4 }, { titre: '% assurance', align: 'droite' as const }];
    const ligne = (nom: string, l: { n: number; total: number; assurance: number }) => [nom, entier(l.n), francs(l.total), francs(l.assurance), taux(l.assurance, l.total)];
    return {
      titre: 'Rapport des dispensations de pharmacie',
      sousTitre: 'Volumes, montants, médicaments délivrés et anomalies de majoration (dispensations annulées exclues des montants)',
      organisation: ctx.organisationNom,
      filtres,
      genereLe: `${dateFr(new Date())} à ${new Date().toISOString().slice(11, 16)} UTC`,
      genererPar: ctx.auteur,
      sections: [
        {
          titre: 'Synthèse',
          indicateurs: [
            { libelle: 'Dispensations', valeur: entier(i.dispensations) },
            { libelle: 'Dispensations payées', valeur: `${entier(i.payees)} (${taux(i.payees, i.dispensations)})` },
            { libelle: 'Dispensations annulées', valeur: entier(i.annulees) },
            { libelle: 'Lignes de médicaments', valeur: entier(i.lignes) },
            { libelle: 'Montant total', valeur: francs(i.total) },
            { libelle: 'Part assurance', valeur: `${francs(i.assurance)} (${taux(i.assurance, i.total)})` },
            { libelle: 'Part des patients', valeur: francs(i.patient) },
            { libelle: 'Majorations anormales de prix', valeur: entier(i.majorationsAnormales) },
          ],
        },
        { titre: 'Évolution par mois', tableau: { colonnes: cols('Mois'), lignes: r.parMois.map((m) => ligne(m.mois, m)) } },
        { titre: 'Par statut', tableau: { colonnes: [{ titre: 'Statut', poids: 3 }, { titre: 'Dispensations', align: 'droite' }, { titre: 'Montant', align: 'droite', poids: 1.5 }], lignes: r.parStatut.map((s) => [LIBELLE_STATUT[s.statut] ?? s.statut, entier(s.n), francs(s.total)]) } },
        ...(ctx.pharmacieId ? [] : [{ titre: 'Par pharmacie', tableau: { colonnes: cols('Pharmacie'), lignes: r.parPharmacie.map((p) => ligne(p.nom, p)) } }]),
        { titre: 'Médicaments les plus délivrés (en montant)', tableau: { colonnes: [{ titre: 'Médicament', poids: 4 }, { titre: 'Quantité', align: 'droite' }, { titre: 'Montant', align: 'droite', poids: 1.5 }], lignes: r.medicaments.map((m) => [m.nom, entier(m.quantite), francs(m.montant)]) } },
        {
          titre: 'Détail des dispensations',
          tableau: {
            colonnes: [{ titre: 'Préparée le' }, { titre: 'Pharmacie', poids: 3 }, { titre: 'Statut', poids: 2 }, { titre: 'Lignes', align: 'droite', poids: 0.7 }, { titre: 'Montant', align: 'droite', poids: 1.3 }, { titre: 'Assurance', align: 'droite', poids: 1.3 }, { titre: 'Patient', align: 'droite', poids: 1.3 }, { titre: 'Payée le' }],
            lignes: r.detail.map((d) => [dateFr(d.date), d.pharmacie, LIBELLE_STATUT[d.statut] ?? d.statut, entier(d.lignes), francs(d.total), francs(d.assurance), francs(d.patient), dateFr(d.payee)]),
            note: r.detail.length >= LIMITE_DETAIL ? `Seules les ${LIMITE_DETAIL} dispensations les plus récentes sont détaillées ; affinez les critères pour les autres.` : undefined,
          },
        },
      ],
    };
  }

  async exporter(user: AuthenticatedUser, f: RapportDispensationsQueryDto, format: 'pdf' | 'docx') {
    const doc = await this.document(user, f);
    const buffer = format === 'pdf' ? await genererPdf(doc) : await genererDocx(doc);
    return {
      buffer,
      nomFichier: `rapport-dispensations-${new Date().toISOString().slice(0, 10)}.${format}`,
      type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
}
