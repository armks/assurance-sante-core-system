import { ForbiddenException, Injectable } from '@nestjs/common';
import { IsIn, IsOptional, IsUUID, Matches, MaxLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { genererDocx } from './docx';
import { genererPdf } from './pdf';
import { dateFr, entier, francs, pourcent, type RapportDocument } from './rapport-document';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Critères du relevé de soins de l'adhérent. */
export class RapportReleveQueryDto {
  @IsOptional()
  @Matches(DATE, { message: 'du doit être une date AAAA-MM-JJ' })
  du?: string;

  @IsOptional()
  @Matches(DATE, { message: 'au doit être une date AAAA-MM-JJ' })
  au?: string;

  /** Personne couverte : l'adhérent lui-même ou l'un de ses bénéficiaires. */
  @IsOptional()
  @IsUUID()
  personneId?: string;

  @IsOptional()
  @MaxLength(40)
  @Matches(/^[A-Z_]+$/, { message: 'categorieActe invalide' })
  categorieActe?: string;
}

export class ExportReleveQueryDto extends RapportReleveQueryDto {
  @IsIn(['pdf', 'docx'])
  format!: 'pdf' | 'docx';
}

const ROLES_ADHERENT = ['ADHERENT_TITULAIRE', 'SOUSCRIPTEUR_INDIVIDUEL'] as const;
const LIBELLE_LIEN: Record<string, string> = { TITULAIRE: 'Titulaire', CONJOINT: 'Conjoint(e)', ENFANT: 'Enfant', PERE: 'Père', MERE: 'Mère', AUTRE: 'Autre' };
const LIBELLE_STATUT_DISPENSATION: Record<string, string> = { EN_PREPARATION: 'En préparation', EN_ATTENTE_VALIDATION_PATIENT: 'En attente de votre code', VALIDEE: 'Validée', PAYEE: 'Payée', ANNULEE: 'Annulée' };
const LIMITE_DETAIL = 500;

export interface ReleveSoins {
  filtres: RapportReleveQueryDto;
  indicateurs: { dossiers: number; actes: number; cout: number; assurance: number; resteACharge: number; dispensations: number; medicamentsMontant: number; medicamentsAssurance: number; medicamentsResteACharge: number };
  parPersonne: { nom: string; lien: string; dossiers: number; actes: number; cout: number; assurance: number; resteACharge: number }[];
  parCategorie: { categorie: string; actes: number; cout: number; assurance: number }[];
  parMois: { mois: string; dossiers: number; cout: number; assurance: number; resteACharge: number }[];
  soins: { date: string; etablissement: string; personne: string; actes: number; cout: number; assurance: number; resteACharge: number }[];
  medicaments: { date: string; pharmacie: string; personne: string; statut: string; montant: number; assurance: number; resteACharge: number }[];
}

/**
 * Relevé personnel de soins d'un adhérent : ses soins en établissement et ses médicaments (lui et ses bénéficiaires) avec le
 * remboursé par l'assurance et le reste à charge. Périmètre strictement personnel : l'identifiant d'adhérent vient du profil
 * authentifié, jamais des critères.
 */
@Injectable()
export class ReleveReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  private async contexte(user: AuthenticatedUser) {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    const ok = (permissions?.roleChain ?? []).some((r) => (ROLES_ADHERENT as readonly string[]).includes(r));
    if (!ok || !profil.adherentId) throw new ForbiddenException('Le relevé de soins est réservé aux adhérents.');
    return { organisationId: profil.organisationId, adherentId: profil.adherentId, auteur: profil.pseudo ?? profil.email ?? 'adhérent' };
  }

  async options(user: AuthenticatedUser) {
    const ctx = await this.contexte(user);
    const [moi] = await this.prisma.$queryRaw<{ id: string; nom: string }[]>`SELECT id::text, prenom || ' ' || nom AS nom FROM adherents WHERE id = ${ctx.adherentId}::uuid`;
    const beneficiaires = await this.prisma.$queryRaw<{ id: string; nom: string; lien: string }[]>`
      SELECT id::text, prenom || ' ' || nom AS nom, lien_parente AS lien FROM beneficiaires WHERE adherent_id = ${ctx.adherentId}::uuid AND deleted_at IS NULL ORDER BY nom`;
    const categories = await this.prisma.$queryRaw<{ code: string; libelle: string }[]>`SELECT code, libelle FROM categories_acte ORDER BY libelle`;
    return {
      personnes: [{ id: moi?.id ?? ctx.adherentId, nom: `${moi?.nom ?? 'Moi'} (titulaire)`, lien: 'TITULAIRE' }, ...beneficiaires.map((b) => ({ ...b, nom: `${b.nom} (${(LIBELLE_LIEN[b.lien] ?? b.lien).toLowerCase()})` }))],
      categories,
    };
  }

  async releve(user: AuthenticatedUser, f: RapportReleveQueryDto): Promise<ReleveSoins> {
    const ctx = await this.contexte(user);
    return this.calculer(ctx.adherentId, f);
  }

  private async calculer(adherentId: string, f: RapportReleveQueryDto): Promise<ReleveSoins> {
    // personnes couvertes : l'adhérent et ses bénéficiaires ; un critère `personneId` étranger ne renvoie simplement rien
    const wd: Prisma.Sql[] = [Prisma.sql`d.deleted_at IS NULL`, Prisma.sql`(d.adherent_id = ${adherentId}::uuid OR d.beneficiaire_id IN (SELECT id FROM beneficiaires WHERE adherent_id = ${adherentId}::uuid))`];
    if (f.personneId) wd.push(Prisma.sql`(d.adherent_id = ${f.personneId}::uuid OR d.beneficiaire_id = ${f.personneId}::uuid)`);
    if (f.du) wd.push(Prisma.sql`d.date_ouverture >= ${f.du}::date`);
    if (f.au) wd.push(Prisma.sql`d.date_ouverture < (${f.au}::date + 1)`);
    const wa: Prisma.Sql[] = [Prisma.sql`a.deleted_at IS NULL`, Prisma.sql`a.statut_preautorisation <> 'REFUSEE'`];
    if (f.categorieActe) wa.push(Prisma.sql`a.categorie_acte = ${f.categorieActe}`);
    const dw = Prisma.join(wd, ' AND ');
    const aw = Prisma.join(wa, ' AND ');

    const lignes = await this.prisma.$queryRaw<{ r: unknown }[]>`
      WITH dos AS (
        SELECT d.id, d.date_ouverture, d.etablissement_id,
               COALESCE(b.id, ad.id) AS personne_id, COALESCE(b.prenom || ' ' || b.nom, ad.prenom || ' ' || ad.nom) AS personne,
               COALESCE(b.lien_parente, 'TITULAIRE') AS lien
        FROM dossiers_soins d LEFT JOIN beneficiaires b ON b.id = d.beneficiaire_id LEFT JOIN adherents ad ON ad.id = d.adherent_id
        WHERE ${dw}
      ), ac AS (
        SELECT a.dossier_soins_id, a.categorie_acte, (COALESCE(a.montant_prescrit, 0) * a.quantite)::float8 AS cout,
               COALESCE(a.montant_simule_assurance, 0)::float8 AS assurance, COALESCE(a.montant_simule_patient, 0)::float8 AS patient
        FROM actes_dossier a JOIN dos ON dos.id = a.dossier_soins_id WHERE ${aw}
      ), dis AS (
        SELECT dp.id, dp.statut, dp.date_preparation, ph.nom AS pharmacie, dos.personne,
               dp.montant_total::float8 AS montant,
               COALESCE((SELECT SUM(ld.montant_assurance) FROM lignes_dispensation ld WHERE ld.dispensation_id = dp.id), 0)::float8 AS assurance,
               COALESCE((SELECT SUM(ld.montant_patient) FROM lignes_dispensation ld WHERE ld.dispensation_id = dp.id), 0)::float8 AS patient
        FROM dispensations_pharmacie dp
        JOIN ordonnances o ON o.id = dp.ordonnance_id
        JOIN dos ON dos.id = o.dossier_soins_id
        JOIN pharmacies ph ON ph.id = dp.pharmacie_id
        WHERE dp.statut <> 'ANNULEE' ${f.categorieActe ? Prisma.sql`AND false` : Prisma.empty}
      )
      SELECT json_build_object(
        'indicateurs', json_build_object(
          'dossiers', (SELECT COUNT(DISTINCT dossier_soins_id)::int FROM ac),
          'actes', (SELECT COUNT(*)::int FROM ac),
          'cout', (SELECT COALESCE(SUM(cout), 0) FROM ac),
          'assurance', (SELECT COALESCE(SUM(assurance), 0) FROM ac),
          'resteACharge', (SELECT COALESCE(SUM(patient), 0) FROM ac),
          'dispensations', (SELECT COUNT(*)::int FROM dis),
          'medicamentsMontant', (SELECT COALESCE(SUM(montant), 0) FROM dis),
          'medicamentsAssurance', (SELECT COALESCE(SUM(assurance), 0) FROM dis),
          'medicamentsResteACharge', (SELECT COALESCE(SUM(patient), 0) FROM dis)),
        'parPersonne', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
            SELECT dos.personne AS nom, dos.lien, COUNT(DISTINCT dos.id)::int AS dossiers, COUNT(ac.dossier_soins_id)::int AS actes,
                   COALESCE(SUM(ac.cout), 0) AS cout, COALESCE(SUM(ac.assurance), 0) AS assurance, COALESCE(SUM(ac.patient), 0) AS "resteACharge"
            FROM dos LEFT JOIN ac ON ac.dossier_soins_id = dos.id GROUP BY 1, 2 ORDER BY 5 DESC) x),
        'parCategorie', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
            SELECT categorie_acte AS categorie, COUNT(*)::int AS actes, SUM(cout) AS cout, SUM(assurance) AS assurance FROM ac GROUP BY 1 ORDER BY 3 DESC) x),
        'parMois', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
            SELECT to_char(date_trunc('month', dos.date_ouverture), 'YYYY-MM') AS mois, COUNT(DISTINCT dos.id)::int AS dossiers,
                   COALESCE(SUM(ac.cout), 0) AS cout, COALESCE(SUM(ac.assurance), 0) AS assurance, COALESCE(SUM(ac.patient), 0) AS "resteACharge"
            FROM dos LEFT JOIN ac ON ac.dossier_soins_id = dos.id GROUP BY 1 ORDER BY 1) x),
        'soins', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
            SELECT dos.date_ouverture AS date, e.nom AS etablissement, dos.personne, COUNT(ac.dossier_soins_id)::int AS actes,
                   COALESCE(SUM(ac.cout), 0) AS cout, COALESCE(SUM(ac.assurance), 0) AS assurance, COALESCE(SUM(ac.patient), 0) AS "resteACharge"
            FROM dos JOIN etablissements_sante e ON e.id = dos.etablissement_id LEFT JOIN ac ON ac.dossier_soins_id = dos.id
            GROUP BY dos.id, dos.date_ouverture, e.nom, dos.personne ORDER BY dos.date_ouverture DESC LIMIT ${LIMITE_DETAIL}) x),
        'medicaments', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
            SELECT date_preparation AS date, pharmacie, personne, statut, montant, assurance, patient AS "resteACharge" FROM dis ORDER BY date_preparation DESC LIMIT ${LIMITE_DETAIL}) x)
      ) AS r`;
    return { filtres: f, ...(lignes[0].r as Omit<ReleveSoins, 'filtres'>) };
  }

  async document(user: AuthenticatedUser, f: RapportReleveQueryDto): Promise<RapportDocument> {
    const ctx = await this.contexte(user);
    const [r, opt, [org]] = await Promise.all([
      this.calculer(ctx.adherentId, f),
      this.options(user),
      this.prisma.$queryRaw<{ nom: string }[]>`SELECT nom FROM organisations WHERE id = ${ctx.organisationId}::uuid`,
    ]);
    const filtres: { libelle: string; valeur: string }[] = [{ libelle: 'Période', valeur: f.du || f.au ? `${f.du ? dateFr(f.du) : 'début'} au ${f.au ? dateFr(f.au) : 'ce jour'}` : 'Toute période' }];
    if (f.personneId) filtres.push({ libelle: 'Personne', valeur: opt.personnes.find((p) => p.id === f.personneId)?.nom ?? '—' });
    if (f.categorieActe) filtres.push({ libelle: 'Catégorie d’acte', valeur: opt.categories.find((c) => c.code === f.categorieActe)?.libelle ?? f.categorieActe });
    const i = r.indicateurs;
    const taux = (a: number, b: number) => (b > 0 ? pourcent((a / b) * 100) : '—');
    const libCat = Object.fromEntries(opt.categories.map((c) => [c.code, c.libelle]));
    return {
      titre: 'Relevé de mes soins',
      sousTitre: 'Soins en établissement et médicaments : remboursé par votre assurance et reste à votre charge',
      organisation: org?.nom ?? 'Assureur',
      filtres,
      genereLe: `${dateFr(new Date())} à ${new Date().toISOString().slice(11, 16)} UTC`,
      genererPar: ctx.auteur,
      sections: [
        {
          titre: 'Synthèse',
          indicateurs: [
            { libelle: 'Dossiers de soins', valeur: entier(i.dossiers) },
            { libelle: 'Actes', valeur: entier(i.actes) },
            { libelle: 'Coût des soins', valeur: francs(i.cout) },
            { libelle: 'Pris en charge par l’assurance', valeur: `${francs(i.assurance)} (${taux(i.assurance, i.cout)})` },
            { libelle: 'Reste à votre charge (soins)', valeur: francs(i.resteACharge) },
            { libelle: 'Dispensations de médicaments', valeur: entier(i.dispensations) },
            { libelle: 'Médicaments : pris en charge', valeur: francs(i.medicamentsAssurance) },
            { libelle: 'Médicaments : reste à votre charge', valeur: francs(i.medicamentsResteACharge) },
          ],
        },
        { titre: 'Par personne couverte', tableau: { colonnes: [{ titre: 'Personne', poids: 3 }, { titre: 'Lien' }, { titre: 'Dossiers', align: 'droite' }, { titre: 'Actes', align: 'droite' }, { titre: 'Coût', align: 'droite', poids: 1.3 }, { titre: 'Assurance', align: 'droite', poids: 1.3 }, { titre: 'Reste à charge', align: 'droite', poids: 1.3 }], lignes: r.parPersonne.map((p) => [p.nom, LIBELLE_LIEN[p.lien] ?? p.lien, entier(p.dossiers), entier(p.actes), francs(p.cout), francs(p.assurance), francs(p.resteACharge)]) } },
        { titre: 'Par mois', tableau: { colonnes: [{ titre: 'Mois', poids: 2 }, { titre: 'Dossiers', align: 'droite' }, { titre: 'Coût', align: 'droite', poids: 1.3 }, { titre: 'Assurance', align: 'droite', poids: 1.3 }, { titre: 'Reste à charge', align: 'droite', poids: 1.3 }], lignes: r.parMois.map((m) => [m.mois, entier(m.dossiers), francs(m.cout), francs(m.assurance), francs(m.resteACharge)]), total: ['Total', entier(i.dossiers), francs(i.cout), francs(i.assurance), francs(i.resteACharge)] } },
        { titre: 'Par catégorie d’acte', tableau: { colonnes: [{ titre: 'Catégorie', poids: 3 }, { titre: 'Actes', align: 'droite' }, { titre: 'Coût', align: 'droite', poids: 1.3 }, { titre: 'Assurance', align: 'droite', poids: 1.3 }], lignes: r.parCategorie.map((c) => [libCat[c.categorie] ?? c.categorie, entier(c.actes), francs(c.cout), francs(c.assurance)]) } },
        { titre: 'Détail de mes soins', tableau: { colonnes: [{ titre: 'Date' }, { titre: 'Établissement', poids: 3 }, { titre: 'Personne', poids: 2.5 }, { titre: 'Actes', align: 'droite', poids: 0.7 }, { titre: 'Coût', align: 'droite', poids: 1.2 }, { titre: 'Assurance', align: 'droite', poids: 1.2 }, { titre: 'Reste à charge', align: 'droite', poids: 1.2 }], lignes: r.soins.map((s) => [dateFr(s.date), s.etablissement, s.personne, entier(s.actes), francs(s.cout), francs(s.assurance), francs(s.resteACharge)]) } },
        ...(r.medicaments.length ? [{ titre: 'Détail de mes médicaments', tableau: { colonnes: [{ titre: 'Date' }, { titre: 'Pharmacie', poids: 3 }, { titre: 'Personne', poids: 2.5 }, { titre: 'Statut', poids: 1.6 }, { titre: 'Montant', align: 'droite' as const, poids: 1.2 }, { titre: 'Assurance', align: 'droite' as const, poids: 1.2 }, { titre: 'Reste à charge', align: 'droite' as const, poids: 1.2 }], lignes: r.medicaments.map((m) => [dateFr(m.date), m.pharmacie, m.personne, LIBELLE_STATUT_DISPENSATION[m.statut] ?? m.statut, francs(m.montant), francs(m.assurance), francs(m.resteACharge)]) } }] : []),
      ],
    };
  }

  async exporter(user: AuthenticatedUser, f: RapportReleveQueryDto, format: 'pdf' | 'docx') {
    const doc = await this.document(user, f);
    const buffer = format === 'pdf' ? await genererPdf(doc) : await genererDocx(doc);
    return {
      buffer,
      nomFichier: `releve-de-soins-${new Date().toISOString().slice(0, 10)}.${format}`,
      type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
}
