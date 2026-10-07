import { LIBELLE_TYPE_ETABLISSEMENT } from '@/lib/reseau';

/**
 * Annuaire du réseau de soins : forme commune d'un lieu, quelle que soit la
 * source (API authentifiée `/provider/recherche` ou vues publiques
 * `etablissements_sante_public` / `pharmacies_public`). Les conversions ci-dessous
 * tournent côté serveur : seuls ces champs partent vers le navigateur.
 */
export interface LieuAnnuaire {
  id: string;
  categorie: 'ETABLISSEMENT' | 'PHARMACIE';
  nom: string;
  /** `typeEtablissement` pour un établissement, `PHARMACIE` pour une pharmacie. */
  type: string;
  ville: string | null;
  commune: string | null;
  gardeWeekend: boolean;
  latitude: number | null;
  longitude: number | null;
  /** Adresse lisible (espace connecté uniquement : absente des vues publiques). */
  adresse: string | null;
}

export const LIBELLE_TYPE_LIEU: Record<string, string> = {
  ...LIBELLE_TYPE_ETABLISSEMENT,
  PHARMACIE: 'Pharmacie',
};

const texte = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const nombre = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Ligne de `GET /provider/recherche` (établissement ou pharmacie, Prisma camelCase). */
export function depuisApi(l: Record<string, unknown>, categorie: LieuAnnuaire['categorie']): LieuAnnuaire {
  return {
    id: String(l.id),
    categorie,
    nom: String(l.nom ?? ''),
    type: categorie === 'PHARMACIE' ? 'PHARMACIE' : String(l.typeEtablissement ?? ''),
    ville: texte(l.ville),
    commune: texte(l.commune),
    gardeWeekend: l.gardeWeekend === true,
    latitude: nombre(l.latitude),
    longitude: nombre(l.longitude),
    adresse: [texte(l.adresseComplete), texte(l.quartier)].filter(Boolean).join(', ') || null,
  };
}

/** Ligne d'une vue publique (snake_case, colonnes limitées par la vue). */
export function depuisVuePublique(l: Record<string, unknown>, categorie: LieuAnnuaire['categorie']): LieuAnnuaire {
  return {
    id: String(l.id),
    categorie,
    nom: String(l.nom ?? ''),
    type: categorie === 'PHARMACIE' ? 'PHARMACIE' : String(l.type_etablissement ?? ''),
    ville: texte(l.ville),
    commune: texte(l.commune),
    gardeWeekend: l.garde_weekend === true,
    latitude: nombre(l.latitude),
    longitude: nombre(l.longitude),
    adresse: null,
  };
}

/** Tri stable pour l'affichage initial : par nom. */
export const parNom = (a: LieuAnnuaire, b: LieuAnnuaire) => a.nom.localeCompare(b.nom, 'fr');
