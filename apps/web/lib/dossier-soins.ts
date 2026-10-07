import type { FiltreSelect } from '@/components/dashboard/patterns';

/**
 * Filtre « Statut » des listes de dossiers de soins — MIROIR de
 * `STATUTS_DOSSIER` (`apps/api/src/care-episode/care-episode.types.ts`),
 * partagé par la supervision assureur et la facturation du centre médical.
 */
export const FILTRE_STATUT_DOSSIER: FiltreSelect = {
  cle: 'statut',
  libelle: 'Statut',
  options: [
    { valeur: 'OUVERT', libelle: 'Ouvert' },
    { valeur: 'SUSPENDU', libelle: 'Suspendu' },
    { valeur: 'TRANSFERE', libelle: 'Transféré' },
    { valeur: 'CLOTURE', libelle: 'Clôturé' },
    { valeur: 'FORCE_CLOS', libelle: 'Clôturé (forcé)' },
  ],
};
