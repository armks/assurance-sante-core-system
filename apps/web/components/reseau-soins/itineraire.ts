import type { LieuAnnuaire } from './lieu';

/**
 * Adresse en texte : nom, adresse, commune, ville, pays — sans répéter un
 * segment déjà présent (une adresse saisie contient souvent déjà la commune).
 */
function adresseTexte(lieu: LieuAnnuaire): string {
  const vus = new Set<string>();
  return [lieu.nom, ...(lieu.adresse ?? '').split(','), lieu.commune, lieu.ville, 'Côte d’Ivoire']
    .map((s) => s?.trim())
    .filter((s): s is string => {
      if (!s || vus.has(s.toLowerCase())) return false;
      vus.add(s.toLowerCase());
      return true;
    })
    .join(', ');
}

/**
 * Lien Google Maps en mode itinéraire (URL universelle documentée :
 * https://www.google.com/maps/dir/?api=1). `destination` = coordonnées du lieu
 * si connues, sinon son nom et son adresse en texte. `origin` = position de
 * l'utilisateur si elle est connue ; absente, Google Maps part de la position
 * de l'appareil s'il y a accès, ou la demande.
 */
export function urlItineraire(lieu: LieuAnnuaire, origine?: { lat: number; lng: number }): string {
  const destination =
    lieu.latitude !== null && lieu.longitude !== null
      ? `${lieu.latitude},${lieu.longitude}`
      : adresseTexte(lieu);
  const p = new URLSearchParams({ api: '1', destination });
  // 5 décimales ≈ 1 m : largement suffisant pour un itinéraire.
  if (origine) p.set('origin', `${origine.lat.toFixed(5)},${origine.lng.toFixed(5)}`);
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}

/** Dernière position connue du navigateur, gardée en mémoire pour que le clic n'attende jamais la géolocalisation. */
let derniereOrigine: { lat: number; lng: number } | undefined;
let enCours = false;

function lirePosition(): void {
  if (enCours || typeof navigator === 'undefined' || !('geolocation' in navigator)) return;
  enCours = true;
  navigator.geolocation.getCurrentPosition(
    (p) => {
      derniereOrigine = { lat: p.coords.latitude, lng: p.coords.longitude };
      enCours = false;
    },
    () => {
      enCours = false;
    },
    // précision réseau suffisante pour un itinéraire, et position récente réutilisée (10 min)
    { enableHighAccuracy: false, timeout: 8_000, maximumAge: 10 * 60_000 },
  );
}

/**
 * À appeler à l'ouverture de la page : lit la position EN ARRIÈRE-PLAN, sans bloquer, et seulement si l'autorisation
 * est déjà accordée (aucune fenêtre de permission à l'ouverture de la page).
 */
export function prechargerPosition(): void {
  if (typeof navigator === 'undefined' || !('permissions' in navigator)) return;
  navigator.permissions
    .query({ name: 'geolocation' })
    .then((r) => {
      if (r.state === 'granted') lirePosition();
    })
    .catch(() => undefined);
}

/**
 * Ouvre l'itinéraire dans un nouvel onglet IMMÉDIATEMENT (aucune attente de géolocalisation) : avec la position
 * déjà connue si on l'a, sinon destination seule — Google Maps part alors de la position de l'appareil et la
 * demande lui-même. Le clic lance en même temps une lecture de la position pour que le suivant soit instantané.
 */
export function ouvrirItineraire(lieu: LieuAnnuaire): void {
  window.open(urlItineraire(lieu, derniereOrigine), '_blank', 'noopener');
  lirePosition();
}
