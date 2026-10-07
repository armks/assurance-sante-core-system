package ci.assurance.adjudication.domain;

import java.math.BigDecimal;
import java.util.UUID;

/** Paramètres d'une garantie, lus pour une simulation (pas de réclamation). */
public record GarantieApplicable(
    UUID id,
    UUID produitId,
    BigDecimal tauxCouverturePct,
    BigDecimal plafondParActe,
    BigDecimal plafondAnnuel,
    BigDecimal franchise,
    BigDecimal ticketModerateurPct,
    Integer delaiCarenceJours,
    String reseauSoins) {
}
