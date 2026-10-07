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
   * Somme des remboursements de l'année civile en cours, pour la PERSONNE
   * assurée ET la GARANTIE de la réclamation — le plafond annuel est un
   * attribut de la garantie, il ne se consomme que par ses propres
   * remboursements. Personne : l'adhérent titulaire si {@code adherentId} est
   * renseigné, sinon le bénéficiaire ({@code reclamations.adherent_id} est NULL
   * sur ses réclamations). Les deux nuls : zéro.
   */
  BigDecimal sommeRemboursementsAnnee(UUID adherentId, UUID beneficiaireId, UUID garantieId);

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
