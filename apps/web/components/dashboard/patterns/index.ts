/**
 * Patterns réutilisables des écrans de gestion — construits sur les primitives
 * shadcn (`components/ui/*`), formalisés une fois pour être réemployés partout
 * (souscripteurs, produits, polices, cotisations, établissements, utilisateurs…).
 *
 *  - `DataTable`       — tableau générique : recherche, filtres select, tri, pagination, état vide, état de chargement
 *  - `FormulaireModal` — wrapper de formulaire création/édition (drawer mobile-first ou modale), erreurs de validation listées
 *  - `Champ*`           — champs libellés (texte, nombre, select, zone, checkbox) pour ces formulaires
 *  - `StatutBadge`      — badge de statut coloré (tonalité déduite du jeton, surchargeable par `map`)
 *  - `CarteResume`      — carte de chiffre-clé, + `GrilleCartes` pour la rangée
 *
 * Doc et exemples : `./README.md`.
 */
export { DataTable, type ColonneTable, type FiltreSelect } from './data-table';
export { FormulaireModal, type ResultatSoumission } from './formulaire-modal';
export {
  Champ,
  ChampTexte,
  ChampNombre,
  ChampZone,
  ChampSelect,
  ChampCheckbox,
  type OptionChamp,
} from './champs';
export { StatutBadge, type TonStatut } from './statut-badge';
export { CarteResume, GrilleCartes } from './carte-resume';
