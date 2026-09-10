package ci.assurance.adjudication;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Microservice d'adjudication (v12 §1). Propriétaire de la transaction complète
 * de calcul de remboursement : lecture verrouillée du plafond, pipeline de règles
 * (BigDecimal), écriture du remboursement + du statut, journalisation.
 *
 * Ne fait RIEN d'autre : pas d'Auth utilisateur, pas de CRUD métier — ceux-ci
 * restent dans apps/api (NestJS) + Supabase.
 */
@SpringBootApplication
public class AdjudicationServiceApplication {

  public static void main(String[] args) {
    SpringApplication.run(AdjudicationServiceApplication.class, args);
  }
}
