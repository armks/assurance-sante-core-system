import { Injectable, Logger } from '@nestjs/common';

interface AdresseGeocodable {
  adresseComplete?: string | null;
  quartier?: string | null;
  commune?: string | null;
  ville?: string | null;
  pays?: string | null;
}

/**
 * GeocodageService — résolution d'adresse → coordonnées via **Nominatim**
 * (OpenStreetMap, gratuit).
 *
 * Politique d'usage Nominatim respectée :
 *  - **un seul appel** par création (jamais de lot) ;
 *  - `User-Agent` identifiant l'application (`NOMINATIM_USER_AGENT`, obligatoire
 *    côté Nominatim) ;
 *  - timeout court, échec silencieux (le géocodage est best-effort, il ne bloque
 *    jamais la création — l'agent pourra saisir les coordonnées à la main).
 */
@Injectable()
export class GeocodageService {
  private readonly logger = new Logger(GeocodageService.name);

  private readonly baseUrl = (
    process.env.NOMINATIM_BASE_URL ?? 'https://nominatim.openstreetmap.org'
  ).replace(/\/$/, '');
  private readonly userAgent =
    process.env.NOMINATIM_USER_AGENT ??
    'assurance-sante-core-system/1.0 (+https://github.com/armks/assurance-sante-core-system)';
  private readonly timeoutMs = Number(process.env.NOMINATIM_TIMEOUT_MS ?? 5000);

  /** `true` si l'adresse contient assez d'éléments pour tenter un géocodage. */
  static estGeocodable(a: AdresseGeocodable): boolean {
    return Boolean(a.adresseComplete || a.ville || a.commune);
  }

  private construireRequete(a: AdresseGeocodable): string {
    return [a.adresseComplete, a.quartier, a.commune, a.ville, a.pays]
      .map((s) => (s ?? '').trim())
      .filter(Boolean)
      .join(', ');
  }

  /**
   * Résout `{ latitude, longitude }` ou `null` (aucun résultat / erreur / non
   * géocodable).
   */
  async geocoder(
    a: AdresseGeocodable,
  ): Promise<{ latitude: number; longitude: number } | null> {
    if (!GeocodageService.estGeocodable(a)) {
      return null;
    }

    const requete = this.construireRequete(a);
    const url =
      `${this.baseUrl}/search?format=jsonv2&limit=1&addressdetails=0` +
      `&q=${encodeURIComponent(requete)}`;

    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        signal: controleur.signal,
      });
      if (!res.ok) {
        this.logger.warn(`Nominatim a répondu ${res.status} pour « ${requete} »`);
        return null;
      }
      const corps = (await res.json()) as Array<{ lat?: string; lon?: string }>;
      const premier = Array.isArray(corps) ? corps[0] : undefined;
      const latitude = Number(premier?.lat);
      const longitude = Number(premier?.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }
      return { latitude, longitude };
    } catch (err) {
      this.logger.warn(
        `Géocodage impossible pour « ${requete} » : ${
          err instanceof Error ? err.message : 'erreur inconnue'
        }`,
      );
      return null;
    } finally {
      clearTimeout(minuteur);
    }
  }
}
