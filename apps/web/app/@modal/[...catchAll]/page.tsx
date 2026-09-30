/**
 * Toute navigation client vers une autre route (connexion réussie → tableau de
 * bord, « Mot de passe oublié ? »…) vide l'emplacement `@modal` : sans cette
 * route, Next.js garderait la dernière superposition affichée.
 */
export default function FermerModal() {
  return null;
}
