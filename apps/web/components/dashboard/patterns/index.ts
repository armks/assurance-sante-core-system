/**
 * Patterns réutilisables des écrans de gestion — construits sur les primitives
 * shadcn (`components/ui/*`), formalisés une fois pour être réemployés partout
 * (souscripteurs, produits, polices, cotisations, établissements, utilisateurs…).
 *
 *  - `DataTable`       — tableau générique : recherche, filtres select, tri, pagination, état vide, état de chargement
 *  - `FiltresServeur` / `PaginationServeur` — listes longues paginées CÔTÉ SERVEUR (filtres dans l'URL → API)
 *  - `FormulaireModal` — wrapper de formulaire création/édition (drawer mobile-first ou modale), erreurs de validation listées
 *  - `Champ*`           — champs libellés (texte, nombre, select, zone, checkbox) pour ces formulaires
 *  - `StatutBadge`      — badge de statut coloré (tonalité déduite du jeton, surchargeable par `map`)
 *  - `CarteResume`      — carte de chiffre-clé, + `GrilleCartes` pour la rangée
 *  - `Alerte`           — bandeau succès / erreur / avertissement / info, annoncé aux lecteurs d'écran
 *  - `ConfirmationAction` — confirmation PARTAGÉE de suppression / archivage / désarchivage (vérifie côté serveur, affiche la raison d'un refus)
 *
 * Doc et exemples : `./README.md`.
 */
export { DataTable, type ColonneTable, type FiltreSelect } from './data-table';
export {
  FiltresServeur,
  PaginationServeur,
  type FiltreServeurSelect,
  type PageServeur,
} from './liste-serveur';
export { FormulaireModal, type ResultatSoumission } from './formulaire-modal';
export {
  Champ,
  ChampTexte,
  ChampNombre,
  ChampZone,
  ChampSelect,
  ChampCheckbox,
  ChampFichier,
  type OptionChamp,
} from './champs';
export { StatutBadge, type TonStatut } from './statut-badge';
export { CarteResume, GrilleCartes } from './carte-resume';
export { Alerte, type AnnonceAlerte, type TonAlerte } from './alerte';
export {
  ConfirmationAction,
  LIBELLE_ACTION,
  type ActionConfirmee,
  type ResultatAction,
  type VerdictAction,
} from './confirmation-action';
