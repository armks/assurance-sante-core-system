/**
 * Statuts des factures mensuelles (établissement et pharmacie) vus par la
 * COMPTABILITÉ ASSUREUR — SOURCE UNIQUE des libellés et tonalités des écrans
 * « Factures établissements », « Factures pharmacies » et « Suivi des
 * paiements ». Formulés selon l'action attendue du comptable. Les écrans du
 * centre médical, de la pharmacie et des conseils gardent leurs propres
 * formulations (autre public).
 *
 * `PROGRAMMEE_PAIEMENT` (validée par le comptable, payable) et
 * `PAIEMENT_PROGRAMME` (débit programmé à une date future) sont deux statuts
 * distincts : leurs libellés doivent le rester.
 */
export const LIBELLE_STATUT_FACTURE_MENSUELLE: Record<string, string> = {
  EN_PREPARATION: 'En préparation',
  SOUMISE: 'Soumise — à vérifier par le conseil',
  VERIFIEE_MEDECIN_CONSEIL: 'Vérifiée par le conseil — à valider pour paiement',
  VALIDEE_PHARMACIEN_CONSEIL: 'Vérifiée par le conseil — à valider pour paiement',
  PROGRAMMEE_PAIEMENT: 'Validée — à payer',
  PAIEMENT_PROGRAMME: 'Paiement programmé',
  PARTIELLEMENT_REGLEE: 'Réglée partiellement',
  PAYEE: 'Payée',
};

export const TON_STATUT_FACTURE_MENSUELLE: Record<
  string,
  'succes' | 'attention' | 'danger' | 'neutre'
> = {
  EN_PREPARATION: 'neutre',
  SOUMISE: 'attention',
  VERIFIEE_MEDECIN_CONSEIL: 'attention',
  VALIDEE_PHARMACIEN_CONSEIL: 'attention',
  PROGRAMMEE_PAIEMENT: 'attention',
  PAIEMENT_PROGRAMME: 'attention',
  PARTIELLEMENT_REGLEE: 'attention',
  PAYEE: 'succes',
};
