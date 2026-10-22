'use client';

import { Coins, Layers, Users, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { creerGrille, modifierGrille, supprimerGrille } from '@/app/dashboard-assureur/informatique/cotisations/actions';
import {
  CarteResume,
  ChampNombre,
  ChampSelect,
  ConfirmationAction,
  DataTable,
  FormulaireModal,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { verifierAction } from '@/app/dependances-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { montantF } from '@/lib/format';

export interface GrilleLigne {
  id: string;
  produitId: string;
  souscripteurId: string | null;
  trancheAgeMin: number;
  trancheAgeMax: number;
  montantMensuel: string;
  produit: { nom: string; version: number } | null;
  souscripteur: { nom: string; type: string } | null;
}
interface OptionRef {
  id: string;
  nom: string;
  version?: number;
}

const CLASSE_CHAMP =
  'h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

const libelleFormule = (p: { nom: string; version?: number | null } | null | undefined) =>
  p ? `${p.nom}${p.version ? ` · v${p.version}` : ''}` : '—';

/**
 * Grilles tarifaires (coût mensuel d'une formule par tranche d'âge) : filtres sur une ligne (formule, type / société, âge,
 * recherche), cumul en tête, tableau, formulaire de création qui montre les tranches déjà définies pour la formule choisie
 * (repérage des trous et des chevauchements avant d'enregistrer).
 */
export function GrillesTarifairesSection({
  grilles,
  produits,
  souscripteurs,
  peutSupprimerGrille = false,
}: {
  grilles: GrilleLigne[];
  produits: OptionRef[];
  souscripteurs: OptionRef[];
  peutSupprimerGrille?: boolean;
}) {
  const router = useRouter();
  const [formule, setFormule] = useState('');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [age, setAge] = useState('');

  const visibles = useMemo(() => {
    const mot = q.trim().toLowerCase();
    const a = age === '' ? null : Number(age);
    return grilles.filter((g) => {
      if (formule && g.produitId !== formule) return false;
      if (type === 'STANDARD' && g.souscripteurId) return false;
      if (type === 'NEGOCIE' && !g.souscripteurId) return false;
      if (a !== null && !(g.trancheAgeMin <= a && a <= g.trancheAgeMax)) return false;
      if (mot && !`${g.produit?.nom ?? ''} ${g.souscripteur?.nom ?? ''}`.toLowerCase().includes(mot)) return false;
      return true;
    });
  }, [grilles, formule, type, q, age]);

  const montants = visibles.map((g) => Number(g.montantMensuel));
  const moyenne = montants.length ? montants.reduce((s, m) => s + m, 0) / montants.length : 0;
  const nbStandard = visibles.filter((g) => !g.souscripteurId).length;
  const nbNegocie = visibles.length - nbStandard;
  const filtresActifs = formule || type || q || age;

  const colonnes: ColonneTable<GrilleLigne>[] = [
    {
      cle: 'produit',
      entete: 'Formule',
      triable: true,
      valeur: (g) => g.produit?.nom ?? '',
      rendu: (g) => libelleFormule(g.produit),
    },
    {
      cle: 'type',
      entete: 'Type',
      rendu: (g) =>
        g.souscripteurId ? (
          <StatutBadge statut="NEGOCIE" ton="info" libelle="Négocié" />
        ) : (
          <StatutBadge statut="STANDARD" ton="neutre" libelle="Standard" />
        ),
    },
    { cle: 'souscripteur', entete: 'Société', rendu: (g) => g.souscripteur?.nom ?? 'Toutes les sociétés' },
    {
      cle: 'tranche',
      entete: 'Tranche d’âge',
      triable: true,
      valeur: (g) => g.trancheAgeMin,
      rendu: (g) => `${g.trancheAgeMin} – ${g.trancheAgeMax} ans`,
    },
    {
      cle: 'montantMensuel',
      entete: 'Montant mensuel',
      aligneDroite: true,
      triable: true,
      valeur: (g) => Number(g.montantMensuel),
      rendu: (g) => <span className="font-semibold">{montantF(g.montantMensuel)}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      {/* --- filtres sur une ligne --- */}
      <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap sm:overflow-x-auto">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher : formule, société…"
          aria-label="Rechercher une grille"
          className="h-9 w-full min-w-0 sm:w-auto sm:min-w-40 sm:flex-1"
        />
        <select value={formule} onChange={(e) => setFormule(e.target.value)} aria-label="Formule" className={`${CLASSE_CHAMP} shrink-0`}>
          <option value="">Toutes les formules</option>
          {produits.map((p) => (
            <option key={p.id} value={p.id}>
              {libelleFormule(p)}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type de tarif" className={`${CLASSE_CHAMP} shrink-0`}>
          <option value="">Standard et négocié</option>
          <option value="STANDARD">Standard</option>
          <option value="NEGOCIE">Négocié</option>
        </select>
        <label className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
          Âge
          <input
            type="number"
            min={0}
            max={150}
            value={age}
            onChange={(e) => setAge(e.target.value)}
            placeholder="ex. 35"
            className={`${CLASSE_CHAMP} w-20`}
          />
        </label>
        {filtresActifs && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="shrink-0"
            onClick={() => {
              setFormule('');
              setType('');
              setQ('');
              setAge('');
            }}
          >
            Réinitialiser
          </Button>
        )}
      </div>

      {/* --- cumul --- */}
      <GrilleCartes>
        <CarteResume libelle="Grilles" valeur={visibles.length} icon={Layers} indice={`${nbStandard} standard · ${nbNegocie} négociée(s)`} />
        <CarteResume libelle="Formules couvertes" valeur={new Set(visibles.map((g) => g.produitId)).size} icon={Wallet} />
        <CarteResume libelle="Montant mensuel moyen" valeur={montantF(moyenne)} icon={Coins} />
        <CarteResume
          libelle="Fourchette"
          valeur={montants.length ? `${montantF(Math.min(...montants))} – ${montantF(Math.max(...montants))}` : '—'}
          icon={Users}
        />
      </GrilleCartes>

      <DataTable
        donnees={visibles}
        cleLigne={(g) => g.id}
        parPage={12}
        colonnes={colonnes}
        actions={<FormulaireNouvelleGrille grilles={grilles} produits={produits} souscripteurs={souscripteurs} onSucces={() => router.refresh()} />}
        actionLigne={(g) => (
          <span className="flex justify-end gap-2">
            <FormulaireModal
              titre="Modifier la grille tarifaire"
              description="Les cotisations déjà calculées gardent leur montant ; la modification vaut pour les prochains calculs."
              declencheur={
                <Button type="button" size="xs" variant="ghost">
                  Modifier
                </Button>
              }
              libelleSoumettre="Enregistrer"
              onSoumettre={async (fd) =>
                modifierGrille(g.id, {
                  trancheAgeMin: Number(fd.get('trancheAgeMin') ?? 0),
                  trancheAgeMax: Number(fd.get('trancheAgeMax') ?? 0),
                  montantMensuel: Number(fd.get('montantMensuel') ?? 0),
                })
              }
              onSucces={() => router.refresh()}
            >
              <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                {libelleFormule(g.produit)} — {g.souscripteur ? `négocié ${g.souscripteur.nom}` : 'tarif standard'}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <ChampNombre name="trancheAgeMin" label="Âge min." required min={0} max={150} step={1} defaultValue={g.trancheAgeMin} />
                <ChampNombre name="trancheAgeMax" label="Âge max." required min={0} max={150} step={1} defaultValue={g.trancheAgeMax} />
              </div>
              <ChampNombre name="montantMensuel" label="Montant mensuel (FCFA)" required min={0} step="0.01" defaultValue={Number(g.montantMensuel)} />
            </FormulaireModal>
            {peutSupprimerGrille && (
              <ConfirmationAction
                action="supprimer"
                element={`la grille « ${g.produit?.nom ?? 'formule'} ${g.trancheAgeMin}–${g.trancheAgeMax} ans »`}
                verifier={() => verifierAction('grilleTarifaire', g.id, 'supprimer')}
                onConfirmer={() => supprimerGrille(g.id)}
                onSucces={() => router.refresh()}
              />
            )}
          </span>
        )}
        vide="Aucune grille tarifaire ne correspond à ces critères."
      />
    </div>
  );
}

/** Formulaire de création : choix de la formule et de la société, puis tranches déjà définies pour guider la saisie. */
function FormulaireNouvelleGrille({
  grilles,
  produits,
  souscripteurs,
  onSucces,
}: {
  grilles: GrilleLigne[];
  produits: OptionRef[];
  souscripteurs: OptionRef[];
  onSucces: () => void;
}) {
  const [produitId, setProduitId] = useState('');
  const [societeId, setSocieteId] = useState('');

  const existantes = useMemo(
    () =>
      grilles
        .filter((g) => g.produitId === produitId && (g.souscripteurId ?? '') === societeId)
        .sort((a, b) => a.trancheAgeMin - b.trancheAgeMin),
    [grilles, produitId, societeId],
  );
  const dernier = existantes.length ? existantes[existantes.length - 1].trancheAgeMax : null;

  return (
    <FormulaireModal
      titre="Nouvelle grille tarifaire"
      description="Le coût mensuel d’une formule pour une tranche d’âge. Sans société : tarif standard ; avec une société : tarif négocié, prioritaire."
      declencheurLabel="Nouvelle grille"
      libelleSoumettre="Créer la grille"
      onSoumettre={async (fd) =>
        creerGrille({
          produitId: String(fd.get('produitId') ?? ''),
          souscripteurId: String(fd.get('souscripteurId') ?? '') || undefined,
          trancheAgeMin: Number(fd.get('trancheAgeMin') ?? 0),
          trancheAgeMax: Number(fd.get('trancheAgeMax') ?? 0),
          montantMensuel: Number(fd.get('montantMensuel') ?? 0),
        })
      }
      onSucces={onSucces}
    >
      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">1. À quoi s’applique ce tarif ?</p>
        <ChampSelect
          name="produitId"
          label="Formule"
          required
          placeholder="Choisir une formule…"
          value={produitId}
          onChange={(e) => setProduitId(e.target.value)}
          options={produits.map((p) => ({ valeur: p.id, libelle: libelleFormule(p) }))}
        />
        <ChampSelect
          name="souscripteurId"
          label="Société"
          value={societeId}
          onChange={(e) => setSocieteId(e.target.value)}
          options={[
            { valeur: '', libelle: 'Tarif standard (toutes les sociétés)' },
            ...souscripteurs.map((s) => ({ valeur: s.id, libelle: `Négocié — ${s.nom}` })),
          ]}
        />
      </div>

      {produitId && (
        <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
          <p className="font-medium">Tranches déjà définies ({societeId ? 'négociées' : 'standard'})</p>
          {existantes.length === 0 ? (
            <p className="text-muted-foreground">Aucune : commencez par 0 an.</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {existantes.map((g) => (
                <li key={g.id}>
                  {g.trancheAgeMin} – {g.trancheAgeMax} ans : <span className="text-foreground">{montantF(g.montantMensuel)}</span>
                </li>
              ))}
              {dernier !== null && dernier < 150 && <li className="text-foreground">Suite à saisir à partir de {dernier + 1} ans.</li>}
            </ul>
          )}
        </div>
      )}

      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">2. Tranche d’âge et montant</p>
        <div className="grid grid-cols-2 gap-3">
          <ChampNombre
            key={`min-${produitId}-${societeId}-${dernier}`}
            name="trancheAgeMin"
            label="Âge min."
            required
            min={0}
            max={150}
            step={1}
            defaultValue={dernier !== null ? Math.min(dernier + 1, 150) : 0}
          />
          <ChampNombre name="trancheAgeMax" label="Âge max." required min={0} max={150} step={1} defaultValue={dernier !== null ? Math.min(dernier + 20, 150) : 17} />
        </div>
        <ChampNombre name="montantMensuel" label="Montant mensuel (FCFA)" required min={0} step="0.01" aide="Par personne et par mois pour cette tranche d’âge." />
      </div>
    </FormulaireModal>
  );
}
