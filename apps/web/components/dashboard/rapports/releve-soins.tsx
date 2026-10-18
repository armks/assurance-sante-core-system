import { Coins, FileDown, FileText, HandCoins, Pill, ShieldCheck, Stethoscope, Wallet } from 'lucide-react';
import Link from 'next/link';

import { CarteResume, GrilleCartes } from '@/components/dashboard/patterns';
import { CHAMP, dateFr, francs, nombre, periodesRapides, Tableau } from '@/components/dashboard/rapports/rapport-commun';
import { ReleveGraphiques } from '@/components/dashboard/rapports/releve-graphiques';
import { Button } from '@/components/ui/button';
import { apiFetch, messageErreur } from '@/lib/api';

type Parametres = Record<string, string | string[] | undefined>;
const CLES = ['du', 'au', 'personneId', 'categorieActe', 'adherentId', 'q'] as const;
const LIBELLE_LIEN: Record<string, string> = { TITULAIRE: 'Titulaire', CONJOINT: 'Conjoint(e)', ENFANT: 'Enfant', PERE: 'Père', MERE: 'Mère', AUTRE: 'Autre' };
const LIBELLE_STATUT: Record<string, string> = { EN_PREPARATION: 'En préparation', EN_ATTENTE_VALIDATION_PATIENT: 'En attente de votre code', VALIDEE: 'Validée', PAYEE: 'Payée', ANNULEE: 'Annulée' };

interface Releve {
  indicateurs: { dossiers: number; actes: number; cout: number; assurance: number; resteACharge: number; dispensations: number; medicamentsMontant: number; medicamentsAssurance: number; medicamentsResteACharge: number };
  parPersonne: { nom: string; lien: string; dossiers: number; actes: number; cout: number; assurance: number; resteACharge: number }[];
  parCategorie: { categorie: string; actes: number; cout: number; assurance: number }[];
  parMois: { mois: string; dossiers: number; cout: number; assurance: number; resteACharge: number }[];
  soins: { date: string; etablissement: string; personne: string; actes: number; cout: number; assurance: number; resteACharge: number }[];
  medicaments: { date: string; pharmacie: string; personne: string; statut: string; montant: number; assurance: number; resteACharge: number }[];
}

const taux = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1).replace('.', ',')} %` : '—');

/**
 * Relevé de soins de l'adhérent : ses soins en établissement et ses médicaments (lui et ses bénéficiaires), remboursé par
 * l'assurance et reste à charge, avec critères et export PDF / Word. Périmètre strictement personnel (imposé par l'API).
 */
export async function ReleveSoinsPage({ searchParams, racine, choixAdherent = false }: { searchParams: Promise<Parametres>; racine: string; choixAdherent?: boolean }) {
  const sp = await searchParams;
  const f: Partial<Record<(typeof CLES)[number], string>> = {};
  for (const cle of CLES) {
    const v = Array.isArray(sp[cle]) ? sp[cle]![0] : sp[cle];
    if (v && v.trim()) f[cle] = v.trim();
  }
  // direction : l'adhérent consulté est choisi par recherche ; un adhérent ne peut jamais désigner quelqu'un d'autre (l'API ignore le critère)
  if (!choixAdherent) {
    delete f.adherentId;
    delete f.q;
  }
  if (choixAdherent && !f.adherentId) {
    const res = f.q ? await apiFetch(`/api/v1/reporting/releve-soins/adherents?q=${encodeURIComponent(f.q)}`) : null;
    const trouves = res && res.ok ? ((await res.json()) as { id: string; nom: string; numeroAdherent: string | null; numeroCarte: string | null; societe: string | null }[]) : [];
    return (
      <div className="space-y-6">
        <form method="get" className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-4" aria-label="Recherche d’un adhérent">
          <label className="min-w-64 flex-1 space-y-1 text-xs text-muted-foreground">
            Adhérent (nom, prénom, n° d’adhérent ou n° de carte)
            <input type="search" name="q" defaultValue={f.q ?? ''} className={CHAMP} placeholder="Ex. Konan, ADH-2026-0001…" />
          </label>
          <Button type="submit">Rechercher</Button>
        </form>
        {res && !res.ok && <p className="text-sm text-destructive">{await messageErreur(res)}</p>}
        {f.q && res?.ok && (
          <Tableau
            titre={`${trouves.length} adhérent(s) trouvé(s)${trouves.length >= 30 ? ' — affinez la recherche' : ''}`}
            colonnes={['Adhérent', 'N° adhérent', 'N° carte', 'Société', 'Relevé']}
            lignes={trouves.map((a) => [a.nom, a.numeroAdherent ?? '—', a.numeroCarte ?? '—', a.societe ?? '—', <Link key={a.id} href={`${racine}?adherentId=${a.id}`} className="font-medium text-primary underline underline-offset-2">Ouvrir le relevé</Link>])}
            vide="Aucun adhérent ne correspond."
          />
        )}
        {!f.q && <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Recherchez un adhérent pour consulter et imprimer son relevé de soins.</p>}
      </div>
    );
  }
  const q = new URLSearchParams(f as Record<string, string>).toString();
  const [ro, rr] = await Promise.all([apiFetch(`/api/v1/reporting/releve-soins/options${f.adherentId ? `?adherentId=${f.adherentId}` : ''}`), apiFetch(`/api/v1/reporting/releve-soins${q ? `?${q}` : ''}`)]);
  if (!ro.ok || !rr.ok) return <p className="text-sm text-destructive">{await messageErreur(rr.ok ? ro : rr)}</p>;
  const options = (await ro.json()) as { personnes: { id: string; nom: string }[]; categories: { code: string; libelle: string }[] };
  const r = (await rr.json()) as Releve;
  const i = r.indicateurs;
  const libCat = Object.fromEntries(options.categories.map((c) => [c.code, c.libelle]));
  const lien = (format: string) => `/api/rapports/releve-soins?${new URLSearchParams({ ...(f as Record<string, string>), format }).toString()}`;
  return (
    <div className="space-y-8">
      <form method="get" className="space-y-3 rounded-lg border bg-card p-4" aria-label="Critères du relevé">
        {choixAdherent && f.adherentId && (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">Adhérent :</span> {options.personnes[0]?.nom.replace(' (titulaire)', '')}
            <Link href={racine} className="text-xs text-primary underline underline-offset-2">
              Changer d’adhérent
            </Link>
            <input type="hidden" name="adherentId" value={f.adherentId} />
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-muted-foreground">Périodes rapides :</span>
          {periodesRapides().map((p) => (
            <Link key={p.libelle} href={`${racine}?${choixAdherent && f.adherentId ? `adherentId=${f.adherentId}&` : ''}du=${p.du}&au=${p.au}`} className="rounded-full border px-2.5 py-1 hover:bg-accent">
              {p.libelle}
            </Link>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-xs text-muted-foreground">
            Du
            <input type="date" name="du" defaultValue={f.du ?? ''} className={CHAMP} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            au
            <input type="date" name="au" defaultValue={f.au ?? ''} className={CHAMP} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Personne couverte
            <select name="personneId" defaultValue={f.personneId ?? ''} className={CHAMP}>
              <option value="">Moi et mes bénéficiaires</option>
              {options.personnes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nom}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Catégorie d’acte
            <select name="categorieActe" defaultValue={f.categorieActe ?? ''} className={CHAMP}>
              <option value="">Toutes les catégories</option>
              {options.categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.libelle}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit">Appliquer les critères</Button>
          {Object.keys(f).filter((k) => k !== 'adherentId').length > 0 && (
            <Button asChild variant="ghost">
              <Link href={choixAdherent && f.adherentId ? `${racine}?adherentId=${f.adherentId}` : racine}>Réinitialiser</Link>
            </Button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <a href={lien('pdf')}>
                <FileDown className="size-4" aria-hidden="true" /> Télécharger en PDF
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={lien('docx')}>
                <FileText className="size-4" aria-hidden="true" /> Télécharger en Word
              </a>
            </Button>
          </div>
        </div>
      </form>

      <GrilleCartes>
        <CarteResume libelle="Dossiers de soins" valeur={nombre(i.dossiers)} icon={Stethoscope} indice={`${nombre(i.actes)} acte(s)`} />
        <CarteResume libelle="Coût des soins" valeur={francs(i.cout)} icon={Wallet} />
        <CarteResume libelle="Pris en charge par l’assurance" valeur={francs(i.assurance)} icon={ShieldCheck} indice={taux(i.assurance, i.cout)} tonIndice="positif" />
        <CarteResume libelle={choixAdherent ? 'Reste à sa charge (soins)' : 'Reste à ma charge (soins)'} valeur={francs(i.resteACharge)} icon={HandCoins} />
        <CarteResume libelle="Dispensations de médicaments" valeur={nombre(i.dispensations)} icon={Pill} indice={francs(i.medicamentsMontant)} />
        <CarteResume libelle="Médicaments pris en charge" valeur={francs(i.medicamentsAssurance)} icon={ShieldCheck} />
        <CarteResume libelle={choixAdherent ? 'Médicaments : reste à sa charge' : 'Médicaments : reste à ma charge'} valeur={francs(i.medicamentsResteACharge)} icon={Coins} />
      </GrilleCartes>

      {i.dossiers > 0 || i.dispensations > 0 ? (
        <>
          <ReleveGraphiques donnees={{ parMois: r.parMois, parPersonne: r.parPersonne, parCategorie: r.parCategorie, libellesCategories: libCat }} />
          <Tableau titre="Par personne couverte" colonnes={['Personne', 'Lien', 'Dossiers', 'Coût', 'Assurance', 'Reste à charge']} lignes={r.parPersonne.map((p) => [p.nom, LIBELLE_LIEN[p.lien] ?? p.lien, nombre(p.dossiers), francs(p.cout), francs(p.assurance), francs(p.resteACharge)])} />
          <Tableau titre="Par mois" colonnes={['Mois', 'Dossiers', 'Coût', 'Assurance', 'Reste à charge']} lignes={r.parMois.map((m) => [m.mois, nombre(m.dossiers), francs(m.cout), francs(m.assurance), francs(m.resteACharge)])} />
          <Tableau titre={choixAdherent ? 'Détail des soins' : 'Détail de mes soins'} colonnes={['Date', 'Établissement', 'Personne', 'Actes', 'Coût', 'Assurance', 'Reste à charge']} lignes={r.soins.map((s) => [dateFr(s.date), s.etablissement, s.personne, nombre(s.actes), francs(s.cout), francs(s.assurance), francs(s.resteACharge)])} />
          {r.medicaments.length > 0 && (
            <Tableau titre={choixAdherent ? 'Détail des médicaments' : 'Détail de mes médicaments'} colonnes={['Date', 'Pharmacie', 'Personne', 'Statut', 'Montant', 'Assurance', 'Reste à charge']} lignes={r.medicaments.map((m) => [dateFr(m.date), m.pharmacie, m.personne, LIBELLE_STATUT[m.statut] ?? m.statut, francs(m.montant), francs(m.assurance), francs(m.resteACharge)])} />
          )}
        </>
      ) : (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Aucun soin ne correspond à ces critères.</p>
      )}
    </div>
  );
}
