package ci.assurance.adjudication.domain;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

/**
 * Frontière d'accès aux données de l'adjudication. Une implémentation JDBC unique
 * (rôle Postgres {@code svc_adjudication}) ; l'interface permet un test unitaire
 * du pipeline sans base de données.
 *
 * Toutes les méthodes sont appelées à l'intérieur de la MÊME transaction
 * (ouverte par {@code @Transactional} sur AdjudicationService).
 */
public interface AdjudicationRepository {

  /** Réclamation + garantie applicable + police, en une requête. */
  Optional<ContexteAdjudication> chargerContexte(UUID reclamationId);

  /** Un remboursement existe-t-il déjà pour cette réclamation ? (doublon) */
  boolean remboursementExiste(UUID reclamationId);

  /**
   * Verrou pessimiste transactionnel keyé sur l'adhérent (ou la police à défaut) :
   * {@code SELECT pg_advisory_xact_lock(hashtextextended(?, 0))}. Deux adjudications
   * concurrentes pour le même adhérent ne peuvent PAS calculer le plafond en même
   * temps ; le verrou est relâché automatiquement au commit / rollback.
   *
   * <p>On n'utilise pas {@code SELECT ... FOR UPDATE} sur {@code polices} : cela
   * exigerait le privilège {@code UPDATE} sur la table, ce qui sur-privilégierait
   * le rôle {@code svc_adjudication} (il ne modifie jamais de police).
   */
  void verrouillerPourPlafond(UUID cle);

  /**
   * Montant déjà pris en charge par l'assureur dans l'année civile en cours, pour
   * la PERSONNE assurée ET la GARANTIE — c'est ce qui consomme le plafond annuel :
   * les remboursements adjugés PLUS la part assurance des lignes de facturation
   * tiers payant (actes facturés par l'établissement ; la garantie d'une ligne est
   * celle du produit de la police pour la catégorie de l'acte). Personne :
   * l'adhérent titulaire si {@code adherentId} est renseigné, sinon le
   * bénéficiaire. Les deux nuls : zéro. Seule définition du cumul, utilisée par
   * l'adjudication ET la simulation. {@code actesExclus} : actes dont les lignes de
   * facturation ne comptent pas (actes en cours de (re)facturation, simulés dans la
   * même demande — une ligne orpheline réattachée ne doit pas compter deux fois) ;
   * vide pour une adjudication.
   */
  BigDecimal sommeConsommeeAnnee(
      UUID adherentId, UUID beneficiaireId, UUID garantieId, java.util.Collection<UUID> actesExclus);

  /** Garantie (simulation) — vide si absente ou supprimée. */
  Optional<GarantieApplicable> chargerGarantie(UUID garantieId);

  /** Police (simulation) — vide si absente ou supprimée. */
  Optional<PoliceApplicable> chargerPolice(UUID policeId);

  /**
   * Tarif conventionné établissement × acte valable à {@code date} (même règle que
   * le contexte d'une réclamation), ou {@code null} : pas d'établissement, pas de
   * code d'acte, ou pas de tarif négocié.
   */
  BigDecimal tarifConvention(UUID etablissementId, String codeActe, java.time.LocalDate date);

  /** INSERT dans {@code remboursements} ... RETURNING id. */
  UUID insererRemboursement(
      UUID reclamationId,
      BigDecimal montantRembourse,
      BigDecimal plafondRestantApres,
      String decision,
      long dureeTraitementMs);

  /**
   * {@code UPDATE reclamations SET statut = ? WHERE id = ? AND statut = 'EN_ADJUDICATION'}.
   * @return nombre de lignes affectées (0 = la réclamation a changé de statut entre-temps).
   */
  int majStatut(UUID reclamationId, String statut);

  /** Trace la décision via {@code SELECT log_audit(...)}. */
  void journaliser(UUID reclamationId, UUID svcUserId, Adjudicateur.Resultat resultat);
}
