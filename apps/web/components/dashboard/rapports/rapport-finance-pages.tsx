import { AlarmClock, CheckCircle2, Coins, FileDown, FileText, HandCoins, Landmark, ReceiptText, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import Link from 'next/link';

import { CarteResume, GrilleCartes } from '@/components/dashboard/patterns';
import { CHAMP, dateFr, francs, nombre, periodesRapides, Tableau } from '@/components/dashboard/rapports/rapport-commun';
import { RapportCotisationsGraphiques, RapportFinancesGraphiques } from '@/components/dashboard/rapports/rapport-finance-graphiques';
import { Button } from '@/components/ui/button';
import { apiFetch, messageErreur } from '@/lib/api';

type Parametres = Record<string, string | string[] | undefined>;

function filtresDepuisUrl<K extends string>(sp: Parametres, cles: readonly K[]): Partial<Record<K, string>> {
  const f: Partial<Record<K, string>> = {};
  for (const cle of cles) {
    const v = Array.isArray(sp[cle]) ? sp[cle]![0] : sp[cle];
    if (v && v.trim()) f[cle] = v.trim();
  }
  return f;
}

const taux = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1).replace('.', ',')} %` : '—');

/** Formulaire de critères (GET) + boutons d'export, communs aux rapports comptables. */
function Formulaire({ racine, actif, lienExport, children }: { racine: string; actif: boolean; lienExport: (format: string) => string; children: React.ReactNode }) {
  return (
    <form method="get" className="space-y-3 rounded-lg border bg-card p-4" aria-label="Critères du rapport">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-muted-foreground">Périodes rapides :</span>
        {periodesRapides().map((p) => (
          <Link key={p.libelle} href={`${racine}?du=${p.du}&au=${p.au}`} className="rounded-full border px-2.5 py-1 hover:bg-accent">
            {p.libelle}
          </Link>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit">Appliquer les critères</Button>
        {actif && (
          <Button asChild variant="ghost">
            <Link href={racine}>Réinitialiser</Link>
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <a href={lienExport('pdf')}>
              <FileDown className="size-4" aria-hidden="true" /> Exporter en PDF
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={lienExport('docx')}>
              <FileText className="size-4" aria-hidden="true" /> Exporter en Word
            </a>
          </Button>
        </div>
      </div>
    </form>
  );
}

const Champ = ({ libelle, children }: { libelle: string; children: React.ReactNode }) => (
  <label className="space-y-1 text-xs text-muted-foreground">
    {libelle}
    {children}
  </label>
);

// ----------------------------------------------------------------------------- cotisations
const LIBELLE_COTISATION: Record<string, string> = { A_PAYER: 'À payer', PAYEE: 'Payée', EN_RETARD: 'En retard', ANNULEE: 'Annulée' };

interface RapportCotisations {
  indicateurs: { cotisations: number; du: number; paye: number; restant: number; penalites: number; enRetard: number; montantEnRetard: number };
  parStatut: { statut: string; n: number; du: number; paye: number }[];
  parMois: { mois: string; n: number; du: number; paye: number }[];
  parSociete: { nom: string; n: number; du: number; paye: number; enRetard: number }[];
  detail: { periode: string; societe: string; police: string; du: number; paye: number; penalite: number; echeance: string; statut: string }[];
}

/** Rapport de cotisations : dû, encaissé, retards, par mois, statut et société ; export PDF / Word. */
export async function RapportCotisationsPage({ searchParams, racine }: { searchParams: Promise<Parametres>; racine: string }) {
  const f = filtresDepuisUrl(await searchParams, ['du', 'au', 'statut', 'souscripteurId'] as const);
  const q = new URLSearchParams(f as Record<string, string>).toString();
  const [ro, rr] = await Promise.all([apiFetch('/api/v1/reporting/cotisations/options'), apiFetch(`/api/v1/reporting/cotisations${q ? `?${q}` : ''}`)]);
  if (!ro.ok || !rr.ok) return <p className="text-sm text-destructive">{await messageErreur(rr.ok ? ro : rr)}</p>;
  const options = (await ro.json()) as { societes: { id: string; nom: string }[]; statuts: { valeur: string; libelle: string }[] };
  const r = (await rr.json()) as RapportCotisations;
  const i = r.indicateurs;
  const lien = (format: string) => `/api/rapports/cotisations?${new URLSearchParams({ ...(f as Record<string, string>), format }).toString()}`;
  const cols = (p: string) => [p, 'Cotisations', 'Dû', 'Encaissé', 'Restant', '% encaissé'];
  const ligne = (nom: string, l: { n: number; du: number; paye: number }) => [nom, nombre(l.n), francs(l.du), francs(l.paye), francs(l.du - l.paye), taux(l.paye, l.du)];
  return (
    <div className="space-y-8">
      <Formulaire racine={racine} actif={Object.keys(f).length > 0} lienExport={lien}>
        <Champ libelle="Période du"><input type="date" name="du" defaultValue={f.du ?? ''} className={CHAMP} /></Champ>
        <Champ libelle="au"><input type="date" name="au" defaultValue={f.au ?? ''} className={CHAMP} /></Champ>
        <Champ libelle="Société cliente">
          <select name="souscripteurId" defaultValue={f.souscripteurId ?? ''} className={CHAMP}>
            <option value="">Toutes les sociétés</option>
            {options.societes.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
          </select>
        </Champ>
        <Champ libelle="Statut">
          <select name="statut" defaultValue={f.statut ?? ''} className={CHAMP}>
            <option value="">Tous les statuts</option>
            {options.statuts.map((s) => <option key={s.valeur} value={s.valeur}>{s.libelle}</option>)}
          </select>
        </Champ>
      </Formulaire>
      <GrilleCartes>
        <CarteResume libelle="Cotisations" valeur={nombre(i.cotisations)} icon={ReceiptText} />
        <CarteResume libelle="Montant dû" valeur={francs(i.du)} icon={Wallet} />
        <CarteResume libelle="Montant encaissé" valeur={francs(i.paye)} icon={CheckCircle2} indice={taux(i.paye, i.du)} />
        <CarteResume libelle="Reste à encaisser" valeur={francs(i.restant)} icon={HandCoins} />
        <CarteResume libelle="Cotisations en retard" valeur={nombre(i.enRetard)} icon={AlarmClock} tonIndice={i.enRetard > 0 ? 'negatif' : 'neutre'} />
        <CarteResume libelle="Montant en retard" valeur={francs(i.montantEnRetard)} icon={AlarmClock} />
        <CarteResume libelle="Pénalités appliquées" valeur={francs(i.penalites)} icon={Coins} />
      </GrilleCartes>
      {i.cotisations > 0 || r.parStatut.length > 0 ? (
        <>
          <RapportCotisationsGraphiques donnees={{ parMois: r.parMois, parStatut: r.parStatut, parSociete: r.parSociete }} />
          <Tableau titre="Évolution par mois" colonnes={cols('Mois')} lignes={r.parMois.map((m) => ligne(m.mois, m))} />
          <div className="grid gap-6 lg:grid-cols-2">
            <Tableau titre="Par statut" colonnes={cols('Statut')} lignes={r.parStatut.map((s) => ligne(LIBELLE_COTISATION[s.statut] ?? s.statut, s))} />
            <Tableau titre="Par société cliente" colonnes={[...cols('Société'), 'En retard']} lignes={r.parSociete.map((s) => [...ligne(s.nom, s), nombre(s.enRetard)])} />
          </div>
          <Tableau
            titre={`Détail des cotisations (${nombre(Math.min(200, r.detail.length))} plus récentes — l’export en contient jusqu’à 1 000)`}
            colonnes={['Période', 'Société', 'Police', 'Dû', 'Payé', 'Pénalité', 'Échéance', 'Statut']}
            lignes={r.detail.slice(0, 200).map((d) => [d.periode, d.societe, d.police, francs(d.du), francs(d.paye), francs(d.penalite), dateFr(d.echeance), LIBELLE_COTISATION[d.statut] ?? d.statut])}
          />
        </>
      ) : (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Aucune cotisation ne correspond à ces critères.</p>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------- finances
const LIBELLE_MOUVEMENT: Record<string, string> = { APPROVISIONNEMENT: 'Approvisionnement', DEPENSE: 'Dépense', TRANSFERT: 'Transfert', PAIEMENT_FACTURE: 'Paiement de facture' };
const LIBELLE_COMPTE: Record<string, string> = { BANCAIRE: 'Bancaire', CAISSE_INTERNE: 'Caisse interne' };

interface RapportFinances {
  indicateurs: { soldeTotal: number; comptes: number; mouvements: number; entrees: number; sorties: number; transferts: number };
  comptes: { nom: string; type: string; banque: string | null; solde: number }[];
  parType: { type: string; n: number; total: number }[];
  parMois: { mois: string; entrees: number; sorties: number }[];
  detail: { date: string; type: string; montant: number; description: string; source: string | null; destination: string | null }[];
}

/** Rapport financier : soldes des comptes, entrées et sorties par mois et par type ; export PDF / Word. */
export async function RapportFinancesPage({ searchParams, racine }: { searchParams: Promise<Parametres>; racine: string }) {
  const f = filtresDepuisUrl(await searchParams, ['du', 'au', 'type', 'compteId'] as const);
  const q = new URLSearchParams(f as Record<string, string>).toString();
  const [ro, rr] = await Promise.all([apiFetch('/api/v1/reporting/finances/options'), apiFetch(`/api/v1/reporting/finances${q ? `?${q}` : ''}`)]);
  if (!ro.ok || !rr.ok) return <p className="text-sm text-destructive">{await messageErreur(rr.ok ? ro : rr)}</p>;
  const options = (await ro.json()) as { comptes: { id: string; nom: string }[]; types: { valeur: string; libelle: string }[] };
  const r = (await rr.json()) as RapportFinances;
  const i = r.indicateurs;
  const lien = (format: string) => `/api/rapports/finances?${new URLSearchParams({ ...(f as Record<string, string>), format }).toString()}`;
  return (
    <div className="space-y-8">
      <Formulaire racine={racine} actif={Object.keys(f).length > 0} lienExport={lien}>
        <Champ libelle="Mouvements du"><input type="date" name="du" defaultValue={f.du ?? ''} className={CHAMP} /></Champ>
        <Champ libelle="au"><input type="date" name="au" defaultValue={f.au ?? ''} className={CHAMP} /></Champ>
        <Champ libelle="Compte">
          <select name="compteId" defaultValue={f.compteId ?? ''} className={CHAMP}>
            <option value="">Tous les comptes</option>
            {options.comptes.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </Champ>
        <Champ libelle="Type de mouvement">
          <select name="type" defaultValue={f.type ?? ''} className={CHAMP}>
            <option value="">Tous les types</option>
            {options.types.map((t) => <option key={t.valeur} value={t.valeur}>{t.libelle}</option>)}
          </select>
        </Champ>
      </Formulaire>
      <GrilleCartes>
        <CarteResume libelle="Solde total des comptes" valeur={francs(i.soldeTotal)} icon={Landmark} indice={`${nombre(i.comptes)} compte(s) actif(s)`} />
        <CarteResume libelle="Mouvements" valeur={nombre(i.mouvements)} icon={ReceiptText} />
        <CarteResume libelle="Entrées" valeur={francs(i.entrees)} icon={TrendingUp} tonIndice="positif" />
        <CarteResume libelle="Sorties" valeur={francs(i.sorties)} icon={TrendingDown} />
        <CarteResume libelle="Solde net de la période" valeur={francs(i.entrees - i.sorties)} icon={Wallet} indice="entrées − sorties" tonIndice={i.entrees - i.sorties >= 0 ? 'positif' : 'negatif'} />
        <CarteResume libelle="Transferts internes" valeur={francs(i.transferts)} icon={Coins} />
      </GrilleCartes>
      <RapportFinancesGraphiques donnees={{ parMois: r.parMois, parType: r.parType, comptes: r.comptes }} />
      <Tableau titre="Soldes des comptes" colonnes={['Compte', 'Type', 'Banque', 'Solde actuel']} lignes={r.comptes.map((c) => [c.nom, LIBELLE_COMPTE[c.type] ?? c.type, c.banque ?? '—', francs(c.solde)])} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Tableau titre="Par mois" colonnes={['Mois', 'Entrées', 'Sorties', 'Solde net']} lignes={r.parMois.map((m) => [m.mois, francs(m.entrees), francs(m.sorties), francs(m.entrees - m.sorties)])} />
        <Tableau titre="Par type de mouvement" colonnes={['Type', 'Mouvements', 'Montant']} lignes={r.parType.map((t) => [LIBELLE_MOUVEMENT[t.type] ?? t.type, nombre(t.n), francs(t.total)])} />
      </div>
      <Tableau
        titre={`Détail des mouvements (${nombre(Math.min(200, r.detail.length))} plus récents — l’export en contient jusqu’à 1 000)`}
        colonnes={['Date', 'Type', 'Montant', 'Libellé', 'Source', 'Destination']}
        lignes={r.detail.slice(0, 200).map((d) => [dateFr(d.date), LIBELLE_MOUVEMENT[d.type] ?? d.type, francs(d.montant), d.description, d.source ?? '—', d.destination ?? '—'])}
      />
    </div>
  );
}
