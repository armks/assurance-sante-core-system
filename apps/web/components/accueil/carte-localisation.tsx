'use client';

import 'leaflet/dist/leaflet.css';

import type { Map as CarteLeaflet, Marker } from 'leaflet';
import { Crosshair, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Abidjan (Plateau) : zoom 13, assez serré pour viser un quartier puis zoomer. */
const CENTRE_ABIDJAN: [number, number] = [5.32, -4.02];
const ZOOM_DEPART = 13;

const coordonnee = (v: string, max: number): number | null => {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
};

/**
 * Position de l'établissement (formulaire « Devenir partenaire »). Carte
 * Leaflet + tuiles OpenStreetMap, comme le géocodage Nominatim de l'API.
 * Un clic place le repère et remplit latitude / longitude ; le repère se
 * glisse pour ajuster ; les deux champs restent modifiables à la main et
 * déplacent le repère. Sans clavier-souris, « Placer au centre » pose le repère
 * au centre de la carte (déplaçable aux flèches une fois la carte sélectionnée).
 *
 * Leaflet touche `window` dès son import : chargé à l'exécution, côté
 * navigateur uniquement.
 */
export function CarteLocalisation({ idBase }: { idBase: string }) {
  const conteneur = useRef<HTMLDivElement>(null);
  const carte = useRef<CarteLeaflet | null>(null);
  const repere = useRef<Marker | null>(null);
  const creerRepere = useRef<((lat: number, lon: number) => Marker) | null>(null);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [pret, setPret] = useState(false);

  const placer = (lat: number, lon: number) => {
    setLatitude(lat.toFixed(6));
    setLongitude(lon.toFixed(6));
  };

  useEffect(() => {
    let annule = false;
    void import('leaflet').then(({ default: L }) => {
      if (annule || !conteneur.current) return;
      const m = L.map(conteneur.current, { center: CENTRE_ABIDJAN, zoom: ZOOM_DEPART, scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m);
      // La molette ne zoome qu'une fois la carte choisie : pas de piège au défilement de la page.
      m.on('focus', () => m.scrollWheelZoom.enable());
      m.on('blur', () => m.scrollWheelZoom.disable());
      m.on('click', (e) => placer(e.latlng.lat, e.latlng.lng));

      const icone = L.divIcon({
        className: '',
        html: '<span class="block size-5 rounded-full border-[3px] border-white bg-primary shadow-md ring-4 ring-primary/30"></span>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      creerRepere.current = (lat, lon) => {
        const r = L.marker([lat, lon], { icon: icone, draggable: true, keyboard: false, title: 'Position de l’établissement' });
        r.on('dragend', () => {
          const p = r.getLatLng();
          placer(p.lat, p.lng);
        });
        return r.addTo(m);
      };
      carte.current = m;
      setPret(true); // affiche un repère déjà saisi avant le chargement de Leaflet
    });
    return () => {
      annule = true;
      carte.current?.remove();
      carte.current = null;
      repere.current = null;
    };
  }, []);

  // Champs → repère (clic, glisser ou saisie manuelle : une seule source, les champs).
  useEffect(() => {
    const m = carte.current;
    if (!m) return;
    const lat = coordonnee(latitude, 90);
    const lon = coordonnee(longitude, 180);
    if (lat === null || lon === null) {
      repere.current?.remove();
      repere.current = null;
      return;
    }
    if (repere.current) repere.current.setLatLng([lat, lon]);
    else if (creerRepere.current) repere.current = creerRepere.current(lat, lon);
    // Recentrage différé : pendant la frappe (« 5 », « 5.3 »…), la carte ne saute pas.
    const t = window.setTimeout(() => {
      if (!m.getBounds().contains([lat, lon])) m.panTo([lat, lon]);
    }, 500);
    return () => window.clearTimeout(t);
  }, [latitude, longitude, pret]);

  const effacer = () => {
    setLatitude('');
    setLongitude('');
  };

  return (
    <fieldset className="grid gap-3 sm:col-span-2">
      <legend className="mb-2 text-sm font-medium leading-none">
        Localisation de l’établissement <span className="font-normal text-muted-foreground">(facultatif)</span>
      </legend>
      <p id={`${idBase}-aide-carte`} className="text-xs text-muted-foreground">
        Cliquez sur la carte pour placer votre établissement, glissez le repère pour ajuster, ou saisissez les
        coordonnées.
      </p>
      <div
        ref={conteneur}
        role="application"
        aria-label="Carte : cliquez pour placer votre établissement"
        aria-describedby={`${idBase}-aide-carte`}
        className="relative isolate z-0 h-64 overflow-hidden rounded-md border border-input bg-muted sm:h-72"
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="grid gap-2">
          <Label htmlFor={`${idBase}-latitude`}>Latitude</Label>
          <Input
            id={`${idBase}-latitude`}
            name="latitude"
            type="number"
            step="any"
            min={-90}
            max={90}
            inputMode="decimal"
            placeholder="ex. 5,32"
            required={longitude.trim() !== ''}
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idBase}-longitude`}>Longitude</Label>
          <Input
            id={`${idBase}-longitude`}
            name="longitude"
            type="number"
            step="any"
            min={-180}
            max={180}
            inputMode="decimal"
            placeholder="ex. -4,02"
            required={latitude.trim() !== ''}
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
          />
        </div>
        <div className="col-span-2 flex gap-2 sm:col-span-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const c = carte.current?.getCenter();
              if (c) placer(c.lat, c.lng);
            }}
          >
            <Crosshair aria-hidden="true" />
            Placer au centre
          </Button>
          {/* Toujours rendu (place réservée) : les champs ne bougent pas quand il apparaît. */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={effacer}
            className={latitude || longitude ? undefined : 'invisible'}
          >
            <X aria-hidden="true" />
            Effacer
          </Button>
        </div>
      </div>
    </fieldset>
  );
}
