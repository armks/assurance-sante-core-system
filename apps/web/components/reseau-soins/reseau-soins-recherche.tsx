'use client';

import { Building2, LocateFixed, Moon, Navigation, Pill, Search } from 'lucide-react';
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

const RAYONS_KM = [1, 2, 5, 10, 20, 50];

type Point = { lat: number; lng: number };

/** Distance à vol d'oiseau (formule de haversine), en km. */
function distanceKm(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

const aPosition = (l: LieuAnnuaire): l is LieuAnnuaire & { latitude: number; longitude: number } =>
  l.latitude !== null && l.longitude !== null;

const formatKm = (km: number) => (km < 10 ? `${km.toFixed(1).replace('.', ',')} km` : `${Math.round(km)} km`);

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
  const [categorie, setCategorie] = useState<'' | 'ETABLISSEMENT' | 'PHARMACIE'>('');
  const [rayon, setRayon] = useState('');
  const [position, setPosition] = useState<Point | null>(null);
  const [geo, setGeo] = useState<'repos' | 'lecture' | 'refusee' | 'indisponible'>('repos');

  const autourDeMoi = () => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGeo('indisponible');
      return;
    }
    setGeo('lecture');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPosition({ lat: p.coords.latitude, lng: p.coords.longitude });
        setRayon((r) => r || '5');
        setGeo('repos');
      },
      (e) => setGeo(e.code === e.PERMISSION_DENIED ? 'refusee' : 'indisponible'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  };

  const optVilles = useMemo(() => options(lieux.map((l) => l.ville)), [lieux]);
  const optCommunes = useMemo(
    () => options(lieux.filter((l) => !ville || l.ville === ville).map((l) => l.commune)),
    [lieux, ville],
  );
  const optTypes = useMemo(
    () => options(lieux.filter((l) => !categorie || l.categorie === categorie).map((l) => l.type), libelleType),
    [lieux, categorie],
  );
  const avecCategorie = lieux.some((l) => l.categorieEtablissement);

  // Centre de la recherche par rayon : la position de l'utilisateur, sinon le centre de la zone (commune ou ville) choisie.
  const centre = useMemo<{ point: Point; libelle: string } | null>(() => {
    if (position) return { point: position, libelle: 'votre position' };
    const zone = lieux.filter((l) => aPosition(l) && (commune ? l.commune === commune : ville ? l.ville === ville : false));
    if (zone.length === 0) return null;
    const lat = zone.reduce((t, l) => t + (l.latitude as number), 0) / zone.length;
    const lng = zone.reduce((t, l) => t + (l.longitude as number), 0) / zone.length;
    return { point: { lat, lng }, libelle: commune || ville };
  }, [position, lieux, ville, commune]);
  const rayonKm = rayon === '' ? null : Number(rayon);
  const parRayon = rayonKm !== null && centre !== null;

  const { visibles, distances, sansPosition } = useMemo(() => {
    const mot = q.trim().toLowerCase();
    const dist = new Map<string, number>();
    let exclus = 0;
    const liste = lieux.filter((l) => {
      if (mot && !`${l.nom} ${l.ville ?? ''} ${l.commune ?? ''} ${l.adresse ?? ''}`.toLowerCase().includes(mot)) return false;
      if (categorie && l.categorie !== categorie) return false;
      if (type && l.type !== type) return false;
      if (garde === 'OUI' && !l.gardeWeekend) return false;
      if (garde === 'NON' && l.gardeWeekend) return false;
      if (parRayon && centre) {
        // recherche par rayon : la distance remplace le filtre ville / commune (qui ne sert alors qu'à placer le centre)
        if (!aPosition(l)) {
          exclus += 1;
          return false;
        }
        const d = distanceKm(centre.point, { lat: l.latitude, lng: l.longitude });
        if (d > (rayonKm as number)) return false;
        dist.set(`${l.categorie}-${l.id}`, d);
        return true;
      }
      if (ville && l.ville !== ville) return false;
      if (commune && l.commune !== commune) return false;
      return true;
    });
    if (parRayon) liste.sort((a, b) => (dist.get(`${a.categorie}-${a.id}`) ?? 0) - (dist.get(`${b.categorie}-${b.id}`) ?? 0));
    return { visibles: liste, distances: dist, sansPosition: exclus };
  }, [lieux, q, ville, commune, type, garde, categorie, parRayon, centre, rayonKm]);

  const nbPharmacies = visibles.filter((l) => l.categorie === 'PHARMACIE').length;
  const filtresActifs = Boolean(q || ville || commune || type || garde || categorie || rayon || position);

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
    ...(parRayon
      ? [
          {
            cle: 'distance',
            entete: 'Distance',
            aligneDroite: true,
            rendu: (l: LieuAnnuaire) => {
              const d = distances.get(`${l.categorie}-${l.id}`);
              return d === undefined ? '—' : <span className="font-medium">{formatKm(d)}</span>;
            },
          } as ColonneTable<LieuAnnuaire>,
        ]
      : []),
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
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Catégorie" className="inline-flex overflow-hidden rounded-md border">
          {([['', 'Tous'], ['ETABLISSEMENT', 'Établissements'], ['PHARMACIE', 'Pharmacies']] as const).map(([v, libelle]) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setCategorie(v);
                setType('');
              }}
              aria-pressed={categorie === v}
              className={`px-3 py-1.5 text-sm transition-colors ${
                categorie === v ? 'bg-primary text-primary-foreground' : 'bg-transparent hover:bg-muted'
              }`}
            >
              {libelle}
            </button>
          ))}
        </div>
        <Button type="button" size="sm" variant={position ? 'default' : 'outline'} onClick={autourDeMoi} disabled={geo === 'lecture'}>
          <LocateFixed aria-hidden="true" />
          {geo === 'lecture' ? 'Localisation…' : position ? 'Position trouvée' : 'Autour de moi'}
        </Button>
        <select suppressHydrationWarning /* HYDRATATION-IOS */ value={rayon} onChange={(e) => setRayon(e.target.value)} aria-label="Rayon de recherche" className={`${CLASSE_CHAMP} shrink-0`}>
          <option value="">Rayon : tous</option>
          {RAYONS_KM.map((km) => (
            <option key={km} value={km}>
              {`Dans ${km} km`}
            </option>
          ))}
        </select>
        {geo === 'refusee' && <p className="text-sm text-destructive">Localisation refusée : autorisez-la dans le navigateur, ou choisissez une commune.</p>}
        {geo === 'indisponible' && <p className="text-sm text-destructive">Localisation indisponible : choisissez une commune pour centrer la recherche.</p>}
        {rayon !== '' && !centre && geo === 'repos' && (
          <p className="text-sm text-muted-foreground">Pour chercher dans un rayon, cliquez sur « Autour de moi » ou choisissez une ville / commune.</p>
        )}
        {parRayon && centre && (
          <p className="text-sm text-muted-foreground">
            Dans {rayon} km autour de {centre.libelle}
            {sansPosition > 0 ? ` · ${sansPosition} lieu(x) sans position GPS non comptés` : ''}.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap sm:overflow-x-auto">
        <div className="relative w-full min-w-0 sm:w-auto sm:min-w-40 sm:flex-1">
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
          suppressHydrationWarning /* HYDRATATION-IOS */
          value={ville}
          onChange={(e) => {
            setVille(e.target.value);
            setCommune('');
          }}
          title={position && parRayon ? 'Avec votre position et un rayon, la distance remplace le filtre ville / commune.' : undefined}
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
        <select suppressHydrationWarning /* HYDRATATION-IOS */ value={commune} onChange={(e) => setCommune(e.target.value)} aria-label="Commune" className={`${CLASSE_CHAMP} shrink-0`}>
          <option value="">Toutes les communes</option>
          {optCommunes.map((o) => (
            <option key={o.valeur} value={o.valeur}>
              {o.libelle}
            </option>
          ))}
        </select>
        <select suppressHydrationWarning /* HYDRATATION-IOS */ value={type} onChange={(e) => setType(e.target.value)} aria-label="Type" className={`${CLASSE_CHAMP} shrink-0`}>
          <option value="">Tous les types</option>
          {optTypes.map((o) => (
            <option key={o.valeur} value={o.valeur}>
              {o.libelle}
            </option>
          ))}
        </select>
        <select suppressHydrationWarning /* HYDRATATION-IOS */ value={garde} onChange={(e) => setGarde(e.target.value)} aria-label="Garde" className={`${CLASSE_CHAMP} shrink-0`}>
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
              setCategorie('');
              setRayon('');
              setPosition(null);
              setGeo('repos');
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
