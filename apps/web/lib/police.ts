import type { TonStatut } from '@/components/dashboard/patterns/statut-badge';

/**
 * Statuts d'une police — SOURCE UNIQUE des libellés et tonalités, pour les
 * écrans assureur, adhérent et société. Tonalités alignées sur la convention de
 * `StatutBadge` : suspendue / en souscription = ambre (état réversible ou en
 * cours), non renouvelée / résiliée = rouge (fin de couverture).
 */
export const LIBELLE_POLICE: Record<string, string> = {
  DEVIS: 'Devis',
  EN_SOUSCRIPTION: 'En souscription',
  ACTIVE: 'Active',
  SUSPENDUE: 'Suspendue',
  RENOUVELEE: 'Renouvelée',
  RESILIEE: 'Résiliée',
  NON_RENOUVELEE: 'Non renouvelée',
};

export const TON_POLICE: Record<string, TonStatut> = {
  DEVIS: 'attention',
  EN_SOUSCRIPTION: 'attention',
  ACTIVE: 'succes',
  SUSPENDUE: 'attention',
  RENOUVELEE: 'neutre',
  RESILIEE: 'danger',
  NON_RENOUVELEE: 'danger',
};
