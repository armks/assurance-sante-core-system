'use client';

import { Building2, Moon, Navigation, Pill, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { CarteResume, DataTable, GrilleCartes, StatutBadge, type ColonneTable } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { libelleCategorieEtablissement } from '@/lib/reseau';

import { ouvrirItineraire, prechargerPosition } from './itineraire';
import { LIBELLE_TYPE_LIEU, type LieuAnnuaire } from './lieu';

const CLASSE_CHAMP =
  'h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

const options = (valeurs: (string | null)[], libelle: (v: string) => string = (v) => v) =>
  [...new Set(valeurs.filter((v): v is string => !!v))]
    .sort((a, b) => libelle(a).localeCompare(libelle(b), 'fr'))
    .map((v) => ({ valeur: v, libelle: libelle(v) }));

const libelleType = (t: string) => LIBELLE_TYPE_LIEU[t] ?? t;

/**
 * Annuaire du réseau de soins (établissements + pharmacies), partagé entre l'espace adhérent et la page publique
 * `/reseau-de-soins`. Même présentation que les autres tableaux : filtres sur une ligne (recherche, ville, commune, type,
 * garde), cumul en tête qui suit les filtres, tableau triable. Un clic sur un lieu ouvre l'itinéraire Google Maps depuis la
 * position de l'utilisateur. Le composant ne connaît pas la source des données : chaque page lui passe des `LieuAnnuaire`
 * déjà réduits côté serveur.
 */
export function ReseauSoinsRecherche({ lieux, parPage = 15 }: { lieux: LieuAnnuaire[]; parPage?: number }) {
  // position lue en arrière-plan (si déjà autorisée) : le clic sur « Itinéraire » ne l'attend jamais
  useEffect(() => prechargerPosition(), []);

  const [q, setQ] = useState('');
  const [ville, setVille] = useState('');
  const [commune, setCommune] = useState('');
  const [type, setType] = useState('');
  const [garde, setGarde] = useState('');

  const optVilles = useMemo(() => options(lieux.map((l) => l.ville)), [lieux]);
  const optCommunes = useMemo(
    () => options(lieux.filter((l) => !ville || l.ville === ville).map((l) => l.commune)),
    [lieux, ville],
  );
  const optTypes = useMemo(() => options(lieux.map((l) => l.type), libelleType), [lieux]);
  const avecCategorie = lieux.some((l) => l.categorieEtablissement);

  const visibles = useMemo(() => {
    const mot = q.trim().toLowerCase();
    return lieux.filter((l) => {
      if (mot && !`${l.nom} ${l.ville ?? ''} ${l.commune ?? ''} ${l.adresse ?? ''}`.toLowerCase().includes(mot)) return false;
      if (ville && l.ville !== ville) return false;
      if (commune && l.commune !== commune) return false;
      if (type && l.type !== type) return false;
      if (garde === 'OUI' && !l.gardeWeekend) return false;
      if (garde === 'NON' && l.gardeWeekend) return false;
      return true;
    });
  }, [lieux, q, ville, commune, type, garde]);

  const nbPharmacies = visibles.filter((l) => l.categorie === 'PHARMACIE').length;
  const filtresActifs = Boolean(q || ville || commune || type || garde);

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
    ...(avecCategorie
      ? [
          {
            cle: 'categorieEtablissement',
            entete: 'Catégorie',
            rendu: (l: LieuAnnuaire) => (l.categorieEtablissement ? libelleCategorieEtablissement(l.categorieEtablissement) : '—'),
          } as ColonneTable<LieuAnnuaire>,
        ]
      : []),
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
    <div className="space-y-4">
      {/* --- filtres sur une ligne --- */}
      <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nom, ville ou commune…"
            aria-label="Rechercher un établissement ou une pharmacie"
            className="h-9 pl-8"
          />
        </div>
        <select
          value={ville}
          onChange={(e) => {
            setVille(e.target.value);
            setCommune('');
          }}
          aria-label="Ville"
          className={`${CLASSE_CHAMP} shrink-0`}
        >
          <option value="">Toutes les villes</option>
          {optVilles.map((o) => (
            <option key={o.valeur} value={o.valeur}>
              {o.libelle}
            </option>
          ))}
        </select>
        <select value={commune} onChange={(e) => setCommune(e.target.value)} aria-label="Commune" className={`${CLASSE_CHAMP} shrink-0`}>
          <option value="">Toutes les communes</option>
          {optCommunes.map((o) => (
            <option key={o.valeur} value={o.valeur}>
              {o.libelle}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type" className={`${CLASSE_CHAMP} shrink-0`}>
          <option value="">Tous les types</option>
          {optTypes.map((o) => (
            <option key={o.valeur} value={o.valeur}>
              {o.libelle}
            </option>
          ))}
        </select>
        <select value={garde} onChange={(e) => setGarde(e.target.value)} aria-label="Garde" className={`${CLASSE_CHAMP} shrink-0`}>
          <option value="">Garde : tous</option>
          <option value="OUI">De garde le week-end</option>
          <option value="NON">Pas de garde</option>
        </select>
        {filtresActifs && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="shrink-0"
            onClick={() => {
              setQ('');
              setVille('');
              setCommune('');
              setType('');
              setGarde('');
            }}
          >
            Réinitialiser
          </Button>
        )}
      </div>

      {/* --- cumul (suit les filtres) --- */}
      <GrilleCartes>
        <CarteResume libelle="Lieux trouvés" valeur={visibles.length} icon={Search} indice={`sur ${lieux.length} dans le réseau`} />
        <CarteResume libelle="Établissements de santé" valeur={visibles.length - nbPharmacies} icon={Building2} />
        <CarteResume libelle="Pharmacies" valeur={nbPharmacies} icon={Pill} />
        <CarteResume libelle="De garde le week-end" valeur={visibles.filter((l) => l.gardeWeekend).length} icon={Moon} />
      </GrilleCartes>

      <DataTable
        donnees={visibles}
        cleLigne={(l) => `${l.categorie}-${l.id}`}
        colonnes={colonnes}
        parPage={parPage}
        actionLigne={(l) => (
          <Button type="button" size="xs" variant="ghost" onClick={() => ouvrirItineraire(l)}>
            <Navigation aria-hidden="true" />
            Itinéraire
            <span className="sr-only"> vers {l.nom} (nouvel onglet)</span>
          </Button>
        )}
        vide={lieux.length === 0 ? 'Aucun établissement ni pharmacie dans le réseau pour l’instant.' : 'Aucun lieu ne correspond à ces critères.'}
      />
    </div>
  );
}
