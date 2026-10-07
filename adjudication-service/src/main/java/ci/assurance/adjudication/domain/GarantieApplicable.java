package ci.assurance.adjudication.domain;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Paramètres d'une garantie, lus pour une simulation ou l'état des plafonds (pas de
 * réclamation). Plafonds annuels (prisma/sql/069) : par personne et par famille, chacun
 * optionnel ; le plus restrictif s'applique.
 */
public record GarantieApplicable(
    UUID id,
    UUID produitId,
    String categorieActe,
    BigDecimal tauxCouverturePct,
    BigDecimal plafondParActe,
    BigDecimal plafondAnnuelPersonne,
    BigDecimal plafondAnnuelFamille,
    BigDecimal franchise,
    BigDecimal ticketModerateurPct,
    Integer delaiCarenceJours,
    String reseauSoins) {
}
