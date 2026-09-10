package ci.assurance.adjudication;

import ci.assurance.adjudication.domain.ContexteAdjudication;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Jeu de données de référence pour les tests d'adjudication (montants EXACTS).
 *
 * <p>Garantie de référence :
 * <ul>
 *   <li>taux de couverture : 80 %</li>
 *   <li>franchise : 2 000</li>
 *   <li>plafond par acte : 50 000</li>
 *   <li>plafond annuel : 100 000</li>
 *   <li>délai de carence : 0 j</li>
 * </ul>
 * Police ACTIVE du 2026-01-01 au 2026-12-31. Réclamation créée le 2026-06-15.
 */
public final class JeuDeDonneesReference {

  private JeuDeDonneesReference() {}

  public static final UUID RECLAMATION_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");
  public static final UUID ADHERENT_ID = UUID.fromString("22222222-2222-4222-8222-222222222222");
  public static final UUID POLICE_ID = UUID.fromString("33333333-3333-4333-8333-333333333333");
  public static final UUID GARANTIE_ID = UUID.fromString("44444444-4444-4444-8444-444444444444");

  public static final BigDecimal TAUX_PCT = new BigDecimal("80");
  public static final BigDecimal FRANCHISE = new BigDecimal("2000.00");
  public static final BigDecimal PLAFOND_PAR_ACTE = new BigDecimal("50000.00");
  public static final BigDecimal PLAFOND_ANNUEL = new BigDecimal("100000.00");
  public static final Instant DATE_CREATION = LocalDate.of(2026, 6, 15).atStartOfDay(java.time.ZoneOffset.UTC).toInstant();

  /** Contexte de base, personnalisable par les {@code with*} ci-dessous. */
  public static ContexteAdjudication contexte(
      BigDecimal montantReclame, String policeStatut) {
    return new ContexteAdjudication(
        RECLAMATION_ID,
        UUID.fromString("00000000-0000-4000-8000-0000000000aa"), // organisation
        UUID.fromString("00000000-0000-4000-8000-0000000000dd"), // dossier
        UUID.fromString("00000000-0000-4000-8000-0000000000ee"), // acte
        ADHERENT_ID,
        null, // bénéficiaire
        POLICE_ID,
        GARANTIE_ID,
        montantReclame,
        "SOIN",
        "EN_ADJUDICATION",
        DATE_CREATION,
        TAUX_PCT,
        PLAFOND_PAR_ACTE,
        PLAFOND_ANNUEL,
        FRANCHISE,
        new BigDecimal("20"), // ticket modérateur (non utilisé par le calcul actuel)
        0, // carence
        "TOUT_RESEAU",
        policeStatut,
        LocalDate.of(2026, 1, 1),
        LocalDate.of(2026, 12, 31));
  }

  public static ContexteAdjudication actif(BigDecimal montantReclame) {
    return contexte(montantReclame, "ACTIVE");
  }
}
