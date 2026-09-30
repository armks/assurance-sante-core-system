/**
 * Coordonnées affichées sur la page d'accueil (section Contact, pied de page).
 * À RENSEIGNER : toute valeur vide est simplement masquée à l'affichage
 * (jamais de numéro ou d'adresse inventés).
 */
export const COORDONNEES = {
  ville: 'Abidjan, Côte d’Ivoire',
  /** À RENSEIGNER — ex. « Rue des Jardins, Cocody » */
  adresse: '',
  /** À RENSEIGNER — ex. « +225 27 22 00 00 00 » */
  telephone: '',
  /** À RENSEIGNER — adresse publique (distincte de CONTACT_EMAIL côté API si besoin). */
  email: '',
};

/** Références du secteur, liens vers les organismes officiels. */
export const REFERENCES = [
  { libelle: 'Code des assurances CIMA', href: 'https://cima-afrique.org' },
  { libelle: 'Couverture maladie universelle (IPS-CNAM)', href: 'https://www.ipscnam.ci' },
  { libelle: 'Protection des données personnelles (ARTCI)', href: 'https://www.artci.ci' },
];
