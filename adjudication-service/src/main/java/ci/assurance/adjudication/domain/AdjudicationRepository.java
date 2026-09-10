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

  /** Verrou pessimiste : {@code SELECT id FROM polices WHERE id = ? FOR UPDATE}. */
  void verrouillerPolice(UUID policeId);

  /** Somme des remboursements de l'année civile en cours pour cet adhérent. */
  BigDecimal sommeRemboursementsAnnee(UUID adherentId);

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
