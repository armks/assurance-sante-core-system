package ci.assurance.adjudication.domain;

import java.util.UUID;

/** Exceptions métier de l'adjudication (traduites en codes HTTP par le handler). */
public final class AdjudicationExceptions {

  private AdjudicationExceptions() {}

  /** 404 — réclamation absente ou supprimée. */
  public static class ReclamationIntrouvable extends RuntimeException {
    public ReclamationIntrouvable(UUID id) {
      super("Réclamation introuvable : " + id);
    }
  }

  /**
   * 409 — la réclamation n'est pas au statut EN_ADJUDICATION attendu (déjà traitée,
   * ou modifiée pendant l'adjudication). Idempotence : impossible de traiter deux
   * fois la même réclamation, même sur un retry réseau.
   */
  public static class MauvaisStatut extends RuntimeException {
    public MauvaisStatut(UUID id, String statutActuel) {
      super("Réclamation " + id + " au statut « " + statutActuel
          + " » — adjudication impossible (attendu EN_ADJUDICATION).");
    }
  }

  /** 409 — un remboursement existe déjà pour cette réclamation. */
  public static class Doublon extends RuntimeException {
    public Doublon(UUID id) {
      super("Un remboursement existe déjà pour la réclamation " + id + ".");
    }
  }
}
