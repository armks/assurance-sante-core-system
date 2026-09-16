'use client';

import { Coins, AlertTriangle, CheckCircle2, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';


import {
  calculerCotisation,
  creerGrille,
  enregistrerPaiement,
  genererCotisation,
  marquerCotisationsEnRetard,
} from '@/app/dashboard-assureur/informatique/cotisations/actions';
import type { Calcul } from '@/app/dashboard-assureur/informatique/cotisations/types';
import {
  CarteResume,
  ChampNombre,
  ChampSelect,
  ChampTexte,
  DataTable,
  FormulaireModal,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
  type ResultatSoumission,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface Cotisation {
  id: string;
  policeId: string;
  adherentId: string | null;
  periode: string;
  montantDu: string;
  montantPaye: string;
  penaliteAppliquee: string;
  dateEcheance: string;
  statut: string;
  police: {
    numeroPolice: string;
    souscripteur: { nom: string; type: string } | null;
    produit: { nom: string } | null;
  } | null;
}
export interface Grille {
  id: string;
  produitId: string;
  souscripteurId: string | null;
  trancheAgeMin: number;
  trancheAgeMax: number;
  montantMensuel: string;
  produit: { nom: string; version: number } | null;
  souscripteur: { nom: string; type: string } | null;
}
export interface OptionPolice {
  id: string;
  numeroPolice: string;
  souscripteur: { nom: string } | null;
  produit: { nom: string; version: number } | null;
}
export interface OptionRef {
  id: string;
  nom: string;
  version?: number;
}

const LIBELLE_COTISATION: Record<string, string> = {
  A_PAYER: 'À payer',
  PAYEE: 'Payée',
  EN_RETARD: 'En retard',
  ANNULEE: 'Annulée',
};

const montant = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === ''
    ? '—'
    : `${Number(v).toLocaleString('fr-FR')} F`;
const periodeFr = (d: string) => {
  const [y, m] = d.slice(0, 7).split('-');
  return `${m}/${y}`;
};
const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';

export function CotisationsEcran({
  cotisations,
  grilles,
  polices,
  souscripteurs,
  produits,
}: {
  cotisations: Cotisation[];
  grilles: Grille[];
  polices: OptionPolice[];
  souscripteurs: OptionRef[];
  produits: OptionRef[];
}) {
  const router = useRouter();
  const [pendingRetard, startRetard] = useTransition();
  const [resRetard, setResRetard] = useState<ResultatSoumission | null>(null);

  const nb = (s: string) => cotisations.filter((c) => c.statut === s).length;
  const totalDu = cotisations
    .filter((c) => c.statut !== 'ANNULEE')
    .reduce((s, c) => s + Number(c.montantDu) - Number(c.montantPaye), 0);

  const periodes = [...new Set(cotisations.map((c) => c.periode.slice(0, 7)))]
    .sort()
    .reverse();

  const colCot: ColonneTable<Cotisation>[] = [
    {
      cle: 'police',
      entete: 'Police',
      triable: true,
      valeur: (c) => c.police?.numeroPolice ?? '',
      rendu: (c) => (
        <span>
          {c.police?.numeroPolice ?? '—'}
          {c.police?.souscripteur && (
            <span className="block text-xs text-muted-foreground">
              {c.police.souscripteur.nom}
            </span>
          )}
        </span>
      ),
    },
    {
      cle: 'periode',
      entete: 'Période',
      triable: true,
      valeur: (c) => c.periode,
      rendu: (c) => periodeFr(c.periode),
    },
    {
      cle: 'montantDu',
      entete: 'Montant dû',
      aligneDroite: true,
      valeur: (c) => Number(c.montantDu),
      rendu: (c) => montant(c.montantDu),
    },
    {
      cle: 'montantPaye',
      entete: 'Montant payé',
      aligneDroite: true,
      valeur: (c) => Number(c.montantPaye),
      rendu: (c) => montant(c.montantPaye),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (c) => (
        <StatutBadge statut={c.statut} libelles={LIBELLE_COTISATION} />
      ),
    },
    {
      cle: 'dateEcheance',
      entete: 'Échéance',
      triable: true,
      valeur: (c) => c.dateEcheance,
      rendu: (c) => dateFr(c.dateEcheance),
    },
  ];

  const colGrille: ColonneTable<Grille>[] = [
    {
      cle: 'produit',
      entete: 'Produit',
      triable: true,
      valeur: (g) => g.produit?.nom ?? '',
      rendu: (g) =>
        g.produit ? `${g.produit.nom} · v${g.produit.version}` : '—',
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
    {
      cle: 'souscripteur',
      entete: 'Souscripteur',
      rendu: (g) => g.souscripteur?.nom ?? '—',
    },
    {
      cle: 'tranche',
      entete: 'Tranche d’âge',
      rendu: (g) => `${g.trancheAgeMin} – ${g.trancheAgeMax} ans`,
    },
    {
      cle: 'montantMensuel',
      entete: 'Montant mensuel',
      aligneDroite: true,
      valeur: (g) => Number(g.montantMensuel),
      rendu: (g) => montant(g.montantMensuel),
    },
  ];

  return (
    <div className="space-y-8">
      <GrilleCartes>
        <CarteResume libelle="Cotisations" valeur={cotisations.length} icon={Coins} />
        <CarteResume libelle="À payer" valeur={nb('A_PAYER')} icon={Wallet} />
        <CarteResume libelle="En retard" valeur={nb('EN_RETARD')} icon={AlertTriangle} />
        <CarteResume
          libelle="Reste à encaisser"
          valeur={montant(totalDu)}
          icon={CheckCircle2}
          indice={`${nb('PAYEE')} payée(s)`}
        />
      </GrilleCartes>

      {/* --- Passage EN_RETARD (tâche déclenchable manuellement) --- */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pendingRetard}
          onClick={() =>
            startRetard(async () =>
              setResRetard(await marquerCotisationsEnRetard()),
            )
          }
        >
          {pendingRetard ? 'Traitement…' : 'Marquer les cotisations en retard'}
        </Button>
        {resRetard && (
          <p
            className={
              resRetard.ok
                ? 'text-sm text-emerald-700 dark:text-emerald-400'
                : 'text-sm text-destructive'
            }
          >
            {resRetard.ok ? resRetard.message : resRetard.error}
          </p>
        )}
      </div>

      {/* --- Cotisations --- */}
      <DataTable
        donnees={cotisations}
        cleLigne={(c) => c.id}
        parPage={12}
        recherche={{
          placeholder: 'N° police, souscripteur…',
          champs: ['police.numeroPolice', 'police.souscripteur.nom'],
        }}
        filtres={[
          {
            cle: 'statut',
            libelle: 'Statut',
            options: Object.entries(LIBELLE_COTISATION).map(([valeur, libelle]) => ({
              valeur,
              libelle,
            })),
          },
          {
            cle: 'periode',
            libelle: 'Période',
            valeur: (row) => (row as Cotisation).periode.slice(0, 7),
            options: periodes.map((p) => ({ valeur: p, libelle: periodeFr(p) })),
          },
        ]}
        colonnes={colCot}
        actions={
          <FormulaireModal
            titre="Calculer une cotisation"
            description="Choisissez la police et la période. Le tarif applicable est affiché avant génération."
            declencheurLabel="Calculer une cotisation"
            libelleSoumettre="Générer la cotisation"
            onSoumettre={async (fd) =>
              genererCotisation({
                policeId: String(fd.get('policeId') ?? ''),
                periode: String(fd.get('periode') ?? ''),
                adherentId: String(fd.get('adherentId') ?? ''),
                age: Number(fd.get('age') ?? 0),
              })
            }
            onSucces={() => router.refresh()}
          >
            <CalculForm polices={polices} />
          </FormulaireModal>
        }
        actionLigne={(c) =>
          c.statut === 'A_PAYER' || c.statut === 'EN_RETARD' ? (
            <FormulaireModal
              titre="Enregistrer un paiement"
              mode="center"
              description={`Cotisation ${c.police?.numeroPolice ?? ''} · ${periodeFr(
                c.periode,
              )} — dû ${montant(c.montantDu)}, déjà payé ${montant(c.montantPaye)}.`}
              declencheur={
                <Button size="xs" variant="ghost">
                  Enregistrer un paiement
                </Button>
              }
              libelleSoumettre="Enregistrer"
              onSoumettre={async (fd) =>
                enregistrerPaiement(c.id, Number(fd.get('montant') ?? 0))
              }
              onSucces={() => router.refresh()}
            >
              <ChampNombre
                name="montant"
                label="Montant du paiement (FCFA)"
                required
                min={0}
                step="0.01"
                defaultValue={String(
                  Math.max(0, Number(c.montantDu) - Number(c.montantPaye)),
                )}
                aide="Le statut ne passe à PAYÉE qu’au règlement complet."
              />
            </FormulaireModal>
          ) : null
        }
        vide="Aucune cotisation."
      />

      {/* --- Grilles tarifaires --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Grilles tarifaires</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            donnees={grilles}
            cleLigne={(g) => g.id}
            parPage={0}
            colonnes={colGrille}
            filtres={[
              {
                cle: 'type',
                libelle: 'Type',
                valeur: (row) =>
                  (row as Grille).souscripteurId ? 'NEGOCIE' : 'STANDARD',
                options: [
                  { valeur: 'STANDARD', libelle: 'Standard' },
                  { valeur: 'NEGOCIE', libelle: 'Négocié' },
                ],
              },
            ]}
            actions={
              <FormulaireModal
                titre="Nouvelle grille négociée"
                description="Tarif propre à un souscripteur : il prime sur le tarif standard du produit pour la tranche d’âge."
                declencheurLabel="Nouvelle grille négociée"
                libelleSoumettre="Créer la grille"
                onSoumettre={async (fd) =>
                  creerGrille({
                    produitId: String(fd.get('produitId') ?? ''),
                    souscripteurId: String(fd.get('souscripteurId') ?? ''),
                    trancheAgeMin: Number(fd.get('trancheAgeMin') ?? 0),
                    trancheAgeMax: Number(fd.get('trancheAgeMax') ?? 0),
                    montantMensuel: Number(fd.get('montantMensuel') ?? 0),
                  })
                }
                onSucces={() => router.refresh()}
              >
                <ChampSelect
                  name="produitId"
                  label="Produit"
                  required
                  placeholder="Choisir un produit…"
                  options={produits.map((p) => ({
                    valeur: p.id,
                    libelle: `${p.nom}${p.version ? ` · v${p.version}` : ''}`,
                  }))}
                />
                <ChampSelect
                  name="souscripteurId"
                  label="Souscripteur"
                  required
                  placeholder="Choisir un souscripteur…"
                  options={souscripteurs.map((s) => ({
                    valeur: s.id,
                    libelle: s.nom,
                  }))}
                />
                <div className="grid grid-cols-2 gap-3">
                  <ChampNombre
                    name="trancheAgeMin"
                    label="Âge min."
                    required
                    min={0}
                    max={150}
                    step={1}
                    defaultValue="18"
                  />
                  <ChampNombre
                    name="trancheAgeMax"
                    label="Âge max."
                    required
                    min={0}
                    max={150}
                    step={1}
                    defaultValue="59"
                  />
                </div>
                <ChampNombre
                  name="montantMensuel"
                  label="Montant mensuel (FCFA)"
                  required
                  min={0}
                  step="0.01"
                />
              </FormulaireModal>
            }
            vide="Aucune grille tarifaire."
          />
        </CardContent>
      </Card>
    </div>
  );
}

/** Champs du calcul + aperçu du tarif applicable avant génération. */
function CalculForm({ polices }: { polices: OptionPolice[] }) {
  const [policeId, setPoliceId] = useState('');
  const [periode, setPeriode] = useState('');
  const [age, setAge] = useState('');
  const [adherentId, setAdherentId] = useState('');
  const [calcul, setCalcul] = useState<Calcul | null>(null);
  const [calcErr, setCalcErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const invalider = () => {
    setCalcul(null);
    setCalcErr(null);
  };

  const calculer = () =>
    start(async () => {
      setCalcErr(null);
      setCalcul(null);
      const r = await calculerCotisation({
        policeId,
        periode,
        age: Number(age),
      });
      if (r.ok) setCalcul(r.calcul);
      else setCalcErr(r.error);
    });

  return (
    <>
      {polices.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucune police ACTIVE. Activez une police avant de générer des
          cotisations.
        </p>
      ) : (
        <ChampSelect
          name="policeId"
          label="Police (actives uniquement)"
          required
          placeholder="Choisir une police…"
          value={policeId}
          onChange={(e) => {
            setPoliceId(e.target.value);
            invalider();
          }}
          options={polices.map((p) => ({
            valeur: p.id,
            libelle: `${p.numeroPolice} — ${p.souscripteur?.nom ?? ''}`,
          }))}
        />
      )}
      <ChampTexte
        name="periode"
        label="Période"
        type="month"
        required
        value={periode}
        onChange={(e) => {
          setPeriode(e.target.value);
          invalider();
        }}
      />
      <div className="grid grid-cols-2 gap-3">
        <ChampNombre
          name="age"
          label="Âge de l’adhérent"
          required
          min={0}
          max={150}
          step={1}
          value={age}
          onChange={(e) => {
            setAge(e.target.value);
            invalider();
          }}
        />
        <ChampTexte
          name="adherentId"
          label="Identifiant adhérent"
          required
          placeholder="UUID de l’adhérent"
          value={adherentId}
          onChange={(e) => setAdherentId(e.target.value)}
        />
      </div>

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || !policeId || !periode || !age}
          onClick={calculer}
        >
          {pending ? 'Calcul…' : 'Calculer le tarif'}
        </Button>
        {calcErr && <p className="mt-2 text-sm text-destructive">{calcErr}</p>}
        {calcul && (
          <div className="mt-2 space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
            <p className="flex items-center gap-2">
              Source du tarif :{' '}
              <StatutBadge
                statut={calcul.source}
                ton={calcul.source === 'NEGOCIE' ? 'info' : 'neutre'}
                libelle={calcul.source === 'NEGOCIE' ? 'Négocié' : 'Standard'}
              />
            </p>
            <p>Tarif de base : {montant(calcul.tarifBase)}</p>
            {calcul.partMembrePourcent < 100 && (
              <p>
                Part membre (collectivité subventionnée) :{' '}
                <b>{calcul.partMembrePourcent} %</b>
              </p>
            )}
            <p className="pt-1 text-base">
              Montant dû : <b>{montant(calcul.montantDu)}</b>
            </p>
          </div>
        )}
      </div>
    </>
  );
}
