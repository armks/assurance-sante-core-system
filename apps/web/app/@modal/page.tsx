/**
 * Emplacement `@modal` de la page d'accueil `/` : sans cette page, Next.js
 * n'inclut pas le slot dans l'arbre de `/` (le `default.tsx` n'y suffit pas) et
 * la route interceptée `(.)login` n'aurait nulle part où s'afficher.
 */
export default function ModalAccueil() {
  return null;
}
