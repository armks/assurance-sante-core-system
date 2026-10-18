import { CheckCircle2, Clock, Coins, Layers, XCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { CarteResume, GrilleCartes } from '@/components/dashboard/patterns';
import { CHAMP, francs, nombre, Tableau } from '@/components/dashboard/rapports/rapport-commun';
import { PageTitre } from '@/components/page-titre';
import { GrillePrixLicences, type TarifLicence } from '@/components/superadmin/grille-prix-licences';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Licences générées — Superadmin' };

type Parametres = Record<string, string | string[] | undefined>;
const CLES = ['du', 'au', 'organisationId', 'typeLicence', 'statut', 'mode'] as const;

interface Ligne {
  id: string;
  organisationId: string;
  societe: string;
  typeLicence: string;
  mode: 'CODE' | 'DIRECTE';
  statut: 'EMIS' | 'ACTIVE' | 'EXPIRE' | 'ANNULE';
  prix: number;
  dateGeneration: string;
  dateExpiration: string;
  dateActivation: string | null;
  activeParRole: string | null;
}
interface Cumul {
  nombre: number;
  total: number;
  nbActivees: number;
  totalActivees: number;
  nbEnAttente: number;
  totalEnAttente: number;
  nbNonRealisees: number;
  totalNonRealisees: number;
}

const STATUT: Record<Ligne['statut'], { libelle: string; classe: string }> = {
  ACTIVE: { libelle: 'Activée', classe: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400' },
  EMIS: { libelle: 'Code en attente', classe: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300' },
  EXPIRE: { libelle: 'Code expiré', classe: 'border-destructive/40 bg-destructive/10 text-destructive' },
  ANNULE: { libelle: 'Code annulé', classe: 'border-border bg-muted text-muted-foreground' },
};
const TYPE: Record<string, string> = { ESSAI: 'Essai (30 jours)', MENSUELLE: 'Mensuelle', TRIMESTRIELLE: 'Trimestrielle', SEMESTRIELLE: 'Semestrielle', ANNUELLE: 'Annuelle', BIENNALE: '2 ans' };
const ACTIVEE_PAR: Record<string, string> = { ASSUREUR_DIRECTION: 'Direction', ASSUREUR_INFORMATIQUE: 'Informatique', ASSUREUR_INFORMATIQUE_ADJOINT: 'Informatique adjoint', SUPERADMIN_PRINCIPAL: 'Superadmin' };
const dateHeure = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const dateCourte = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');

/** Licences générées (codes d'activation et activations directes) avec leur prix : filtres multicritères, cumul en tête, grille de prix. */
export default async function LicencesGenereesPage({ searchParams }: { searchParams: Promise<Parametres> }) {
  const sp = await searchParams;
  const f: Partial<Record<(typeof CLES)[number], string>> = {};
  for (const cle of CLES) {
    const v = Array.isArray(sp[cle]) ? sp[cle]![0] : sp[cle];
    if (v && v.trim()) f[cle] = v.trim();
  }
  const q = new URLSearchParams(f as Record<string, string>).toString();
  const [resH, resT, resS] = await Promise.all([
    apiFetch(`/api/v1/superadmin/licences/historique${q ? `?${q}` : ''}`),
    apiFetch('/api/v1/superadmin/licences/tarifs'),
    apiFetch('/api/v1/superadmin/licences'),
  ]);
  if (!resH.ok) return <p className="text-sm text-destructive">{await messageErreur(resH)}</p>;
  const h = (await resH.json()) as { lignes: Ligne[]; cumul: Cumul; parType: { typeLicence: string; nombre: number; total: number; totalActivees: number }[]; tronque: boolean };
  const tarifs: TarifLicence[] = resT.ok ? await resT.json() : [];
  const societes: { organisationId: string; nom: string }[] = resS.ok ? await resS.json() : [];
  const c = h.cumul;
  const filtreActif = Object.keys(f).length > 0;

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Licences générées"
        description="Toutes les licences générées pour les sociétés d’assurance (codes d’activation et activations directes) avec leur prix, filtrables, et leur cumul en tête de tableau."
      />

      <form method="get" className="space-y-3 rounded-lg border bg-card p-4" aria-label="Filtres des licences générées">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <label className="space-y-1 text-xs text-muted-foreground">
            Générées du
            <input type="date" name="du" defaultValue={f.du ?? ''} className={CHAMP} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            au
            <input type="date" name="au" defaultValue={f.au ?? ''} className={CHAMP} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Société
            <select name="organisationId" defaultValue={f.organisationId ?? ''} className={CHAMP}>
              <option value="">Toutes les sociétés</option>
              {societes.map((s) => (
                <option key={s.organisationId} value={s.organisationId}>
                  {s.nom}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Type de licence
            <select name="typeLicence" defaultValue={f.typeLicence ?? ''} className={CHAMP}>
              <option value="">Tous les types</option>
              {Object.entries(TYPE).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Statut
            <select name="statut" defaultValue={f.statut ?? ''} className={CHAMP}>
              <option value="">Tous les statuts</option>
              {Object.entries(STATUT).map(([v, s]) => (
                <option key={v} value={v}>
                  {s.libelle}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Mode
            <select name="mode" defaultValue={f.mode ?? ''} className={CHAMP}>
              <option value="">Tous les modes</option>
              <option value="CODE">Par code d’activation</option>
              <option value="DIRECTE">Activation directe</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit">Appliquer les filtres</Button>
          {filtreActif && (
            <Button asChild variant="ghost">
              <Link href="/superadmin/licences/historique">Réinitialiser</Link>
            </Button>
          )}
          <Button asChild variant="ghost" className="ml-auto">
            <Link href="/superadmin/licences">Gérer les licences des sociétés</Link>
          </Button>
        </div>
      </form>

      {/* cumul des sommes, en tête du tableau, sur les licences filtrées */}
      <GrilleCartes>
        <CarteResume libelle="Licences générées" valeur={nombre(c.nombre)} icon={Layers} indice={`Cumul : ${francs(c.total)}`} />
        <CarteResume libelle="Activées (réalisé)" valeur={francs(c.totalActivees)} icon={CheckCircle2} indice={`${nombre(c.nbActivees)} licence(s)`} tonIndice="positif" />
        <CarteResume libelle="Codes en attente" valeur={francs(c.totalEnAttente)} icon={Clock} indice={`${nombre(c.nbEnAttente)} code(s) valable(s) 24 h`} />
        <CarteResume libelle="Non réalisées" valeur={francs(c.totalNonRealisees)} icon={XCircle} indice={`${nombre(c.nbNonRealisees)} expirée(s) ou annulée(s)`} tonIndice={c.nbNonRealisees > 0 ? 'negatif' : 'neutre'} />
      </GrilleCartes>

      {h.parType.length > 0 && (
        <Tableau
          titre="Cumul par type de licence"
          colonnes={['Type de licence', 'Licences', 'Cumul des prix', 'Dont activées']}
          lignes={[
            ...h.parType.map((t) => [TYPE[t.typeLicence] ?? t.typeLicence, nombre(t.nombre), francs(t.total), francs(t.totalActivees)]),
            [<strong key="t">Total</strong>, <strong key="n">{nombre(c.nombre)}</strong>, <strong key="p">{francs(c.total)}</strong>, <strong key="a">{francs(c.totalActivees)}</strong>],
          ]}
        />
      )}

      <Tableau
        titre={`Licences générées (${nombre(h.lignes.length)}${h.tronque ? ', les 1 000 plus récentes' : ''})`}
        colonnes={['Générée le', 'Société', 'Type de licence', 'Mode', 'Statut', 'Prix', 'Code valable jusqu’au', 'Activée le', 'Activée par']}
        lignes={h.lignes.map((l) => [
          dateHeure(l.dateGeneration),
          l.societe,
          TYPE[l.typeLicence] ?? l.typeLicence,
          l.mode === 'DIRECTE' ? 'Activation directe' : 'Par code',
          <Badge key={l.id} variant="outline" className={STATUT[l.statut].classe}>
            {STATUT[l.statut].libelle}
          </Badge>,
          francs(l.prix),
          l.mode === 'DIRECTE' ? '—' : dateHeure(l.dateExpiration),
          l.dateActivation ? dateCourte(l.dateActivation) : '—',
          l.activeParRole ? (ACTIVEE_PAR[l.activeParRole] ?? l.activeParRole) : '—',
        ])}
        vide="Aucune licence générée pour ces filtres."
      />

      <section className="space-y-3" aria-labelledby="titre-prix">
        <div>
          <h2 id="titre-prix" className="flex items-center gap-2 text-base font-semibold">
            <Coins className="size-4" aria-hidden="true" /> Prix des licences
          </h2>
          <p className="text-sm text-muted-foreground">
            Le prix est figé au moment de la génération : modifier un tarif ne change que les licences générées ensuite, jamais l’historique ci-dessus.
          </p>
        </div>
        <GrillePrixLicences tarifs={tarifs} />
      </section>
    </div>
  );
}
