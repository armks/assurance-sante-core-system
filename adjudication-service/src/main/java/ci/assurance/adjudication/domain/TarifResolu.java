package ci.assurance.adjudication.domain;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.UUID;

/**
 * Tarif RECONNU d'un acte, résolu par {@link ResolveurTarif} (ADR-008, lot 3) — la seule définition,
 * partagée par la simulation, la facture et la réclamation.
 *
 * <p>Ordre de résolution : forfait de l'acte dans la convention en vigueur à la date des soins →
 * valeur de lettre-clé propre à l'acte (coefficient × valeur) → coefficient × valeur de la lettre-clé de
 * la convention selon le contexte (ambulatoire / hospitalisation) → sinon NON TARIFABLE. Jamais de prix
 * par défaut. Sans convention en vigueur : comportement historique (prix affiché reconnu), règle
 * {@code AUCUNE_CONVENTION}.
 *
 * <p>Arrondi : le tarif reconnu est arrondi à l'unité (HALF_UP), par acte.
 */
public record TarifResolu(
    Statut statut,
    Regle regle,
    /** Tarif reconnu de l'acte, arrondi à l'unité ; {@code null} sans convention, non applicable ou non tarifable. */
    BigDecimal tarifReconnu,
    String lettreCle,
    BigDecimal coefficient,
    /** Valeur de la lettre-clé effectivement appliquée (propre à l'acte ou de la convention). */
    BigDecimal valeurAppliquee,
    UUID conventionId,
    /** Ligne de forfait (= tarif projeté dans {@code tarifs_conventionnes}, même identifiant) — règle FORFAIT. */
    UUID tarifConventionneId,
    /** {@code PATIENT} | {@code REJET} ; {@code null} sans convention. */
    String politiqueDepassement,
    String message,
    /** Tarif reconnu par UNITÉ (arrondi) ; {@code tarifReconnu} = unitaire × quantité. */
    BigDecimal tarifUnitaire,
    int quantite,
    /** Tarif proposé encore non décidé : calcul PROVISOIRE (la ligne est exclue du paiement). */
    boolean provisoire,
    /** Tarif proposé retenu (règle TARIF_PROPOSE). */
    UUID tarifProposeId) {

  /** Forme sans quantité : unitaire = total, quantité 1, définitif. */
  public TarifResolu(
      Statut statut, Regle regle, BigDecimal tarifReconnu, String lettreCle, BigDecimal coefficient,
      BigDecimal valeurAppliquee, UUID conventionId, UUID tarifConventionneId, String politiqueDepassement,
      String message) {
    this(statut, regle, tarifReconnu, lettreCle, coefficient, valeurAppliquee, conventionId, tarifConventionneId,
        politiqueDepassement, message, tarifReconnu, 1, false, null);
  }

  public enum Statut {
    /** Pas d'établissement ni de date (pharmacie…) : aucun tarif conventionné n'est cherché. */
    NON_APPLICABLE,
    TARIFABLE,
    NON_TARIFABLE
  }

  public enum Regle {
    FORFAIT,
    VALEUR_PROPRE,
    VALEUR_LETTRE_CLE,
    AUCUNE_CONVENTION,
    /** Montant saisi par l'établissement pour un acte non tarifable (ADR-008, lot 4). */
    TARIF_PROPOSE
  }

  public static TarifResolu nonApplicable() {
    return new TarifResolu(Statut.NON_APPLICABLE, null, null, null, null, null, null, null, null, null);
  }

  public static TarifResolu aucuneConvention() {
    return new TarifResolu(Statut.TARIFABLE, Regle.AUCUNE_CONVENTION, null, null, null, null, null, null, null,
        "Aucune convention validée en vigueur à la date des soins : le prix affiché est reconnu.");
  }

  public static TarifResolu nonTarifable(UUID conventionId, String politique, String message) {
    return new TarifResolu(Statut.NON_TARIFABLE, null, null, null, null, null, conventionId, null, politique, message);
  }

  /** Même tarif pour {@code quantite} unités : le reconnu devient unitaire × quantité (unitaire déjà arrondi). */
  public TarifResolu pourQuantite(int q) {
    if (q <= 1 || tarifUnitaire == null) {
      return this;
    }
    return new TarifResolu(statut, regle, tarifUnitaire.multiply(BigDecimal.valueOf(q)), lettreCle, coefficient,
        valeurAppliquee, conventionId, tarifConventionneId, politiqueDepassement, message, tarifUnitaire, q,
        provisoire, tarifProposeId);
  }

  /** Tarif proposé par l'établissement : le montant TOTAL de l'acte est le tarif reconnu. */
  public static TarifResolu propose(BigDecimal totalReconnu, int quantite, UUID conventionId, String politique,
      boolean provisoire, UUID tarifProposeId) {
    final int q = Math.max(quantite, 1);
    final BigDecimal total = arrondi(totalReconnu);
    return new TarifResolu(Statut.TARIFABLE, Regle.TARIF_PROPOSE, total, null, null, null, conventionId, null,
        politique, provisoire ? "Tarif proposé par l'établissement, en cours d'examen : calcul provisoire." : null,
        total.divide(BigDecimal.valueOf(q), 0, RoundingMode.HALF_UP), q, provisoire, tarifProposeId);
  }

  /** Forfait / tarif simple (tests, reprises) : règle FORFAIT, politique PATIENT. */
  public static TarifResolu forfait(BigDecimal tarif) {
    return new TarifResolu(Statut.TARIFABLE, Regle.FORFAIT, arrondi(tarif), null, null, null, null, null, "PATIENT", null);
  }

  /** Arrondi à l'unité (FCFA), HALF_UP — règle unique du Java. */
  public static BigDecimal arrondi(BigDecimal v) {
    return v.setScale(0, RoundingMode.HALF_UP);
  }

  /** Un tarif reconnu chiffré s'applique (convention en vigueur et acte tarifé). */
  public boolean conventionne() {
    return statut == Statut.TARIFABLE && regle != Regle.AUCUNE_CONVENTION && tarifReconnu != null;
  }

  public boolean nonTarifable() {
    return statut == Statut.NON_TARIFABLE;
  }
}
