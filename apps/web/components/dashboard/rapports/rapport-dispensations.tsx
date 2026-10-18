import { AlertTriangle, CheckCircle2, Coins, FileDown, FileText, HandCoins, Pill, ReceiptText, Wallet } from 'lucide-react';
import Link from 'next/link';

import { CarteResume, GrilleCartes } from '@/components/dashboard/patterns';
import { CHAMP, dateFr, francs, nombre, periodesRapides, Tableau } from '@/components/dashboard/rapports/rapport-commun';
import { RapportDispensationsGraphiques } from '@/components/dashboard/rapports/rapport-dispensations-graphiques';
import { Button } from '@/components/ui/button';
import { apiFetch, messageErreur } from '@/lib/api';

type Parametres = Record<string, string | string[] | undefined>;
const CLES = ['du', 'au', 'pharmacieId', 'statut'] as const;
const LIBELLE_STATUT: Record<string, string> = {
  EN_PREPARATION: 'En préparation',
  EN_ATTENTE_VALIDATION_PATIENT: 'En attente du patient',
  VALIDEE: 'Validée — à payer',
  PAYEE: 'Payée',
  ANNULEE: 'Annulée',
};

interface Rapport {
  indicateurs: { dispensations: number; payees: number; annulees: number; lignes: number; total: number; assurance: number; patient: number; majorationsAnormales: number };
  parStatut: { statut: string; n: number; total: number }[];
  parMois: { mois: string; n: number; total: number; assurance: number }[];
  parPharmacie: { nom: string; n: number; total: number; assurance: number }[];
  medicaments: { nom: string; quantite: number; montant: number }[];
  detail: { date: string; pharmacie: string; statut: string; lignes: number; total: number; assurance: number; patient: number; payee: string | null }[];
}

const taux = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1).replace('.', ',')} %` : '—');

/**
 * Rapport des dispensations de pharmacie : filtres multicritères (formulaire GET), synthèse, graphiques, tableaux, export PDF / Word.
 * L'assureur voit tout le réseau ; le personnel d'une pharmacie ne voit que la sienne (imposé par l'API).
 */
export async function RapportDispensationsPage({ searchParams, racine }: { searchParams: Promise<Parametres>; racine: string }) {
  const sp = await searchParams;
  const f: Partial<Record<(typeof CLES)[number], string>> = {};
  for (const cle of CLES) {
    const v = Array.isArray(sp[cle]) ? sp[cle]![0] : sp[cle];
    if (v && v.trim()) f[cle] = v.trim();
  }
  const q = new URLSearchParams(f as Record<string, string>).toString();
  const [ro, rr] = await Promise.all([apiFetch('/api/v1/reporting/dispensations/options'), apiFetch(`/api/v1/reporting/dispensations${q ? `?${q}` : ''}`)]);
  if (!ro.ok || !rr.ok) return <p className="text-sm text-destructive">{await messageErreur(rr.ok ? ro : rr)}</p>;
  const options = (await ro.json()) as { pharmacies: { id: string; nom: string }[]; statuts: { valeur: string; libelle: string }[]; limiteAPharmacie: boolean };
  const r = (await rr.json()) as Rapport;
  const i = r.indicateurs;
  const lien = (format: string) => `/api/rapports/dispensations?${new URLSearchParams({ ...(f as Record<string, string>), format }).toString()}`;
  const cols = (p: string) => [p, 'Dispensations', 'Montant total', 'Part assurance', '% assurance'];
  const ligne = (nom: string, l: { n: number; total: number; assurance: number }) => [nom, nombre(l.n), francs(l.total), francs(l.assurance), taux(l.assurance, l.total)];
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
            Préparées du
            <input type="date" name="du" defaultValue={f.du ?? ''} className={CHAMP} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            au
            <input type="date" name="au" defaultValue={f.au ?? ''} className={CHAMP} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Pharmacie
            <select name="pharmacieId" defaultValue={f.pharmacieId ?? ''} className={CHAMP} disabled={options.limiteAPharmacie}>
              {!options.limiteAPharmacie && <option value="">Toutes les pharmacies</option>}
              {options.pharmacies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nom}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Statut
            <select name="statut" defaultValue={f.statut ?? ''} className={CHAMP}>
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
          {Object.keys(f).length > 0 && (
            <Button asChild variant="ghost">
              <Link href={racine}>Réinitialiser</Link>
            </Button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <a href={lien('pdf')}>
                <FileDown className="size-4" aria-hidden="true" /> Exporter en PDF
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={lien('docx')}>
                <FileText className="size-4" aria-hidden="true" /> Exporter en Word
              </a>
            </Button>
          </div>
        </div>
      </form>

      <GrilleCartes>
        <CarteResume libelle="Dispensations" valeur={nombre(i.dispensations)} icon={Pill} />
        <CarteResume libelle="Payées" valeur={nombre(i.payees)} icon={CheckCircle2} indice={taux(i.payees, i.dispensations)} />
        <CarteResume libelle="Montant total" valeur={francs(i.total)} icon={Wallet} indice={`${nombre(i.lignes)} ligne(s) de médicaments`} />
        <CarteResume libelle="Part assurance" valeur={francs(i.assurance)} icon={Coins} indice={taux(i.assurance, i.total)} />
        <CarteResume libelle="Part des patients" valeur={francs(i.patient)} icon={HandCoins} />
        <CarteResume libelle="Annulées" valeur={nombre(i.annulees)} icon={ReceiptText} />
        <CarteResume libelle="Majorations anormales" valeur={nombre(i.majorationsAnormales)} icon={AlertTriangle} tonIndice={i.majorationsAnormales > 0 ? 'negatif' : 'neutre'} indice="prix au-delà du seuil de référence" />
      </GrilleCartes>

      {i.dispensations > 0 ? (
        <>
          <RapportDispensationsGraphiques donnees={{ parMois: r.parMois, parStatut: r.parStatut, parPharmacie: r.parPharmacie, medicaments: r.medicaments }} />
          <Tableau titre="Évolution par mois" colonnes={cols('Mois')} lignes={r.parMois.map((m) => ligne(m.mois, m))} />
          <div className="grid gap-6 lg:grid-cols-2">
            <Tableau titre="Par statut" colonnes={['Statut', 'Dispensations', 'Montant']} lignes={r.parStatut.map((s) => [LIBELLE_STATUT[s.statut] ?? s.statut, nombre(s.n), francs(s.total)])} />
            {!options.limiteAPharmacie && <Tableau titre="Par pharmacie" colonnes={cols('Pharmacie')} lignes={r.parPharmacie.map((p) => ligne(p.nom, p))} />}
          </div>
          <Tableau titre="Médicaments les plus délivrés (en montant)" colonnes={['Médicament', 'Quantité', 'Montant']} lignes={r.medicaments.map((m) => [m.nom, nombre(m.quantite), francs(m.montant)])} />
          <Tableau
            titre={`Détail des dispensations (${nombre(Math.min(200, r.detail.length))} plus récentes — l’export en contient jusqu’à 1 000)`}
            colonnes={['Préparée le', 'Pharmacie', 'Statut', 'Lignes', 'Montant', 'Assurance', 'Patient', 'Payée le']}
            lignes={r.detail.slice(0, 200).map((d) => [dateFr(d.date), d.pharmacie, LIBELLE_STATUT[d.statut] ?? d.statut, nombre(d.lignes), francs(d.total), francs(d.assurance), francs(d.patient), d.payee ? dateFr(d.payee) : '—'])}
          />
        </>
      ) : (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Aucune dispensation ne correspond à ces critères.</p>
      )}
    </div>
  );
}
