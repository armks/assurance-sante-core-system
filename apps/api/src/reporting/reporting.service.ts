import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { ROLES_CENTRE_MEDICAL, ROLES_LECTURE_DOSSIER_STAFF } from '../care-episode/care-episode.types';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { genererDocx } from './docx';
import { genererPdf } from './pdf';
import { dateFr, entier, francs, pourcent, type RapportDocument } from './rapport-document';
import type { RapportActiviteQueryDto } from './reporting.dto';

interface Contexte {
  userId: string;
  organisationId: string;
  organisationNom: string;
  etablissementId: string | null;
  /** personnel de centre médical : lecture limitée à son établissement */
  limiteEtablissement: boolean;
  auteur: string;
}

export interface RapportActivite {
  filtres: RapportActiviteQueryDto;
  genereLe: string;
  indicateurs: {
    dossiers: number;
    consultations: number;
    actes: number;
    actesRefuses: number;
    actesEnAttente: number;
    cout: number;
    assurance: number;
    patient: number;
  };
  parStatut: { statut: string; n: number }[];
  parCategorie: { categorie: string; actes: number; cout: number; assurance: number }[];
  parPreautorisation: { statut: string; n: number }[];
  parMois: { mois: string; dossiers: number; actes: number; cout: number; assurance: number }[];
  parEtablissement: { nom: string; dossiers: number; actes: number; cout: number; assurance: number }[];
  parSociete: { nom: string; dossiers: number; actes: number; cout: number; assurance: number }[];
  parMedecin: { nom: string; actes: number; cout: number; assurance: number }[];
  detail: {
    numero: string;
    date: string;
    statut: string;
    etablissement: string;
    societe: string;
    patient: string;
    actes: number;
    cout: number;
    assurance: number;
    patientPart: number;
  }[];
  detailTotal: number;
}

const LIBELLE_STATUT_DOSSIER: Record<string, string> = { OUVERT: 'Ouvert', SUSPENDU: 'Suspendu', TRANSFERE: 'Transféré', CLOTURE: 'Clôturé', FORCE_CLOS: 'Clôturé de force' };
const LIBELLE_PREAUTORISATION: Record<string, string> = {
  NON_REQUISE: 'Non requise',
  EN_ATTENTE_EXPLOITATION: 'En attente exploitation',
  EN_ATTENTE_MEDECIN_CONSEIL: 'En attente médecin conseil',
  APPROUVEE: 'Approuvée',
  APPROUVEE_PARTIELLEMENT: 'Approuvée partiellement',
  REFUSEE: 'Refusée',
};
const LIMITE_DETAIL = 1000;

/**
 * Rapports et statistiques à critères multiples (période, établissement, société cliente, statut, catégorie d'acte,
 * pré-autorisation, médecin prescripteur). Toutes les agrégations se font en SQL (une requête) ; les exports PDF et Word
 * reprennent exactement les mêmes chiffres que l'écran.
 */
@Injectable()
export class ReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  private async contexte(user: AuthenticatedUser): Promise<Contexte> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    const roles = permissions?.roleChain ?? [];
    const estStaff = roles.some((r) => (ROLES_LECTURE_DOSSIER_STAFF as readonly string[]).includes(r));
    const estCentre = roles.some((r) => (ROLES_CENTRE_MEDICAL as readonly string[]).includes(r)) && !!profil.etablissementId;
    if (!estStaff && !estCentre) {
      throw new ForbiddenException('Les rapports sont réservés au personnel habilité de l’assureur ou de l’établissement.');
    }
    return {
      userId: profil.id,
      organisationId: profil.organisationId,
      organisationNom: profil.organisationNom ?? 'Assureur',
      etablissementId: profil.etablissementId ?? null,
      limiteEtablissement: !estStaff,
      auteur: profil.pseudo ?? profil.email ?? 'utilisateur',
    };
  }

  /** Listes de choix des filtres (établissements, sociétés, médecins, catégories d'acte). */
  async options(user: AuthenticatedUser) {
    const ctx = await this.contexte(user);
    const etab = ctx.limiteEtablissement ? Prisma.sql`AND e.id = ${ctx.etablissementId}::uuid` : Prisma.empty;
    const [etablissements, societes, medecins, categories] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; nom: string }[]>`
        SELECT e.id::text, e.nom FROM etablissements_sante e WHERE e.organisation_id = ${ctx.organisationId}::uuid AND e.deleted_at IS NULL ${etab} ORDER BY e.nom`,
      ctx.limiteEtablissement
        ? Promise.resolve([] as { id: string; nom: string }[])
        : this.prisma.$queryRaw<{ id: string; nom: string }[]>`
            SELECT s.id::text, s.nom FROM souscripteurs s WHERE s.organisation_id = ${ctx.organisationId}::uuid AND s.deleted_at IS NULL ORDER BY s.nom`,
      this.prisma.$queryRaw<{ id: string; nom: string }[]>`
        SELECT p.id::text, COALESCE(p.pseudo, p.numero_ordre_medecin, 'Médecin ' || left(p.id::text, 6)) AS nom
        FROM profils p
        WHERE p.organisation_id = ${ctx.organisationId}::uuid AND p.role = 'CENTRE_MEDICAL_MEDECIN' AND p.deleted_at IS NULL
          ${ctx.limiteEtablissement ? Prisma.sql`AND p.etablissement_id = ${ctx.etablissementId}::uuid` : Prisma.empty}
        ORDER BY 2`,
      this.prisma.$queryRaw<{ code: string; libelle: string }[]>`SELECT code, libelle FROM categories_acte ORDER BY libelle`,
    ]);
    return {
      etablissements,
      societes,
      medecins,
      categories,
      statuts: Object.entries(LIBELLE_STATUT_DOSSIER).map(([valeur, libelle]) => ({ valeur, libelle })),
      statutsPreautorisation: Object.entries(LIBELLE_PREAUTORISATION).map(([valeur, libelle]) => ({ valeur, libelle })),
    };
  }

  async activite(user: AuthenticatedUser, filtres: RapportActiviteQueryDto): Promise<RapportActivite> {
    const ctx = await this.contexte(user);
    return this.calculerActivite(ctx, filtres);
  }

  private async calculerActivite(ctx: Contexte, f: RapportActiviteQueryDto): Promise<RapportActivite> {
    const dossierWhere: Prisma.Sql[] = [Prisma.sql`d.organisation_id = ${ctx.organisationId}::uuid`, Prisma.sql`d.deleted_at IS NULL`];
    // le personnel d'un centre médical ne voit jamais un autre établissement, quel que soit le critère transmis
    const etab = ctx.limiteEtablissement ? ctx.etablissementId : f.etablissementId;
    if (etab) dossierWhere.push(Prisma.sql`d.etablissement_id = ${etab}::uuid`);
    if (f.du) dossierWhere.push(Prisma.sql`d.date_ouverture >= ${f.du}::date`);
    if (f.au) dossierWhere.push(Prisma.sql`d.date_ouverture < (${f.au}::date + 1)`);
    if (f.statut) dossierWhere.push(Prisma.sql`d.statut = ${f.statut}`);
    if (f.souscripteurId && !ctx.limiteEtablissement) dossierWhere.push(Prisma.sql`po.souscripteur_id = ${f.souscripteurId}::uuid`);

    const acteWhere: Prisma.Sql[] = [Prisma.sql`a.deleted_at IS NULL`];
    if (f.categorieActe) acteWhere.push(Prisma.sql`a.categorie_acte = ${f.categorieActe}`);
    if (f.statutPreautorisation) acteWhere.push(Prisma.sql`a.statut_preautorisation = ${f.statutPreautorisation}`);
    if (f.medecinId) acteWhere.push(Prisma.sql`a.medecin_prescripteur_id = ${f.medecinId}::uuid`);
    const filtreActes = !!(f.categorieActe || f.statutPreautorisation || f.medecinId);
    const dw = Prisma.join(dossierWhere, ' AND ');
    const aw = Prisma.join(acteWhere, ' AND ');

    const lignes = await this.prisma.$queryRaw<{ r: unknown }[]>`
      WITH dos AS (
        SELECT d.id, d.numero_traitement, d.statut, d.date_ouverture, d.etablissement_id, d.adherent_id, d.beneficiaire_id, po.souscripteur_id
        FROM dossiers_soins d JOIN polices po ON po.id = d.police_id
        WHERE ${dw}
        ${filtreActes ? Prisma.sql`AND EXISTS (SELECT 1 FROM actes_dossier a WHERE a.dossier_soins_id = d.id AND ${aw})` : Prisma.empty}
      ), ac AS (
        SELECT a.id, a.dossier_soins_id, a.categorie_acte, a.statut_preautorisation, a.medecin_prescripteur_id,
               (COALESCE(a.montant_prescrit, 0) * a.quantite)::float8 AS cout,
               COALESCE(a.montant_simule_assurance, 0)::float8 AS assurance,
               COALESCE(a.montant_simule_patient, 0)::float8 AS patient
        FROM actes_dossier a JOIN dos ON dos.id = a.dossier_soins_id
        WHERE ${aw}
      ), acn AS (SELECT * FROM ac WHERE statut_preautorisation <> 'REFUSEE')
      SELECT json_build_object(
        'indicateurs', json_build_object(
          'dossiers', (SELECT COUNT(*)::int FROM dos),
          'consultations', (SELECT COUNT(*)::int FROM consultations_dossier c JOIN dos ON dos.id = c.dossier_soins_id WHERE c.deleted_at IS NULL),
          'actes', (SELECT COUNT(*)::int FROM ac),
          'actesRefuses', (SELECT COUNT(*)::int FROM ac WHERE statut_preautorisation = 'REFUSEE'),
          'actesEnAttente', (SELECT COUNT(*)::int FROM ac WHERE statut_preautorisation LIKE 'EN_ATTENTE%'),
          'cout', (SELECT COALESCE(SUM(cout), 0) FROM acn),
          'assurance', (SELECT COALESCE(SUM(assurance), 0) FROM acn),
          'patient', (SELECT COALESCE(SUM(patient), 0) FROM acn)
        ),
        'parStatut', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (SELECT statut, COUNT(*)::int AS n FROM dos GROUP BY 1 ORDER BY 2 DESC) x),
        'parCategorie', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
          SELECT ac.categorie_acte AS categorie, COUNT(*)::int AS actes,
                 COALESCE(SUM(ac.cout) FILTER (WHERE ac.statut_preautorisation <> 'REFUSEE'), 0)::float8 AS cout,
                 COALESCE(SUM(ac.assurance) FILTER (WHERE ac.statut_preautorisation <> 'REFUSEE'), 0)::float8 AS assurance
          FROM ac GROUP BY 1 ORDER BY 3 DESC) x),
        'parPreautorisation', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (SELECT statut_preautorisation AS statut, COUNT(*)::int AS n FROM ac GROUP BY 1 ORDER BY 2 DESC) x),
        'parMois', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
          SELECT to_char(date_trunc('month', dos.date_ouverture), 'YYYY-MM') AS mois, COUNT(DISTINCT dos.id)::int AS dossiers, COUNT(acn.id)::int AS actes,
                 COALESCE(SUM(acn.cout), 0)::float8 AS cout, COALESCE(SUM(acn.assurance), 0)::float8 AS assurance
          FROM dos LEFT JOIN acn ON acn.dossier_soins_id = dos.id GROUP BY 1 ORDER BY 1) x),
        'parEtablissement', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
          SELECT e.nom, COUNT(DISTINCT dos.id)::int AS dossiers, COUNT(acn.id)::int AS actes,
                 COALESCE(SUM(acn.cout), 0)::float8 AS cout, COALESCE(SUM(acn.assurance), 0)::float8 AS assurance
          FROM dos JOIN etablissements_sante e ON e.id = dos.etablissement_id LEFT JOIN acn ON acn.dossier_soins_id = dos.id
          GROUP BY e.nom ORDER BY 4 DESC LIMIT 30) x),
        'parSociete', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
          SELECT s.nom, COUNT(DISTINCT dos.id)::int AS dossiers, COUNT(acn.id)::int AS actes,
                 COALESCE(SUM(acn.cout), 0)::float8 AS cout, COALESCE(SUM(acn.assurance), 0)::float8 AS assurance
          FROM dos JOIN souscripteurs s ON s.id = dos.souscripteur_id LEFT JOIN acn ON acn.dossier_soins_id = dos.id
          GROUP BY s.nom ORDER BY 4 DESC LIMIT 30) x),
        'parMedecin', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
          SELECT COALESCE(p.pseudo, p.numero_ordre_medecin, 'Non renseigné') AS nom, COUNT(*)::int AS actes,
                 COALESCE(SUM(acn.cout), 0)::float8 AS cout, COALESCE(SUM(acn.assurance), 0)::float8 AS assurance
          FROM acn LEFT JOIN profils p ON p.id = acn.medecin_prescripteur_id GROUP BY 1 ORDER BY 3 DESC LIMIT 30) x),
        'detail', (SELECT COALESCE(json_agg(r ORDER BY r.date DESC), '[]'::json) FROM (
          SELECT dos.numero_traitement AS numero, dos.date_ouverture AS date, dos.statut, e.nom AS etablissement, COALESCE(s.nom, '—') AS societe,
                 COALESCE(b.prenom || ' ' || b.nom, ad.prenom || ' ' || ad.nom, '—') AS patient,
                 COUNT(acn.id)::int AS actes, COALESCE(SUM(acn.cout), 0)::float8 AS cout,
                 COALESCE(SUM(acn.assurance), 0)::float8 AS assurance, COALESCE(SUM(acn.patient), 0)::float8 AS "patientPart"
          FROM dos
          JOIN etablissements_sante e ON e.id = dos.etablissement_id
          LEFT JOIN souscripteurs s ON s.id = dos.souscripteur_id
          LEFT JOIN adherents ad ON ad.id = dos.adherent_id
          LEFT JOIN beneficiaires b ON b.id = dos.beneficiaire_id
          LEFT JOIN acn ON acn.dossier_soins_id = dos.id
          GROUP BY dos.id, dos.numero_traitement, dos.date_ouverture, dos.statut, e.nom, s.nom, b.prenom, b.nom, ad.prenom, ad.nom
          ORDER BY dos.date_ouverture DESC LIMIT ${LIMITE_DETAIL}) r)
      ) AS r`;
    const r = lignes[0].r as Omit<RapportActivite, 'filtres' | 'genereLe' | 'detailTotal'>;
    return {
      filtres: f,
      genereLe: new Date().toISOString(),
      ...r,
      detailTotal: r.indicateurs.dossiers,
    };
  }

  /** Libellés lisibles des critères appliqués (en-tête des exports). */
  private async libellesFiltres(ctx: Contexte, f: RapportActiviteQueryDto) {
    const out: { libelle: string; valeur: string }[] = [];
    out.push({ libelle: 'Période', valeur: f.du || f.au ? `${f.du ? dateFr(f.du) : 'début'} au ${f.au ? dateFr(f.au) : 'ce jour'}` : 'Toute période' });
    const etabId = ctx.limiteEtablissement ? ctx.etablissementId : f.etablissementId;
    if (etabId) {
      const [e] = await this.prisma.$queryRaw<{ nom: string }[]>`SELECT nom FROM etablissements_sante WHERE id = ${etabId}::uuid`;
      out.push({ libelle: 'Établissement', valeur: e?.nom ?? '—' });
    }
    if (f.souscripteurId && !ctx.limiteEtablissement) {
      const [s] = await this.prisma.$queryRaw<{ nom: string }[]>`SELECT nom FROM souscripteurs WHERE id = ${f.souscripteurId}::uuid`;
      out.push({ libelle: 'Société cliente', valeur: s?.nom ?? '—' });
    }
    if (f.statut) out.push({ libelle: 'Statut du dossier', valeur: LIBELLE_STATUT_DOSSIER[f.statut] ?? f.statut });
    if (f.categorieActe) {
      const [c] = await this.prisma.$queryRaw<{ libelle: string }[]>`SELECT libelle FROM categories_acte WHERE code = ${f.categorieActe}`;
      out.push({ libelle: 'Catégorie d’acte', valeur: c?.libelle ?? f.categorieActe });
    }
    if (f.statutPreautorisation) out.push({ libelle: 'Pré-autorisation', valeur: LIBELLE_PREAUTORISATION[f.statutPreautorisation] ?? f.statutPreautorisation });
    if (f.medecinId) {
      const [m] = await this.prisma.$queryRaw<{ nom: string }[]>`SELECT COALESCE(pseudo, numero_ordre_medecin, 'Médecin') AS nom FROM profils WHERE id = ${f.medecinId}::uuid`;
      out.push({ libelle: 'Médecin prescripteur', valeur: m?.nom ?? '—' });
    }
    return out;
  }

  /** Document imprimable du rapport d'activité (mêmes chiffres que l'écran). */
  async documentActivite(user: AuthenticatedUser, f: RapportActiviteQueryDto): Promise<RapportDocument> {
    const ctx = await this.contexte(user);
    const [r, filtres] = await Promise.all([this.calculerActivite(ctx, f), this.libellesFiltres(ctx, f)]);
    const i = r.indicateurs;
    const taux = (a: number, b: number) => (b > 0 ? pourcent((a / b) * 100) : '—');
    const ligneStat = (nom: string, l: { dossiers?: number; actes: number; cout: number; assurance: number }) => [nom, ...(l.dossiers !== undefined ? [entier(l.dossiers)] : []), entier(l.actes), francs(l.cout), francs(l.assurance), taux(l.assurance, l.cout)];
    const colStat = (premiere: string, avecDossiers: boolean) => [
      { titre: premiere, poids: 3 },
      ...(avecDossiers ? [{ titre: 'Dossiers', align: 'droite' as const }] : []),
      { titre: 'Actes', align: 'droite' as const },
      { titre: 'Coût total', align: 'droite' as const, poids: 1.4 },
      { titre: 'Part assurance', align: 'droite' as const, poids: 1.4 },
      { titre: '% assurance', align: 'droite' as const },
    ];
    return {
      titre: 'Rapport d’activité — dossiers de soins',
      sousTitre: 'Dossiers, consultations, actes et coûts sur la période et les critères choisis',
      organisation: ctx.organisationNom,
      filtres,
      genereLe: `${dateFr(new Date())} à ${new Date().toISOString().slice(11, 16)} UTC`,
      genererPar: ctx.auteur,
      sections: [
        {
          titre: 'Synthèse',
          indicateurs: [
            { libelle: 'Dossiers de soins', valeur: entier(i.dossiers) },
            { libelle: 'Consultations', valeur: entier(i.consultations) },
            { libelle: 'Actes', valeur: entier(i.actes) },
            { libelle: 'Actes refusés', valeur: `${entier(i.actesRefuses)} (${taux(i.actesRefuses, i.actes)})` },
            { libelle: 'Coût total (hors refusés)', valeur: francs(i.cout) },
            { libelle: 'Part assurance', valeur: francs(i.assurance) },
            { libelle: 'Part assurés', valeur: francs(i.patient) },
            { libelle: 'Actes en attente de décision', valeur: entier(i.actesEnAttente) },
          ],
        },
        {
          titre: 'Évolution mensuelle',
          tableau: { colonnes: colStat('Mois', true), lignes: r.parMois.map((m) => ligneStat(m.mois, m)), total: ligneStat('Total', { dossiers: i.dossiers, actes: r.parMois.reduce((s, m) => s + m.actes, 0), cout: i.cout, assurance: i.assurance }) },
        },
        { titre: 'Dossiers par statut', tableau: { colonnes: [{ titre: 'Statut', poids: 3 }, { titre: 'Dossiers', align: 'droite' }], lignes: r.parStatut.map((s) => [LIBELLE_STATUT_DOSSIER[s.statut] ?? s.statut, entier(s.n)]) } },
        { titre: 'Actes par catégorie', tableau: { colonnes: colStat('Catégorie', false), lignes: r.parCategorie.map((c) => ligneStat(c.categorie, c)) } },
        { titre: 'Décisions de pré-autorisation', tableau: { colonnes: [{ titre: 'Statut', poids: 3 }, { titre: 'Actes', align: 'droite' }], lignes: r.parPreautorisation.map((p) => [LIBELLE_PREAUTORISATION[p.statut] ?? p.statut, entier(p.n)]) } },
        ...(ctx.limiteEtablissement ? [] : [{ titre: 'Par établissement', tableau: { colonnes: colStat('Établissement', true), lignes: r.parEtablissement.map((e) => ligneStat(e.nom, e)) } }]),
        ...(ctx.limiteEtablissement ? [] : [{ titre: 'Par société cliente', tableau: { colonnes: colStat('Société', true), lignes: r.parSociete.map((s) => ligneStat(s.nom, s)) } }]),
        { titre: 'Par médecin prescripteur', tableau: { colonnes: colStat('Médecin', false), lignes: r.parMedecin.map((m) => ligneStat(m.nom, m)) } },
        {
          titre: 'Détail des dossiers',
          tableau: {
            colonnes: [
              { titre: 'N° traitement', poids: 1.6 }, { titre: 'Ouverture' }, { titre: 'Statut', poids: 1.2 }, { titre: 'Établissement', poids: 2 }, { titre: 'Société', poids: 2 }, { titre: 'Patient', poids: 2 },
              { titre: 'Actes', align: 'droite', poids: 0.6 }, { titre: 'Coût', align: 'droite', poids: 1.2 }, { titre: 'Assurance', align: 'droite', poids: 1.2 }, { titre: 'Assuré', align: 'droite', poids: 1.2 },
            ],
            lignes: r.detail.map((d) => [d.numero, dateFr(d.date), LIBELLE_STATUT_DOSSIER[d.statut] ?? d.statut, d.etablissement, d.societe, d.patient, entier(d.actes), francs(d.cout), francs(d.assurance), francs(d.patientPart)]),
            note: r.detailTotal > r.detail.length ? `Seuls les ${r.detail.length} dossiers les plus récents sur ${entier(r.detailTotal)} sont détaillés ; affinez les critères pour les autres.` : undefined,
          },
        },
      ],
    };
  }

  async exporter(user: AuthenticatedUser, f: RapportActiviteQueryDto, format: 'pdf' | 'docx') {
    const doc = await this.documentActivite(user, f);
    const buffer = format === 'pdf' ? await genererPdf(doc) : await genererDocx(doc);
    const date = new Date().toISOString().slice(0, 10);
    return {
      buffer,
      nomFichier: `rapport-activite-${date}.${format}`,
      type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
}
