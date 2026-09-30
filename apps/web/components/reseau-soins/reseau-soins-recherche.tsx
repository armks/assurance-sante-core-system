'use client';

import { Navigation } from 'lucide-react';
import { useMemo } from 'react';

import { DataTable, StatutBadge, type ColonneTable, type FiltreSelect } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';

import { ouvrirItineraire } from './itineraire';
import { LIBELLE_TYPE_LIEU, type LieuAnnuaire } from './lieu';

const options = (valeurs: (string | null)[], libelle: (v: string) => string = (v) => v) =>
  [...new Set(valeurs.filter((v): v is string => !!v))]
    .sort((a, b) => libelle(a).localeCompare(libelle(b), 'fr'))
    .map((v) => ({ valeur: v, libelle: libelle(v) }));

const libelleType = (t: string) => LIBELLE_TYPE_LIEU[t] ?? t;

/**
 * Annuaire du réseau de soins (établissements + pharmacies), partagé entre
 * l'espace adhérent et la page publique `/reseau-de-soins`. Filtres combinables
 * (ville, type, commune, garde le week-end) et recherche par nom : ceux du
 * `DataTable`. Un clic sur un lieu ouvre l'itinéraire Google Maps depuis la
 * position de l'utilisateur. Le composant ne connaît pas la source des données :
 * chaque page lui passe des `LieuAnnuaire` déjà réduits côté serveur.
 */
export function ReseauSoinsRecherche({ lieux, parPage = 15 }: { lieux: LieuAnnuaire[]; parPage?: number }) {
  const filtres: FiltreSelect[] = useMemo(
    () => [
      { cle: 'ville', libelle: 'Ville', options: options(lieux.map((l) => l.ville)) },
      { cle: 'type', libelle: 'Type', options: options(lieux.map((l) => l.type), libelleType) },
      { cle: 'commune', libelle: 'Commune', options: options(lieux.map((l) => l.commune)) },
      {
        cle: 'garde',
        libelle: 'Garde',
        options: [
          { valeur: 'OUI', libelle: 'De garde le week-end' },
          { valeur: 'NON', libelle: 'Pas de garde' },
        ],
        valeur: (row) => ((row as LieuAnnuaire).gardeWeekend ? 'OUI' : 'NON'),
      },
    ],
    [lieux],
  );

  const colonnes: ColonneTable<LieuAnnuaire>[] = [
    {
      cle: 'nom',
      entete: 'Nom',
      triable: true,
      rendu: (l) => (
        <button
          type="button"
          onClick={() => ouvrirItineraire(l)}
          className="rounded-sm text-left font-medium underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {l.nom}
          <span className="sr-only"> : itinéraire (nouvel onglet)</span>
        </button>
      ),
    },
    { cle: 'type', entete: 'Type', triable: true, valeur: (l) => libelleType(l.type), rendu: (l) => libelleType(l.type) },
    {
      cle: 'ville',
      entete: 'Ville / commune',
      triable: true,
      valeur: (l) => [l.ville, l.commune].filter(Boolean).join(' '),
      rendu: (l) => [l.ville, l.commune].filter(Boolean).join(' · ') || '—',
    },
    {
      cle: 'gardeWeekend',
      entete: 'Garde',
      triable: true,
      valeur: (l) => (l.gardeWeekend ? 0 : 1),
      rendu: (l) =>
        l.gardeWeekend ? (
          <StatutBadge statut="GARDE" ton="succes" libelle="De garde le week-end" />
        ) : (
          <StatutBadge statut="PAS_GARDE" ton="neutre" libelle="Pas de garde" />
        ),
    },
  ];

  return (
    <DataTable
      donnees={lieux}
      cleLigne={(l) => `${l.categorie}-${l.id}`}
      colonnes={colonnes}
      filtres={filtres}
      recherche={{ placeholder: 'Nom, ville ou commune…', champs: ['nom', 'ville', 'commune'] }}
      parPage={parPage}
      actionLigne={(l) => (
        <Button type="button" size="xs" variant="ghost" onClick={() => ouvrirItineraire(l)}>
          <Navigation aria-hidden="true" />
          Itinéraire
          <span className="sr-only"> vers {l.nom} (nouvel onglet)</span>
        </Button>
      )}
      vide="Aucun établissement ni pharmacie dans le réseau pour l’instant."
    />
  );
}
