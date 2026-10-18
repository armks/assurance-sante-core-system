import { Activity, ClipboardList, Coins, FileDown, FileText, FolderOpen, HandCoins, ShieldAlert, Stethoscope, Wallet } from 'lucide-react';
import Link from 'next/link';

import { CarteResume, GrilleCartes } from '@/components/dashboard/patterns';
import {
  RapportActiviteGraphiques,
  type DonneesGraphiquesActivite,
} from '@/components/dashboard/rapports/rapport-activite-graphiques';
import { CHAMP, francs, nombre, dateFr, periodesRapides, Tableau } from '@/components/dashboard/rapports/rapport-commun';
import { Button } from '@/components/ui/button';
import { apiFetch, messageErreur } from '@/lib/api';

type Parametres = Record<string, string | string[] | undefined>;

const CLES_FILTRES = ['du', 'au', 'etablissementId', 'souscripteurId', 'statut', 'categorieActe', 'statutPreautorisation', 'medecinId'] as const;
type Filtres = Partial<Record<(typeof CLES_FILTRES)[number], string>>;

interface Options {
  etablissements: { id: string; nom: string }[];
  societes: { id: string; nom: string }[];
  medecins: { id: string; nom: string }[];
  categories: { code: string; libelle: string }[];
  statuts: { valeur: string; libelle: string }[];
  statutsPreautorisation: { valeur: string; libelle: string }[];
}

interface Ligne {
  nom: string;
  dossiers?: number;
  actes: number;
  cout: number;
  assurance: number;
}

interface Rapport {
  indicateurs: { dossiers: number; consultations: number; actes: number; actesRefuses: number; actesEnAttente: number; cout: number; assurance: number; patient: number };
  parStatut: { statut: string; n: number }[];
  parCategorie: { categorie: string; actes: number; cout: number; assurance: number }[];
  parPreautorisation: { statut: string; n: number }[];
  parMois: { mois: string; dossiers: number; actes: number; cout: number; assurance: number }[];
  parEtablissement: Ligne[];
  parSociete: Ligne[];
  parMedecin: Ligne[];
  detail: { numero: string; date: string; statut: string; etablissement: string; societe: string; patient: string; actes: number; cout: number; assurance: number; patientPart: number }[];
  detailTotal: number;
}

/** Critères propres, issus de l'URL : seules les clés connues, sans valeur vide (l'API refuse une chaîne vide). */
function filtresDepuisUrl(sp: Parametres): Filtres {
  const f: Filtres = {};
  for (const cle of CLES_FILTRES) {
    const v = Array.isArray(sp[cle]) ? sp[cle]![0] : sp[cle];
    if (v && v.trim()) f[cle] = v.trim();
  }
  return f;
}

/**
 * Rapport d'activité des dossiers de soins : filtres multicritères (formulaire GET, sans JavaScript), synthèse, graphiques,
 * tableaux et export PDF / Word. Partagé par tous les profils autorisés ; le périmètre est imposé par l'API.
 */
export async function RapportActivitePage({ searchParams, racine }: { searchParams: Promise<Parametres>; racine: string }) {
  const filtres = filtresDepuisUrl(await searchParams);
  const requete = new URLSearchParams(filtres as Record<string, string>).toString();
  const [resOptions, resRapport] = await Promise.all([
    apiFetch('/api/v1/reporting/options'),
    apiFetch(`/api/v1/reporting/activite${requete ? `?${requete}` : ''}`),
  ]);
  if (!resOptions.ok || !resRapport.ok) {
    return <p className="text-sm text-destructive">{await messageErreur(resRapport.ok ? resOptions : resRapport)}</p>;
  }
  const options = (await resOptions.json()) as Options;
  const r = (await resRapport.json()) as Rapport;
  const i = r.indicateurs;
  const libCategorie = Object.fromEntries(options.categories.map((c) => [c.code, c.libelle]));
  const libPreauto = Object.fromEntries(options.statutsPreautorisation.map((s) => [s.valeur, s.libelle]));
  const libStatut = Object.fromEntries(options.statuts.map((s) => [s.valeur, s.libelle]));
  const graphiques: DonneesGraphiquesActivite = {
    parMois: r.parMois,
    parCategorie: r.parCategorie,
    parPreautorisation: r.parPreautorisation,
    parEtablissement: r.parEtablissement,
    libellesCategories: libCategorie,
    libellesPreautorisation: libPreauto,
  };
  const lien = (extra: Record<string, string>) => `/api/rapports/activite?${new URLSearchParams({ ...(filtres as Record<string, string>), ...extra }).toString()}`;
  const taux = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1).replace('.', ',')} %` : '—');
  const filtreActif = Object.keys(filtres).length > 0;
  const select = (nom: keyof Filtres, libelle: string, valeurs: { valeur: string; libelle: string }[], tous: string) => (
    <label className="space-y-1 text-xs text-muted-foreground">
      {libelle}
      <select name={nom} defaultValue={filtres[nom] ?? ''} className={CHAMP}>
        <option value="">{tous}</option>
        {valeurs.map((v) => (
          <option key={v.valeur} value={v.valeur}>
            {v.libelle}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-8">
      <form method="get" className="space-y-3 rounded-lg border bg-card p-4" aria-label="Critères du rapport">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-muted-foreground">Périodes rapides :</span>
          {periodesRapides().map((p) => (
            <Link key={p.libelle} href={`${racine}?du=${p.du}&au=${p.au}`} className="rounded-full border px-2.5 py-1 hover:bg-accent">
              {p.libelle}
            </Link>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-xs text-muted-foreground">
            Du
            <input type="date" name="du" defaultValue={filtres.du ?? ''} className={CHAMP} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Au
            <input type="date" name="au" defaultValue={filtres.au ?? ''} className={CHAMP} />
          </label>
          {select('etablissementId', 'Établissement', options.etablissements.map((e) => ({ valeur: e.id, libelle: e.nom })), 'Tous les établissements')}
          {options.societes.length > 0 && select('souscripteurId', 'Société cliente', options.societes.map((s) => ({ valeur: s.id, libelle: s.nom })), 'Toutes les sociétés')}
          {select('statut', 'Statut du dossier', options.statuts, 'Tous les statuts')}
          {select('categorieActe', 'Catégorie d’acte', options.categories.map((c) => ({ valeur: c.code, libelle: c.libelle })), 'Toutes les catégories')}
          {select('statutPreautorisation', 'Pré-autorisation', options.statutsPreautorisation, 'Toutes les décisions')}
          {select('medecinId', 'Médecin prescripteur', options.medecins.map((m) => ({ valeur: m.id, libelle: m.nom })), 'Tous les médecins')}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit">Appliquer les critères</Button>
          {filtreActif && (
            <Button asChild variant="ghost">
              <Link href={racine}>Réinitialiser</Link>
            </Button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <a href={lien({ format: 'pdf' })}>
                <FileDown className="size-4" aria-hidden="true" /> Exporter en PDF
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={lien({ format: 'docx' })}>
                <FileText className="size-4" aria-hidden="true" /> Exporter en Word
              </a>
            </Button>
          </div>
        </div>
      </form>

      <GrilleCartes>
        <CarteResume libelle="Dossiers de soins" valeur={nombre(i.dossiers)} icon={FolderOpen} />
        <CarteResume libelle="Consultations" valeur={nombre(i.consultations)} icon={Stethoscope} />
        <CarteResume libelle="Actes" valeur={nombre(i.actes)} icon={Activity} indice={`${nombre(i.actesRefuses)} refusé(s) · ${taux(i.actesRefuses, i.actes)}`} />
        <CarteResume libelle="En attente de décision" valeur={nombre(i.actesEnAttente)} icon={ShieldAlert} />
        <CarteResume libelle="Coût total" valeur={francs(i.cout)} icon={Coins} indice="actes non refusés" />
        <CarteResume libelle="Part assurance" valeur={francs(i.assurance)} icon={Wallet} indice={taux(i.assurance, i.cout)} />
        <CarteResume libelle="Part des assurés" valeur={francs(i.patient)} icon={HandCoins} />
        <CarteResume libelle="Coût moyen par dossier" valeur={i.dossiers > 0 ? francs(i.cout / i.dossiers) : '—'} icon={ClipboardList} />
      </GrilleCartes>

      {i.dossiers > 0 ? (
        <>
          <RapportActiviteGraphiques donnees={graphiques} />
          <Tableau
            titre="Évolution mensuelle"
            colonnes={['Mois', 'Dossiers', 'Actes', 'Coût total', 'Part assurance']}
            lignes={r.parMois.map((m) => [m.mois, nombre(m.dossiers), nombre(m.actes), francs(m.cout), francs(m.assurance)])}
          />
          <div className="grid gap-6 lg:grid-cols-2">
            <Tableau titre="Par catégorie d’acte" colonnes={['Catégorie', 'Actes', 'Coût total', 'Part assurance']} lignes={r.parCategorie.map((c) => [libCategorie[c.categorie] ?? c.categorie, nombre(c.actes), francs(c.cout), francs(c.assurance)])} />
            <Tableau titre="Par médecin prescripteur" colonnes={['Médecin', 'Actes', 'Coût total', 'Part assurance']} lignes={r.parMedecin.map((m) => [m.nom, nombre(m.actes), francs(m.cout), francs(m.assurance)])} />
          </div>
          {options.societes.length > 0 && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Tableau titre="Par établissement" colonnes={['Établissement', 'Dossiers', 'Coût total', 'Part assurance']} lignes={r.parEtablissement.map((e) => [e.nom, nombre(e.dossiers ?? 0), francs(e.cout), francs(e.assurance)])} />
              <Tableau titre="Par société cliente" colonnes={['Société', 'Dossiers', 'Coût total', 'Part assurance']} lignes={r.parSociete.map((s) => [s.nom, nombre(s.dossiers ?? 0), francs(s.cout), francs(s.assurance)])} />
            </div>
          )}
          <Tableau
            titre={`Détail des dossiers (${nombre(Math.min(200, r.detail.length))} plus récents sur ${nombre(r.detailTotal)} — l’export contient jusqu’à 1 000 dossiers)`}
            colonnes={['N° traitement', 'Ouverture', 'Statut', 'Établissement', 'Patient', 'Actes', 'Coût', 'Assurance']}
            lignes={r.detail.slice(0, 200).map((d) => [d.numero, dateFr(d.date), libStatut[d.statut] ?? d.statut, d.etablissement, d.patient, nombre(d.actes), francs(d.cout), francs(d.assurance)])}
          />
        </>
      ) : (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Aucun dossier ne correspond à ces critères. Élargissez la période ou retirez un critère.</p>
      )}
    </div>
  );
}
