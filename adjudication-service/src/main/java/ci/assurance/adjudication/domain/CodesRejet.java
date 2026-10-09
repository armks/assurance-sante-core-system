package ci.assurance.adjudication.domain;

/**
 * Codes de rejet / de mise en revue renvoyés dans la décision (`codes_rejet[]`).
 * Alignés sur la nomenclature métier (v3 §4 / v8).
 */
public final class CodesRejet {

  private CodesRejet() {}

  /**
   * Police ne couvrant pas la date des soins : soins après sa date de fin, ou police
   * suspendue / pas encore en vigueur / terminée sans date de fin connue.
   */
  public static final String POLICE_INACTIVE = "E001";

  /** Plafond annuel de la garantie atteint ou dépassé pour cet adhérent. */
  public static final String PLAFOND_ATTEINT = "E006";

  /** Montant élevé — au-dessus du seuil d'adjudication automatique. */
  public static final String MONTANT_ELEVE = "E010";

  // --- Date des soins (ADR-006, amendement : éligibilité à la date des soins) ---

  /** Soins antérieurs à la date de début de la police. */
  public static final String SOINS_AVANT_DEBUT_POLICE = "E012";

  /** Date des soins postérieure à la date de déclaration (réclamation / facture). */
  public static final String SOINS_FUTURS = "E013";

  /** Déclaration au-delà du délai suivant la fin de la police ({@code produits.delai_declaration_jours}). */
  public static final String DECLARATION_HORS_DELAI = "E014";

  // --- Tarif (ADR-008, lot 3) ---

  /** Prix affiché supérieur au tarif reconnu, et la convention de l'établissement rejette les dépassements. */
  public static final String TARIF_DEPASSE = "E015";

  /** Acte non tarifable : la convention en vigueur ne donne ni forfait ni valeur de lettre-clé pour lui. */
  public static final String ACTE_NON_TARIFABLE = "E016";
}
