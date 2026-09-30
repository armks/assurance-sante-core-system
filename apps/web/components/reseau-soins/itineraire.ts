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

/**
 * Ouvre l'itinéraire dans un nouvel onglet, depuis la position du navigateur.
 * L'onglet est ouvert tout de suite (dans le geste de l'utilisateur, sinon le
 * bloqueur de fenêtres surgissantes l'empêcherait après l'attente de la
 * géolocalisation), puis dirigé vers Google Maps : avec `origin` si la position
 * est obtenue, sans (destination seule) si elle est refusée, indisponible ou
 * trop lente.
 */
export function ouvrirItineraire(lieu: LieuAnnuaire): void {
  const onglet = window.open('', '_blank');
  if (onglet) {
    onglet.opener = null;
    onglet.document.title = 'Itinéraire…';
    onglet.document.body.textContent = `Calcul de l’itinéraire vers ${lieu.nom}…`;
  }
  let fait = false;
  const aller = (origine?: { lat: number; lng: number }) => {
    if (fait) return;
    fait = true;
    const url = urlItineraire(lieu, origine);
    if (onglet && !onglet.closed) onglet.location.replace(url);
    else window.open(url, '_blank', 'noopener');
  };
  if (!('geolocation' in navigator)) return aller();
  navigator.geolocation.getCurrentPosition(
    (p) => aller({ lat: p.coords.latitude, lng: p.coords.longitude }),
    () => aller(),
    { timeout: 10_000, maximumAge: 5 * 60_000 },
  );
  // Filet : l'utilisateur ignore la demande d'autorisation sans répondre.
  window.setTimeout(() => aller(), 15_000);
}
