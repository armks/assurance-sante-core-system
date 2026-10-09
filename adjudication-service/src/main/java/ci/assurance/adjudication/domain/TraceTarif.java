package ci.assurance.adjudication.domain;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Instantané du tarif appliqué à une ligne, renvoyé par la simulation : l'appelant le FIGE sur la ligne de
 * facturation à l'émission (lettre-clé, coefficient, valeur appliquée, règle d'origine, convention, prix
 * affiché, tarif reconnu, écart). Montants arrondis à l'unité ; {@code ecart} = prix affiché − tarif reconnu
 * (positif = dépassement).
 */
public record TraceTarif(
    String statutTarif,
    String regleOrigine,
    String lettreCle,
    BigDecimal coefficient,
    BigDecimal valeurAppliquee,
    UUID conventionId,
    String politiqueDepassement,
    BigDecimal prixAffiche,
    BigDecimal tarifReconnu,
    BigDecimal ecart,
    String message) {

  /** Trace d'une ligne : {@code prixAffiche} est le montant de la ligne tel qu'il est affiché (facturé). */
  public static TraceTarif de(TarifResolu t, BigDecimal prixAffiche) {
    if (t == null || t.statut() == TarifResolu.Statut.NON_APPLICABLE) {
      return new TraceTarif("NON_APPLICABLE", null, null, null, null, null, null,
          prixAffiche == null ? null : TarifResolu.arrondi(prixAffiche), null, null, null);
    }
    final BigDecimal affiche = TarifResolu.arrondi(prixAffiche);
    if (t.nonTarifable()) {
      return new TraceTarif("NON_TARIFABLE", null, null, null, null, t.conventionId(), t.politiqueDepassement(),
          affiche, null, null, t.message());
    }
    // sans convention, le prix affiché EST le tarif reconnu : écart nul
    final BigDecimal reconnu = t.conventionne() ? t.tarifReconnu() : affiche;
    return new TraceTarif("TARIFABLE", t.regle().name(), t.lettreCle(), t.coefficient(), t.valeurAppliquee(),
        t.conventionId(), t.politiqueDepassement(), affiche, reconnu, affiche.subtract(reconnu), t.message());
  }
}
