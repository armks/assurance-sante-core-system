/**
 * Logique de navigation partagée par les shells (dashboards de rôle et
 * superadmin) : lien actif et largeur du contenu selon le type de page.
 */

/**
 * Largeur du contenu principal :
 *  - `detail`    : fiche / formulaire (`[id]`) — lecture confortable ;
 *  - `dashboard` : vue d'ensemble (chiffres-clés, raccourcis) ;
 *  - `liste`     : écran de liste (DataTable de 7 à 9 colonnes).
 */
export type LargeurPage = 'detail' | 'dashboard' | 'liste';

export const CLASSE_LARGEUR: Record<LargeurPage, string> = {
  detail: 'max-w-5xl',
  dashboard: 'max-w-7xl',
  liste: 'max-w-screen-2xl',
};

export interface LienNavigable {
  href: string;
  /** largeur de la page atteinte par ce lien (défaut : `liste`). */
  largeur?: LargeurPage;
}

/**
 * Lien de navigation correspondant au chemin courant : correspondance exacte,
 * sinon le lien le plus long dont le chemin est un sous-chemin. Un seul lien
 * est actif — `/dashboard-adherent` ne l'est plus en même temps que
 * `/dashboard-adherent/factures`.
 */
export function lienActif<T extends LienNavigable>(
  pathname: string,
  liens: T[],
): T | null {
  let meilleur: T | null = null;
  for (const lien of liens) {
    const correspond =
      pathname === lien.href || pathname.startsWith(`${lien.href}/`);
    if (correspond && (!meilleur || lien.href.length > meilleur.href.length)) {
      meilleur = lien;
    }
  }
  return meilleur;
}

/**
 * Largeur du contenu pour le chemin courant, déduite de la navigation :
 *  - page d'une entrée de menu → `largeur` de l'entrée (défaut `liste`) ;
 *  - fiche sous une entrée (un segment identifiant, ex. `/polices/<uuid>` ou
 *    `/medecin-conseil/dossiers/<uuid>`) → `detail` ;
 *  - sous-page littérale (ex. `/reclamations/revue-manuelle`) → `liste` ;
 *  - hors menu → `dashboard` (intermédiaire, jamais plus étroit qu'avant).
 */
export function largeurPourChemin(
  pathname: string,
  liens: LienNavigable[],
): LargeurPage {
  const actif = lienActif(pathname, liens);
  if (!actif) return 'dashboard';
  if (pathname === actif.href) return actif.largeur ?? 'liste';
  const segments = pathname.slice(actif.href.length + 1).split('/');
  // identifiants (uuid / cuid) : toujours au moins un chiffre
  return segments.some((s) => /\d/.test(s)) ? 'detail' : 'liste';
}
