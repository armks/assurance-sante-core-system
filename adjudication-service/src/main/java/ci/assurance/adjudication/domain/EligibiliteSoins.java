package ci.assurance.adjudication.domain;

import java.time.LocalDate;
import java.util.Set;

/**
 * Éligibilité d'un soin à la police, appréciée à la DATE DES SOINS (ADR-006, amendement) —
 * règle UNIQUE de la réclamation (adjudication) et de la facture tiers payant (simulation).
 * Fonction PURE (aucune I/O).
 *
 * <p>Dans l'ordre, le premier motif qui s'applique :
 * <ol>
 *   <li>soins postérieurs à la date de déclaration (réclamation, ou jour de la facture) →
 *       {@code E013} ;</li>
 *   <li>soins antérieurs au début de la police → {@code E012} ;</li>
 *   <li>soins postérieurs à la fin de la police, ou police qui ne couvrait pas : suspendue,
 *       pas encore en vigueur (devis, souscription), terminée sans date de fin connue →
 *       {@code E001}. Une police terminée (résiliée, non renouvelée, renouvelée) AVEC sa date
 *       de fin couvre les soins jusqu'à cette date ;</li>
 *   <li>déclaration plus de {@code delaiDeclarationJours} jours après la fin de la police →
 *       {@code E014} (pas de délai tant que la police n'est pas finie).</li>
 * </ol>
 */
public final class EligibiliteSoins {

  private EligibiliteSoins() {}

  /** Délai par défaut entre la fin de la police et la déclaration (3 mois). */
  public static final int DELAI_DECLARATION_DEFAUT_JOURS = 90;

  private static final Set<String> STATUTS_TERMINES =
      Set.of("RESILIEE", "NON_RENOUVELEE", "RENOUVELEE");

  /** Code de rejet, ou {@code null} si le soin est couvert à sa date. */
  public static String motifRejet(
      String statutPolice,
      LocalDate debutPolice,
      LocalDate finPolice,
      Integer delaiDeclarationJours,
      LocalDate dateSoins,
      LocalDate dateDeclaration) {
    if (dateSoins.isAfter(dateDeclaration)) {
      return CodesRejet.SOINS_FUTURS;
    }
    if (debutPolice != null && dateSoins.isBefore(debutPolice)) {
      return CodesRejet.SOINS_AVANT_DEBUT_POLICE;
    }
    if (finPolice != null && dateSoins.isAfter(finPolice)) {
      return CodesRejet.POLICE_INACTIVE;
    }
    final boolean couvre =
        "ACTIVE".equals(statutPolice)
            || (STATUTS_TERMINES.contains(statutPolice) && finPolice != null);
    if (!couvre) {
      return CodesRejet.POLICE_INACTIVE;
    }
    if (finPolice != null) {
      final int delai =
          delaiDeclarationJours != null ? delaiDeclarationJours : DELAI_DECLARATION_DEFAUT_JOURS;
      if (dateDeclaration.isAfter(finPolice.plusDays(delai))) {
        return CodesRejet.DECLARATION_HORS_DELAI;
      }
    }
    return null;
  }
}
