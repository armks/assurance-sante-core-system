/**
 * ============================================================================
 * PHOTO-TEMPORAIRE — images de banque d'images libres de droits (Pexels),
 * utilisées en attendant de VRAIES photos (établissements du réseau, équipe,
 * agences). À REMPLACER : il suffit de déposer les nouveaux fichiers dans
 * `public/images/accueil/` (mêmes noms) ou de changer `src` ci-dessous.
 * Pour les retrouver : chercher « PHOTO-TEMPORAIRE » dans le code.
 *
 * Licence Pexels (https://www.pexels.com/license/) : usage commercial gratuit,
 * attribution non obligatoire. Fichiers téléchargés localement (pas de lien
 * direct vers le CDN Pexels) : chargement plus rapide, aucune dépendance externe.
 * ============================================================================
 */
export interface PhotoAccueil {
  src: string;
  alt: string;
  largeur: number;
  hauteur: number;
  /** Page d'origine, pour retrouver la photo et son auteur. */
  source: string;
}

export const PHOTOS = {
  // PHOTO-TEMPORAIRE
  heroSoins: {
    src: '/images/accueil/hero-soins.jpg',
    alt: 'Un médecin et une infirmière consultent ensemble un dossier médical dans un couloir de clinique.',
    largeur: 1920,
    hauteur: 1280,
    source: 'https://www.pexels.com/photo/6129154/',
  },
  // PHOTO-TEMPORAIRE
  heroPharmacie: {
    src: '/images/accueil/hero-pharmacie.jpg',
    alt: 'Un pharmacien souriant au comptoir d’une pharmacie moderne.',
    largeur: 1920,
    hauteur: 1280,
    source: 'https://www.pexels.com/photo/14797857/',
  },
  // PHOTO-TEMPORAIRE
  heroPilotage: {
    src: '/images/accueil/hero-pilotage.jpg',
    alt: 'Un responsable présente des indicateurs à son équipe dans une salle de réunion.',
    largeur: 1920,
    hauteur: 1280,
    source: 'https://www.pexels.com/photo/9301257/',
  },
  // PHOTO-TEMPORAIRE
  equipe: {
    src: '/images/accueil/equipe.jpg',
    alt: 'Une équipe échange autour d’une table de réunion.',
    largeur: 1400,
    hauteur: 933,
    source: 'https://www.pexels.com/photo/3869649/',
  },
  // PHOTO-TEMPORAIRE
  consultation: {
    src: '/images/accueil/consultation.jpg',
    alt: 'Une médecin reçoit un patient en consultation dans un cabinet lumineux.',
    largeur: 1400,
    hauteur: 2100,
    source: 'https://www.pexels.com/photo/7580254/',
  },
} satisfies Record<string, PhotoAccueil>;
