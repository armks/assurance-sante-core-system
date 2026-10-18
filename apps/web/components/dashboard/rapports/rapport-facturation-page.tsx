import { CheckCircle2, Clock, FileDown, FileText, Receipt, Timer, Wallet, HandCoins } from 'lucide-react';
import Link from 'next/link';

import { CarteResume, GrilleCartes } from '@/components/dashboard/patterns';
import { CHAMP, dateFr, francs, nombre, periodesRapides, Tableau } from '@/components/dashboard/rapports/rapport-commun';
import {
  RapportFacturationGraphiques,
  type DonneesGraphiquesFacturation,
} from '@/components/dashboard/rapports/rapport-facturation-graphiques';
import { Button } from '@/components/ui/button';
import { apiFetch, messageErreur } from '@/lib/api';

type Parametres = Record<string, string | string[] | undefined>;
const CLES = ['du', 'au', 'type', 'prestataireId', 'statut'] as const;
type Filtres = Partial<Record<(typeof CLES)[number], string>>;

interface Options {
  etablissements: { id: string; nom: string }[];
  pharmacies: { id: string; nom: string }[];
  statuts: { valeur: string; libelle: string }[];
}

interface Rapport {
  indicateurs: { factures: number; total: number; paye: number; restant: number; payees: number; delaiMoyenJours: number | null };
  parStatut: { statut: string; n: number; total: number; paye: number }[];
  parType: { type: string; n: number; total: number; paye: number }[];
  parMois: { mois: string; n: number; total: number; paye: number }[];
  parPrestataire: { nom: string; type: string; n: number; total: number; paye: number }[];
  detail: { periode: string; type: string; prestataire: string; statut: string; total: number; paye: number; soumise: string | null; payee: string | null }[];
}

const LIBELLE_TYPE: Record<string, string> = { ETABLISSEMENT: 'Établissement', PHARMACIE: 'Pharmacie' };

function filtresDepuisUrl(sp: Parametres): Filtres {
  const f: Filtres = {};
  for (const cle of CLES) {
    const v = Array.isArray(sp[cle]) ? sp[cle]![0] : sp[cle];
    if (v && v.trim()) f[cle] = v.trim();
  }
  return f;
}

/**
 * Rapport de facturation mensuelle des prestataires : filtres multicritères (formulaire GET), synthèse, graphiques, tableaux et
 * export PDF / Word. Réservé aux profils de l'assureur habilités (contrôle côté API).
 */
export async function RapportFacturationPage({ searchParams, racine }: { searchParams: Promise<Parametres>; racine: string }) {
  const filtres = filtresDepuisUrl(await searchParams);
  const requete = new URLSearchParams(filtres as Record<string, string>).toString();
  const [resOptions, resRapport] = await Promise.all([
    apiFetch('/api/v1/reporting/facturation-mensuelle/options'),
    apiFetch(`/api/v1/reporting/facturation-mensuelle${requete ? `?${requete}` : ''}`),
  ]);
  if (!resOptions.ok || !resRapport.ok) {
    return <p className="text-sm text-destructive">{await messageErreur(resRapport.ok ? resOptions : resRapport)}</p>;
  }
  const options = (await resOptions.json()) as Options;
  const r = (await resRapport.json()) as Rapport;
  const i = r.indicateurs;
  const libStatut = Object.fromEntries(options.statuts.map((s) => [s.valeur, s.libelle]));
  const prestataires =
    filtres.type === 'PHARMACIE'
      ? options.pharmacies.map((p) => ({ valeur: p.id, libelle: p.nom }))
      : filtres.type === 'ETABLISSEMENT'
        ? options.etablissements.map((e) => ({ valeur: e.id, libelle: e.nom }))
        : [
            ...options.etablissements.map((e) => ({ valeur: e.id, libelle: `${e.nom} (établissement)` })),
            ...options.pharmacies.map((p) => ({ valeur: p.id, libelle: `${p.nom} (pharmacie)` })),
          ];
  const graphiques: DonneesGraphiquesFacturation = { parMois: r.parMois, parStatut: r.parStatut, parType: r.parType, parPrestataire: r.parPrestataire, libellesStatuts: libStatut };
  const lien = (extra: Record<string, string>) => `/api/rapports/facturation-mensuelle?${new URLSearchParams({ ...(filtres as Record<string, string>), ...extra }).toString()}`;
  const taux = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1).replace('.', ',')} %` : '—');
  const actif = Object.keys(filtres).length > 0;
  const colonnes = (premiere: string) => [premiere, 'Factures', 'Facturé', 'Payé', 'Restant dû'];
  const ligne = (nom: string, l: { n: number; total: number; paye: number }) => [nom, nombre(l.n), francs(l.total), francs(l.paye), francs(l.total - l.paye)];

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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="space-y-1 text-xs text-muted-foreground">
            Mois de facturation du
            <input type="date" name="du" defaultValue={filtres.du ?? ''} className={CHAMP} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            au
            <input type="date" name="au" defaultValue={filtres.au ?? ''} className={CHAMP} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Type de prestataire
            <select name="type" defaultValue={filtres.type ?? ''} className={CHAMP}>
              <option value="">Établissements et pharmacies</option>
              <option value="ETABLISSEMENT">Établissements de santé</option>
              <option value="PHARMACIE">Pharmacies</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Prestataire
            <select name="prestataireId" defaultValue={filtres.prestataireId ?? ''} className={CHAMP}>
              <option value="">Tous les prestataires</option>
              {prestataires.map((p) => (
                <option key={p.valeur} value={p.valeur}>
                  {p.libelle}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Statut
            <select name="statut" defaultValue={filtres.statut ?? ''} className={CHAMP}>
              <option value="">Tous les statuts</option>
              {options.statuts.map((s) => (
                <option key={s.valeur} value={s.valeur}>
                  {s.libelle}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit">Appliquer les critères</Button>
          {actif && (
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
        <CarteResume libelle="Factures mensuelles" valeur={nombre(i.factures)} icon={Receipt} />
        <CarteResume libelle="Montant facturé" valeur={francs(i.total)} icon={Wallet} />
        <CarteResume libelle="Montant payé" valeur={francs(i.paye)} icon={CheckCircle2} indice={taux(i.paye, i.total)} />
        <CarteResume libelle="Restant dû" valeur={francs(i.restant)} icon={HandCoins} />
        <CarteResume libelle="Factures payées" valeur={`${nombre(i.payees)} / ${nombre(i.factures)}`} icon={CheckCircle2} />
        <CarteResume libelle="Délai moyen de paiement" valeur={i.delaiMoyenJours === null ? '—' : `${Math.round(i.delaiMoyenJours)} jours`} icon={Timer} indice="de la soumission au paiement" />
        <CarteResume libelle="En attente de règlement" valeur={nombre(i.factures - i.payees)} icon={Clock} />
      </GrilleCartes>

      {i.factures > 0 ? (
        <>
          <RapportFacturationGraphiques donnees={graphiques} />
          <Tableau titre="Évolution par mois" colonnes={colonnes('Mois')} lignes={r.parMois.map((m) => ligne(m.mois, m))} />
          <div className="grid gap-6 lg:grid-cols-2">
            <Tableau titre="Par statut" colonnes={colonnes('Statut')} lignes={r.parStatut.map((s) => ligne(libStatut[s.statut] ?? s.statut, s))} />
            <Tableau titre="Par type de prestataire" colonnes={colonnes('Type')} lignes={r.parType.map((t) => ligne(LIBELLE_TYPE[t.type] ?? t.type, t))} />
          </div>
          <Tableau titre="Par prestataire" colonnes={colonnes('Prestataire')} lignes={r.parPrestataire.map((p) => ligne(`${p.nom} (${(LIBELLE_TYPE[p.type] ?? p.type).toLowerCase()})`, p))} />
          <Tableau
            titre={`Détail des factures (${nombre(Math.min(200, r.detail.length))} plus récentes sur ${nombre(i.factures)} — l’export contient jusqu’à 1 000 factures)`}
            colonnes={['Mois', 'Prestataire', 'Statut', 'Facturé', 'Payé', 'Soumise le', 'Payée le']}
            lignes={r.detail.slice(0, 200).map((d) => [d.periode, `${d.prestataire} (${(LIBELLE_TYPE[d.type] ?? d.type).toLowerCase()})`, libStatut[d.statut] ?? d.statut, francs(d.total), francs(d.paye), d.soumise ? dateFr(d.soumise) : '—', d.payee ? dateFr(d.payee) : '—'])}
          />
        </>
      ) : (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Aucune facture mensuelle ne correspond à ces critères.</p>
      )}
    </div>
  );
}
