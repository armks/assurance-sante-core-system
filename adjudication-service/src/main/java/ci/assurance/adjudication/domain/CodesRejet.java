package ci.assurance.adjudication.domain;

/**
 * Codes de rejet / de mise en revue renvoyés dans la décision (`codes_rejet[]`).
 * Alignés sur la nomenclature métier (v3 §4 / v8).
 */
public final class CodesRejet {

  private CodesRejet() {}

  /** Police non active à la date de soin (suspendue, résiliée, hors période). */
  public static final String POLICE_INACTIVE = "E001";

  /** Plafond annuel de la garantie atteint ou dépassé pour cet adhérent. */
  public static final String PLAFOND_ATTEINT = "E006";

  /** Montant élevé — au-dessus du seuil d'adjudication automatique. */
  public static final String MONTANT_ELEVE = "E010";
}
